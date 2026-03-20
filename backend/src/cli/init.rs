use crate::config;
use crate::terminal::{prompt_input, prompt_password};

pub fn run_init() -> anyhow::Result<()> {
    let config_path = std::path::PathBuf::from("config.toml");

    if config_path.exists() {
        eprintln!("config.toml already exists. Remove it first if you want to reinitialize.");
        std::process::exit(1);
    }

    println!("=== pi-server init ===");
    println!();

    let username = prompt_input("Username [admin]: ").unwrap_or_else(|| "admin".to_string());

    let password = prompt_password("Password: ");
    if password.is_empty() {
        eprintln!("Password cannot be empty.");
        std::process::exit(1);
    }

    let confirm = prompt_password("Confirm password: ");
    if password != confirm {
        eprintln!("Passwords do not match.");
        std::process::exit(1);
    }

    let host = prompt_input("Host [0.0.0.0]: ").unwrap_or_else(|| "0.0.0.0".to_string());

    let port: u16 = prompt_input("Port [5454]: ")
        .and_then(|s| s.parse().ok())
        .unwrap_or(5454);

    let hash = bcrypt::hash(&password, bcrypt::DEFAULT_COST)?;

    let config = config::AppConfig {
        server: config::ServerConfig {
            port,
            host,
            server_id: Some(uuid::Uuid::new_v4().to_string()),
        },
        auth: config::AuthConfig {
            username,
            password_hash: hash,
            access_token_ttl_minutes: 15,
            refresh_token_ttl_days: 30,
            session_ttl_hours: None,
        },
        package: config::PackageConfig {
            name: "@mariozechner/pi-coding-agent".to_string(),
            install_command: None,
        },
        sessions: None,
        agent: None,
        chat: None,
    };

    let toml_str = toml::to_string_pretty(&config)?;
    std::fs::write(&config_path, &toml_str)?;

    println!();
    println!("config.toml created successfully.");
    println!("Run: ./pi-server");

    Ok(())
}
