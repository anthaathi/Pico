use crate::config::AppConfig;
use crate::services::connection::ConnectionInfo;

pub fn print_qr(config_path: &str) -> anyhow::Result<()> {
    let path = std::path::PathBuf::from(config_path);
    let config = AppConfig::load(Some(path))?;
    let conn_info = ConnectionInfo::gather(config.server.port);
    let server_id = config.server_id().to_string();
    let qr_id = uuid::Uuid::new_v4().to_string();

    conn_info.print_qr(&qr_id, &server_id);

    println!("  Note: This QR is for display only.");
    println!("  The server generates its own rotating QR IDs at runtime.");
    println!("  Start the server to enable pairing: ./pi-server");

    Ok(())
}
