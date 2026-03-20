pub mod init;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "pi-server", version, about = "Management server for pi-coding-agent")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Commands>,

    /// Path to config.toml
    #[arg(short, long, default_value = "config.toml")]
    pub config: String,

    /// Override listen port (default: from config or 5454)
    #[arg(short, long)]
    pub port: Option<u16>,

    /// Override listen host (default: from config or 0.0.0.0)
    #[arg(long)]
    pub host: Option<String>,

    /// Path to SQLite database file
    #[arg(long, default_value = "pi-server.db")]
    pub db: String,

    /// Print the QR code for mobile device pairing
    #[arg(long)]
    pub qr: bool,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Initialize a new config.toml with interactive prompts
    Init,
    /// Hash a password for use in config.toml
    HashPassword {
        /// The password to hash
        password: String,
    },
}
