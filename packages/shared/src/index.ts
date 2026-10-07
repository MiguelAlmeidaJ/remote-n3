export type DevicePlatform = "windows" | "linux" | "android" | "unknown";

export interface DeviceHello {
  type: "device:hello";
  deviceId: string;
  name: string;
  platform: DevicePlatform;
  agentVersion: string;
}

export interface DevicePresence {
  type: "device:presence";
  deviceId: string;
  online: boolean;
  name?: string;
  platform?: DevicePlatform;
}

export interface SignalMessage {
  type: "signal";
  from: string;
  to: string;
  payload: unknown;
}

export interface SessionRequest {
  type: "session:request";
  from: string;
  to: string;
  sessionId: string;
}

export interface SessionResponse {
  type: "session:accept" | "session:reject";
  from: string;
  to: string;
  sessionId: string;
}

export interface ServerError {
  type: "error";
  code: string;
  message: string;
}

export type ClientMessage =
  | DeviceHello
  | SignalMessage
  | SessionRequest
  | SessionResponse;

export type ServerMessage =
  | DevicePresence
  | SignalMessage
  | SessionRequest
  | SessionResponse
  | ServerError;
