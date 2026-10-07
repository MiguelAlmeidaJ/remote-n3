import Fastify from "fastify";
import { WebSocketServer, WebSocket } from "ws";
import type {
  ClientMessage,
  DeviceHello,
  DevicePresence,
  ServerError,
} from "@remote-n3/shared";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

const app = Fastify({ logger: true });

app.get("/health", async () => ({
  status: "ok",
  service: "remote-n3-api",
  devicesOnline: devices.size,
}));

const server = app.server;
const wss = new WebSocketServer({ server, path: "/ws" });

type ConnectedDevice = {
  socket: WebSocket;
  hello: DeviceHello;
  connectedAt: Date;
};

const devices = new Map<string, ConnectedDevice>();

function send(socket: WebSocket, message: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function sendError(socket: WebSocket, code: string, message: string) {
  const error: ServerError = { type: "error", code, message };
  send(socket, error);
}

function broadcastPresence(hello: DeviceHello, online: boolean) {
  const presence: DevicePresence = {
    type: "device:presence",
    deviceId: hello.deviceId,
    name: hello.name,
    platform: hello.platform,
    online,
  };

  for (const device of devices.values()) {
    send(device.socket, presence);
  }
}

function routeMessage(socket: WebSocket, message: ClientMessage) {
  if (!("to" in message)) {
    sendError(socket, "INVALID_MESSAGE", "Mensagem sem dispositivo de destino.");
    return;
  }

  const destination = devices.get(message.to);

  if (!destination) {
    sendError(socket, "DEVICE_OFFLINE", `Dispositivo ${message.to} está offline.`);
    return;
  }

  send(destination.socket, message);
}

wss.on("connection", (socket) => {
  let currentDeviceId: string | null = null;

  socket.on("message", (raw) => {
    let message: ClientMessage;

    try {
      message = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      sendError(socket, "INVALID_JSON", "Mensagem JSON inválida.");
      return;
    }

    if (message.type === "device:hello") {
      if (!message.deviceId || !message.name) {
        sendError(socket, "INVALID_HELLO", "deviceId e name são obrigatórios.");
        return;
      }

      currentDeviceId = message.deviceId;

      const previous = devices.get(message.deviceId);
      if (previous && previous.socket !== socket) {
        previous.socket.close(4001, "Device reconnected");
      }

      devices.set(message.deviceId, {
        socket,
        hello: message,
        connectedAt: new Date(),
      });

      broadcastPresence(message, true);

      for (const device of devices.values()) {
        send(socket, {
          type: "device:presence",
          deviceId: device.hello.deviceId,
          name: device.hello.name,
          platform: device.hello.platform,
          online: true,
        } satisfies DevicePresence);
      }

      return;
    }

    if (!currentDeviceId) {
      sendError(socket, "NOT_REGISTERED", "Envie device:hello antes de outras mensagens.");
      return;
    }

    if ("from" in message && message.from !== currentDeviceId) {
      sendError(socket, "SPOOFED_DEVICE", "O campo from não corresponde ao dispositivo autenticado.");
      return;
    }

    routeMessage(socket, message);
  });

  socket.on("close", () => {
    if (!currentDeviceId) return;

    const current = devices.get(currentDeviceId);
    if (current?.socket === socket) {
      devices.delete(currentDeviceId);
      broadcastPresence(current.hello, false);
    }
  });
});

await app.listen({ port, host });
