use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use chrono::Utc;
use serde_json::json;
use tokio::sync::{broadcast, Mutex};

use crate::services::agent::StreamEvent;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DetectedPort {
    pub port: u16,
    pub hostname: String,
}

pub struct PortScanner {
    broadcast_tx: broadcast::Sender<StreamEvent>,
    event_counter: Arc<AtomicU64>,
    event_buffer: Arc<Mutex<std::collections::VecDeque<StreamEvent>>>,
    known_ports: Arc<Mutex<HashSet<u16>>>,
}

impl PortScanner {
    pub fn new(
        broadcast_tx: broadcast::Sender<StreamEvent>,
        event_counter: Arc<AtomicU64>,
        event_buffer: Arc<Mutex<std::collections::VecDeque<StreamEvent>>>,
    ) -> Self {
        Self {
            broadcast_tx,
            event_counter,
            event_buffer,
            known_ports: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub fn start_periodic_scan(self: &Arc<Self>) {
        let scanner = Arc::clone(self);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
            loop {
                interval.tick().await;
                scanner.scan_and_broadcast().await;
            }
        });
    }

    pub async fn scan_and_broadcast(&self) {
        let detected = scan_listening_ports().await;
        let current: HashSet<u16> = detected.iter().map(|d| d.port).collect();

        let mut known = self.known_ports.lock().await;
        let previous = known.clone();

        let opened: Vec<u16> = current.difference(&previous).copied().collect();
        let closed: Vec<u16> = previous.difference(&current).copied().collect();

        *known = current;
        drop(known);

        if opened.is_empty() && closed.is_empty() {
            return;
        }

        for port in &opened {
            let data = json!({
                "type": "port_opened",
                "port": port,
                "hostname": "localhost",
                "label": format!("localhost:{port}"),
            });
            self.emit("port_opened", &data).await;
            tracing::debug!("Port opened: {port}");
        }

        for port in &closed {
            let data = json!({
                "type": "port_closed",
                "targetId": format!("localhost:{port}"),
                "port": port,
                "hostname": "localhost",
            });
            self.emit("port_closed", &data).await;
            tracing::debug!("Port closed: {port}");
        }
    }

    pub async fn get_current_ports_event(&self) -> serde_json::Value {
        let known = self.known_ports.lock().await;
        let targets: Vec<serde_json::Value> = known
            .iter()
            .map(|port| {
                json!({
                    "port": port,
                    "hostname": "localhost",
                    "id": format!("localhost:{port}"),
                    "label": format!("localhost:{port}"),
                })
            })
            .collect();
        json!({
            "type": "preview_state",
            "targets": targets,
        })
    }

    async fn emit(&self, event_type: &str, data: &serde_json::Value) {
        let evt_id = self.event_counter.fetch_add(1, Ordering::SeqCst);
        let stream_event = StreamEvent {
            id: evt_id,
            session_id: String::new(),
            workspace_id: String::new(),
            event_type: event_type.to_string(),
            data: data.clone(),
            timestamp: Utc::now().timestamp_millis(),
        };
        {
            let mut buf = self.event_buffer.lock().await;
            if buf.len() >= 10_000 {
                buf.pop_front();
            }
            buf.push_back(stream_event.clone());
        }
        let _ = self.broadcast_tx.send(stream_event);
    }
}

const MIN_USER_PORT: u16 = 1024;
const EXCLUDED_PORTS: &[u16] = &[5454, 19000, 19001, 19002, 19006];

async fn scan_listening_ports() -> Vec<DetectedPort> {
    tokio::task::spawn_blocking(scan_listening_ports_sync)
        .await
        .unwrap_or_default()
}

fn scan_listening_ports_sync() -> Vec<DetectedPort> {
    let mut ports = Vec::new();

    #[cfg(target_os = "linux")]
    {
        if let Ok(content) = std::fs::read_to_string("/proc/net/tcp") {
            parse_proc_net_tcp(&content, &mut ports);
        }
        if let Ok(content) = std::fs::read_to_string("/proc/net/tcp6") {
            parse_proc_net_tcp(&content, &mut ports);
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        if let Ok(output) = std::process::Command::new("lsof")
            .args(["-iTCP", "-sTCP:LISTEN", "-nP", "-Fn"])
            .output()
        {
            parse_lsof_output(&String::from_utf8_lossy(&output.stdout), &mut ports);
        }
    }

    let excluded: HashSet<u16> = EXCLUDED_PORTS.iter().copied().collect();
    ports.retain(|p| p.port >= MIN_USER_PORT && !excluded.contains(&p.port));

    let mut seen = HashSet::new();
    ports.retain(|p| seen.insert(p.port));
    ports.sort_by_key(|p| p.port);
    ports
}

#[cfg(target_os = "linux")]
fn parse_proc_net_tcp(content: &str, ports: &mut Vec<DetectedPort>) {
    // /proc/net/tcp format:
    //   sl  local_address rem_address   st tx_queue rx_queue ...
    //   0: 00000000:1F90 00000000:0000 0A ...
    // State 0A = LISTEN
    for line in content.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 4 {
            continue;
        }
        let state = parts[3];
        if state != "0A" {
            continue;
        }
        let local = parts[1];
        if let Some(port_hex) = local.split(':').nth(1) {
            if let Ok(port) = u16::from_str_radix(port_hex, 16) {
                ports.push(DetectedPort {
                    port,
                    hostname: "localhost".to_string(),
                });
            }
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn parse_lsof_output(output: &str, ports: &mut Vec<DetectedPort>) {
    for line in output.lines() {
        if let Some(name) = line.strip_prefix('n') {
            if let Some(port_str) = name.rsplit(':').next() {
                if let Ok(port) = port_str.parse::<u16>() {
                    ports.push(DetectedPort {
                        port,
                        hostname: "localhost".to_string(),
                    });
                }
            }
        }
    }
}
