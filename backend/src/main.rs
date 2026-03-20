mod cli;
mod config;
mod db;
mod models;
mod routes;
mod server;
mod services;
mod terminal;

use clap::Parser;

use crate::cli::{Cli, Commands};

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let force_qr = cli.qr;

    match cli.command {
        Some(Commands::Init) => cli::init::run_init(),
        Some(Commands::HashPassword { password }) => {
            let hash = bcrypt::hash(&password, bcrypt::DEFAULT_COST)?;
            println!("password_hash = \"{hash}\"");
            Ok(())
        }
        None => tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()?
            .block_on(server::serve(cli, force_qr)),
    }
}
