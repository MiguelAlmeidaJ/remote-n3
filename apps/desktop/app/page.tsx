"use client";

import { useEffect, useRef, useState } from "react";
import type {
  DeviceHello,
  DevicePresence,
  ServerMessage,
  SessionRequest,
  SessionResponse,
  SignalMessage,
} from "@remote-n3/shared";

type Device = {
  deviceId: string;
  name: string;
  platform: "windows" | "linux" | "android" | "unknown";
  online: boolean;
};

type SessionState = {
  sessionId: string;
  peerId: string;
  direction: "incoming" | "outgoing";
  status: "pending" | "accepted" | "rejected";
};

type PeerState =
  | "idle"
  | "negotiating"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

type WebRtcSignalPayload =
  | {
      kind: "offer" | "answer";
      description: RTCSessionDescriptionInit;
    }
  | {
      kind: "ice";
      candidate: RTCIceCandidateInit;
    }
  | {
      kind: "hangup";
    };

const SIGNALING_URL =
  process.env.NEXT_PUBLIC_SIGNALING_URL ?? "ws://127.0.0.1:8787/ws";

const STUN_URL =
  process.env.NEXT_PUBLIC_STUN_URL ?? "stun:stun.l.google.com:19302";

function getOrCreateViewerId() {
  const key = "remote-n3-viewer-id";
  const stored = window.localStorage.getItem(key);
  if (stored) return stored;

  const id = crypto.randomUUID();
  window.localStorage.setItem(key, id);
  return id;
}

function isWebRtcSignalPayload(value: unknown): value is WebRtcSignalPayload {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;

  const kind = (value as { kind?: unknown }).kind;
  return kind === "offer" || kind === "answer" || kind === "ice" || kind === "hangup";
}

function waitForIceGatheringComplete(peer: RTCPeerConnection) {
  if (peer.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const handleStateChange = () => {
      if (peer.iceGatheringState === "complete") {
        peer.removeEventListener("icegatheringstatechange", handleStateChange);
        resolve();
      }
    };

    peer.addEventListener("icegatheringstatechange", handleStateChange);
  });
}

