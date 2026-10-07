use anyhow::{anyhow, Result};
use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{env, fs, path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::Notify;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use uuid::Uuid;
use webrtc::data_channel::{DataChannel, DataChannelEvent};
use webrtc::peer_connection::{
    register_default_interceptors, MediaEngine, PeerConnection, PeerConnectionBuilder,
    PeerConnectionEventHandler, RTCConfigurationBuilder, RTCIceGatheringState, RTCIceServer,
    RTCPeerConnectionState, RTCSessionDescription, Registry,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceHello {
    r#type: &'static str,
    device_id: String,
    name: String,
    platform: &'static str,
    agent_version: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum IncomingMessage {
    #[serde(rename = "session:request")]
    SessionRequest {
        from: String,
        to: String,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    #[serde(rename = "signal")]
    Signal {
        from: String,
        to: String,
        payload: SignalPayload,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum SignalPayload {
    Offer { description: Value },
    Answer { description: Value },
    Ice { candidate: Value },
    Hangup,
    #[serde(other)]
    Other,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionResponse {
    r#type: &'static str,
    from: String,
    to: String,
    session_id: String,
}

struct AgentPeerHandler {
    gather_complete: Arc<Notify>,
}

#[async_trait]
impl PeerConnectionEventHandler for AgentPeerHandler {
    async fn on_ice_gathering_state_change(&self, state: RTCIceGatheringState) {
        println!("WebRTC ICE gathering: {state:?}");

        if state == RTCIceGatheringState::Complete {
            self.gather_complete.notify_one();
        }
    }

    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        println!("WebRTC connection state: {state}");

        if matches!(
            state,
            RTCPeerConnectionState::Failed
                | RTCPeerConnectionState::Disconnected
                | RTCPeerConnectionState::Closed
        ) {
            println!("WebRTC peer is no longer connected.");
        }
    }

    async fn on_data_channel(&self, data_channel: Arc<dyn DataChannel>) {
        tokio::spawn(async move {
            let label = data_channel
                .label()
                .await
                .unwrap_or_else(|_| "unknown".to_string());

            println!("WebRTC DataChannel received: {label}");

            while let Some(event) = data_channel.poll().await {
                match event {
                    DataChannelEvent::OnOpen => {
                        println!("DataChannel '{label}' is open.");

                        if let Err(error) = data_channel.send_text("remote-n3-agent-ready").await {
                            eprintln!("Failed to send DataChannel hello: {error}");
                        }
                    }
                    DataChannelEvent::OnMessage(message) => {
                        if let Ok(text) = String::from_utf8(message.data.to_vec()) {
                            println!("DataChannel '{label}' message: {text}");
                        }
                    }
                    DataChannelEvent::OnClose => {
                        println!("DataChannel '{label}' closed.");
                        break;
                    }
                    _ => {}
                }
            }
        });
    }
}

fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

fn data_dir() -> PathBuf {
    if cfg!(target_os = "windows") {
        env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("RemoteN3")
    } else {
        env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".remote-n3")
    }
}

fn load_or_create_device_id() -> Result<String> {
    let dir = data_dir();
    let file = dir.join("device-id");

    if let Ok(id) = fs::read_to_string(&file) {
        let id = id.trim();
        if !id.is_empty() {
            return Ok(id.to_string());
        }
    }

    fs::create_dir_all(&dir)?;
    let id = Uuid::new_v4().to_string();
    fs::write(file, &id)?;
    Ok(id)
}

fn env_flag(name: &str) -> bool {
    matches!(
        env::var(name).unwrap_or_default().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

async fn create_peer_connection(
    stun_url: &str,
    gather_complete: Arc<Notify>,
) -> Result<Arc<dyn PeerConnection>> {
    let mut media_engine = MediaEngine::default();
    media_engine.register_default_codecs()?;

    let registry = register_default_interceptors(Registry::new(), &mut media_engine)?;

    let config = RTCConfigurationBuilder::new()
        .with_ice_servers(vec![RTCIceServer {
            urls: vec![stun_url.to_string()],
            ..Default::default()
        }])
        .build();

    let peer = PeerConnectionBuilder::new()
        .with_configuration(config)
        .with_media_engine(media_engine)
        .with_interceptor_registry(registry)
        .with_handler(Arc::new(AgentPeerHandler { gather_complete }))
        .with_udp_addrs(vec!["0.0.0.0:0".to_string()])
        .build()
        .await?;

    Ok(Arc::new(peer))
}

#[tokio::main]
async fn main() -> Result<()> {
    let signaling_url =
        env::var("REMOTE_N3_SIGNALING_URL").unwrap_or_else(|_| "ws://127.0.0.1:8787/ws".to_string());
    let stun_url = env::var("REMOTE_N3_STUN_URL")
        .unwrap_or_else(|_| "stun:stun.l.google.com:19302".to_string());
    let auto_accept = env_flag("REMOTE_N3_AUTO_ACCEPT");

    let device_id = load_or_create_device_id()?;
    let name = hostname::get()?.to_string_lossy().to_string();

    println!("Remote N3 Agent");
    println!("Device ID: {device_id}");
    println!("Platform: {}", platform());
    println!("Auto accept: {}", if auto_accept { "enabled" } else { "disabled" });
    println!("Signaling: {signaling_url}");
    println!("STUN: {stun_url}");

    let (socket, _) = connect_async(&signaling_url).await?;
    let (mut writer, mut reader) = socket.split();

    let hello = DeviceHello {
        r#type: "device:hello",
        device_id: device_id.clone(),
        name,
        platform: platform(),
        agent_version: env!("CARGO_PKG_VERSION"),
    };

    writer
        .send(Message::Text(serde_json::to_string(&hello)?.into()))
        .await?;

    println!("Connected.");

    let mut authorized_peer: Option<String> = None;
    let mut active_peer: Option<Arc<dyn PeerConnection>> = None;

    while let Some(message) = reader.next().await {
        match message? {
            Message::Text(text) => {
                let raw = text.to_string();

                match serde_json::from_str::<IncomingMessage>(&raw) {
                    Ok(IncomingMessage::SessionRequest {
                        from,
                        to,
                        session_id,
                    }) if to == device_id => {
                        println!("Session request from {from} ({session_id})");

                        let accepted = auto_accept;

                        if accepted {
                            println!("Session automatically accepted for development.");
                            authorized_peer = Some(from.clone());
                        } else {
                            println!(
                                "Session rejected. Set REMOTE_N3_AUTO_ACCEPT=1 only on a trusted test device."
                            );
                            authorized_peer = None;
                        }

                        let response = SessionResponse {
                            r#type: if accepted {
                                "session:accept"
                            } else {
                                "session:reject"
                            },
                            from: device_id.clone(),
                            to: from,
                            session_id,
                        };

                        writer
                            .send(Message::Text(serde_json::to_string(&response)?.into()))
                            .await?;
                    }

                    Ok(IncomingMessage::Signal { from, to, payload }) if to == device_id => {
                        if authorized_peer.as_deref() != Some(from.as_str()) {
                            println!("Ignoring WebRTC signal from unauthorized peer {from}.");
                            continue;
                        }

                        match payload {
                            SignalPayload::Offer { description } => {
                                println!("WebRTC offer received from {from}.");

                                if let Some(peer) = active_peer.take() {
                                    let _ = peer.close().await;
                                }

                                let gather_complete = Arc::new(Notify::new());
                                let peer =
                                    create_peer_connection(&stun_url, gather_complete.clone()).await?;

                                let offer: RTCSessionDescription =
                                    serde_json::from_value(description)?;
                                peer.set_remote_description(offer).await?;

                                let answer = peer.create_answer(None).await?;
                                peer.set_local_description(answer).await?;

                                tokio::time::timeout(
                                    Duration::from_secs(20),
                                    gather_complete.notified(),
                                )
                                .await
                                .map_err(|_| anyhow!("ICE gathering timed out"))?;

                                let local_description = peer
                                    .local_description()
                                    .await
                                    .ok_or_else(|| anyhow!("Missing local WebRTC description"))?;

                                let response = json!({
                                    "type": "signal",
                                    "from": device_id,
                                    "to": from,
                                    "payload": {
                                        "kind": "answer",
                                        "description": local_description
                                    }
                                });

                                writer
                                    .send(Message::Text(response.to_string().into()))
                                    .await?;

                                active_peer = Some(peer);
                                println!("WebRTC answer sent.");
                            }

                            SignalPayload::Hangup => {
                                println!("Remote peer ended the WebRTC session.");

                                if let Some(peer) = active_peer.take() {
                                    let _ = peer.close().await;
                                }

                                authorized_peer = None;
                            }

                            SignalPayload::Ice { candidate } => {
                                println!(
                                    "Ignoring trickle ICE candidate in the current non-trickle milestone: {candidate}"
                                );
                            }

                            SignalPayload::Answer { .. } | SignalPayload::Other => {}
                        }
                    }

                    Ok(IncomingMessage::Other) => {}
                    Ok(_) => {}
                    Err(error) => {
                        eprintln!("Invalid signaling message: {error}");
                    }
                }
            }
            Message::Ping(payload) => {
                writer.send(Message::Pong(payload)).await?;
            }
            Message::Close(frame) => {
                println!("Connection closed: {frame:?}");
                break;
            }
            _ => {}
        }
    }

    if let Some(peer) = active_peer {
        let _ = peer.close().await;
    }

    Ok(())
}
