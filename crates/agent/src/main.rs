use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
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

#[tokio::main]
async fn main() -> Result<()> {
    let signaling_url =
        env::var("REMOTE_N3_SIGNALING_URL").unwrap_or_else(|_| "ws://127.0.0.1:8787/ws".to_string());

    let device_id = load_or_create_device_id()?;
    let name = hostname::get()?.to_string_lossy().to_string();

    println!("Remote N3 Agent");
    println!("Device ID: {device_id}");
    println!("Connecting to {signaling_url}");

    let (socket, _) = connect_async(&signaling_url).await?;
    let (mut writer, mut reader) = socket.split();

    let hello = DeviceHello {
        r#type: "device:hello",
        device_id,
        name,
        platform: platform(),
        agent_version: env!("CARGO_PKG_VERSION"),
    };

    writer
        .send(Message::Text(serde_json::to_string(&hello)?.into()))
        .await?;

    while let Some(message) = reader.next().await {
        match message? {
            Message::Text(text) => println!("< {text}"),
            Message::Close(frame) => {
                println!("Connection closed: {frame:?}");
                break;
            }
            _ => {}
        }
    }

    Ok(())
}