export default function HomePage() {
  const socketRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const controlChannelRef = useRef<RTCDataChannel | null>(null);

  const [viewerId, setViewerId] = useState<string | null>(null);
  const [connection, setConnection] = useState<
    "connecting" | "online" | "offline"
  >("connecting");
  const [devices, setDevices] = useState<Record<string, Device>>({});
  const [session, setSession] = useState<SessionState | null>(null);
  const [peerState, setPeerState] = useState<PeerState>("idle");
  const [lastError, setLastError] = useState<string | null>(null);

  function closePeer() {
    controlChannelRef.current?.close();
    controlChannelRef.current = null;

    peerRef.current?.close();
    peerRef.current = null;

    setPeerState("closed");
  }

  function sendSignal(
    from: string,
    to: string,
    payload: WebRtcSignalPayload,
  ) {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Servidor de signaling indisponível.");
    }

    const message: SignalMessage = {
      type: "signal",
      from,
      to,
      payload,
    };

    socket.send(JSON.stringify(message));
  }

  function configureControlChannel(channel: RTCDataChannel) {
    controlChannelRef.current = channel;

    channel.addEventListener("open", () => {
      setPeerState("connected");
    });

    channel.addEventListener("close", () => {
      setPeerState("disconnected");
    });

    channel.addEventListener("error", () => {
      setPeerState("failed");
    });
  }

  function createPeerConnection(localId: string, peerId: string) {
    peerRef.current?.close();

    const peer = new RTCPeerConnection({
      iceServers: [{ urls: STUN_URL }],
    });

    peerRef.current = peer;
    setPeerState("negotiating");

    peer.addEventListener("connectionstatechange", () => {
      const state = peer.connectionState;

      if (state === "new") setPeerState("negotiating");
      if (state === "connecting") setPeerState("connecting");
      if (state === "connected") setPeerState("connected");
      if (state === "disconnected") setPeerState("disconnected");
      if (state === "failed") setPeerState("failed");
      if (state === "closed") setPeerState("closed");
    });

    peer.addEventListener("datachannel", (event) => {
      configureControlChannel(event.channel);
    });

    return peer;
  }

  async function startOffer(localId: string, peerId: string) {
    try {
      const peer = createPeerConnection(localId, peerId);
      const controlChannel = peer.createDataChannel("remote-control", {
        ordered: true,
      });

      configureControlChannel(controlChannel);

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGatheringComplete(peer);

      if (!peer.localDescription) {
        throw new Error("Não foi possível gerar a descrição WebRTC local.");
      }

      sendSignal(localId, peerId, {
        kind: "offer",
        description: peer.localDescription.toJSON(),
      });
    } catch (error) {
      setPeerState("failed");
      setLastError(
        error instanceof Error
          ? error.message
          : "Falha ao iniciar negociação WebRTC.",
      );
    }
  }

  async function handleWebRtcSignal(
    localId: string,
    message: SignalMessage,
  ) {
    if (!isWebRtcSignalPayload(message.payload)) return;

    const payload = message.payload;

    try {
      if (payload.kind === "offer") {
        const peer = createPeerConnection(localId, message.from);

        await peer.setRemoteDescription(payload.description);

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await waitForIceGatheringComplete(peer);

        if (!peer.localDescription) {
          throw new Error("Não foi possível gerar a resposta WebRTC.");
        }

        sendSignal(localId, message.from, {
          kind: "answer",
          description: peer.localDescription.toJSON(),
        });

        return;
      }

      if (payload.kind === "answer") {
        const peer = peerRef.current;

        if (!peer) {
          throw new Error("Resposta WebRTC recebida sem conexão ativa.");
        }

        await peer.setRemoteDescription(payload.description);
        setPeerState("connecting");
        return;
      }

      if (payload.kind === "ice") {
        const peer = peerRef.current;
        if (!peer) return;

        await peer.addIceCandidate(payload.candidate);
        return;
      }

      if (payload.kind === "hangup") {
        closePeer();
      }
    } catch (error) {
      setPeerState("failed");
      setLastError(
        error instanceof Error
          ? error.message
          : "Erro durante negociação WebRTC.",
      );
    }
  }

  useEffect(() => {
    setViewerId(getOrCreateViewerId());

    return () => {
      peerRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!viewerId) return;

    let closedByComponent = false;
    let reconnectTimer: number | undefined;

    const connect = () => {
      setConnection("connecting");
      const socket = new WebSocket(SIGNALING_URL);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        setConnection("online");
        setLastError(null);

        const hello: DeviceHello = {
          type: "device:hello",
          deviceId: viewerId,
          name: `Viewer ${navigator.platform || "Desktop"}`,
          platform: "unknown",
          agentVersion: "desktop-0.2.0",
        };

        socket.send(JSON.stringify(hello));
      });

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data) as ServerMessage;

        if (message.type === "device:presence") {
          const presence = message as DevicePresence;
          if (presence.deviceId === viewerId) return;

          setDevices((current) => {
            if (!presence.online) {
              const next = { ...current };
              delete next[presence.deviceId];
              return next;
            }

            return {
              ...current,
              [presence.deviceId]: {
                deviceId: presence.deviceId,
                name: presence.name ?? presence.deviceId,
                platform: presence.platform ?? "unknown",
                online: true,
              },
            };
          });
          return;
        }

        if (message.type === "session:request") {
          setSession({
            sessionId: message.sessionId,
            peerId: message.from,
            direction: "incoming",
            status: "pending",
          });
          return;
        }

        if (message.type === "session:accept") {
          setSession((current) =>
            current?.sessionId === message.sessionId
              ? { ...current, status: "accepted" }
              : current,
          );

          void startOffer(viewerId, message.from);
          return;
        }

        if (message.type === "session:reject") {
          setSession((current) =>
            current?.sessionId === message.sessionId
              ? { ...current, status: "rejected" }
              : current,
          );
          return;
        }

        if (message.type === "signal") {
          void handleWebRtcSignal(viewerId, message);
          return;
        }

        if (message.type === "error") {
          setLastError(message.message);
        }
      });

      socket.addEventListener("close", () => {
        setConnection("offline");
        socketRef.current = null;

        if (!closedByComponent) {
          reconnectTimer = window.setTimeout(connect, 2000);
        }
      });

      socket.addEventListener("error", () => {
        setLastError("Não foi possível conectar ao servidor de signaling.");
      });
    };

    connect();

    return () => {
      closedByComponent = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [viewerId]);

  function requestSession(deviceId: string) {
    if (!viewerId) return;

    closePeer();
    setPeerState("idle");

    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const nextSession: SessionRequest = {
      type: "session:request",
      from: viewerId,
      to: deviceId,
      sessionId: crypto.randomUUID(),
    };

    socket.send(JSON.stringify(nextSession));
    setSession({
      sessionId: nextSession.sessionId,
      peerId: deviceId,
      direction: "outgoing",
      status: "pending",
    });
  }

  function answerSession(accepted: boolean) {
    if (!session || !viewerId) return;

    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const response: SessionResponse = {
      type: accepted ? "session:accept" : "session:reject",
      from: viewerId,
      to: session.peerId,
      sessionId: session.sessionId,
    };

    socket.send(JSON.stringify(response));
    setSession({ ...session, status: accepted ? "accepted" : "rejected" });

    if (!accepted) {
      closePeer();
    }
  }

  function endSession() {
    if (viewerId && session) {
      try {
        sendSignal(viewerId, session.peerId, { kind: "hangup" });
      } catch {
        // The local session must still close even if signaling is already offline.
      }
    }

    closePeer();
    setSession(null);
    setPeerState("idle");
  }

  const onlineDevices = Object.values(devices).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const peer = session ? devices[session.peerId] : undefined;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">REMOTE N3</p>
          <h1>Seus dispositivos</h1>
        </div>
        <div className={`status status--${connection}`}>
          <span />
          {connection === "online"
            ? "Servidor conectado"
            : connection === "connecting"
              ? "Conectando"
              : "Offline"}
        </div>
      </header>

      {lastError && <div className="alert">{lastError}</div>}

      <section className="identity">
        <div>
          <span>Este viewer</span>
          <strong>{viewerId ?? "Inicializando..."}</strong>
        </div>
        <small>
          {SIGNALING_URL} · P2P: {peerState}
        </small>
      </section>

      <section className="device-grid">
        {onlineDevices.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">N3</div>
            <h2>Nenhum dispositivo remoto online</h2>
            <p>
              Inicie o agente Remote N3 em outro computador para ele aparecer
              automaticamente aqui.
            </p>
          </div>
        ) : (
          onlineDevices.map((device) => (
            <article className="device-card" key={device.deviceId}>
              <div className="device-card__head">
                <div className="platform">
                  {device.platform.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <h2>{device.name}</h2>
                  <p>{device.platform}</p>
                </div>
                <span className="online-dot" title="Online" />
              </div>

              <code>{device.deviceId}</code>

              <button
                type="button"
                onClick={() => requestSession(device.deviceId)}
                disabled={
                  !viewerId ||
                  connection !== "online" ||
                  session?.status === "pending"
                }
              >
                Conectar
              </button>
            </article>
          ))
        )}
      </section>

      {session && (
        <div className="session-panel">
          <div>
            <span className="session-label">
              {session.direction === "incoming"
                ? "SOLICITAÇÃO RECEBIDA"
                : "SESSÃO REMOTA"}
            </span>
            <h3>{peer?.name ?? session.peerId}</h3>
            <p>
              {session.status === "pending"
                ? session.direction === "incoming"
                  ? "Este dispositivo quer iniciar uma sessão remota."
                  : "Aguardando autorização do dispositivo remoto…"
                : session.status === "accepted"
                  ? `Sessão autorizada · WebRTC: ${peerState}`
                  : "A sessão foi recusada."}
            </p>
          </div>

          {session.direction === "incoming" && session.status === "pending" ? (
            <div className="session-actions">
              <button className="secondary" onClick={() => answerSession(false)}>
                Recusar
              </button>
              <button onClick={() => answerSession(true)}>Aceitar</button>
            </div>
          ) : (
            <button className="secondary" onClick={endSession}>
              Encerrar
            </button>
          )}
        </div>
      )}
    </main>
  );
}
