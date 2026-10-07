use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{env, fs, path::PathBuf};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use uuid::Uuid;

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
#[serde(tag = "type", rename_all = "kebab-case")]
enum IncomingMessage {
    #[serde(rename = "session:request")]
    SessionRequest {
        from: String,
        to: String,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
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

#[tokio::main]
async fn main() -> Result<()> {
    let signaling_url =
        env::var("REMOTE_N3_SIGNALING_URL").unwrap_or_else(|_| "ws://127.0.0.1:8787/ws".to_string());
    let auto_accept = env_flag("REMOTE_N3_AUTO_ACCEPT");

    let device_id = load_or_create_device_id()?;
    let name = hostname::get()?.to_string_lossy().to_string();

    println!("Remote N3 Agent");
    println!("Device ID: {device_id}");
    println!("Platform: {}", platform());
    println!("Auto accept: {}", if auto_accept { "enabled" } else { "disabled" });
    println!("Connecting to {signaling_url}");

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

                        let response_type = if auto_accept {
                            println!("Session automatically accepted.");
                            "session:accept"
                        } else {
                            println!(
                                "Session rejected. Set REMOTE_N3_AUTO_ACCEPT=1 only on a trusted test device to allow test sessions."
                            );
                            "session:reject"
                        };

                        let response = SessionResponse {
                            r#type: response_type,
                            from: device_id.clone(),
                            to: from,
                            session_id,
                        };

                        writer
                            .send(Message::Text(serde_json::to_string(&response)?.into()))
                            .await?;
                    }
                    _ => println!("< {raw}"),
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

    Ok(())
}
