use std::io::Write;

pub fn prompt_input(prompt: &str) -> Option<String> {
    print!("{}", prompt);
    std::io::stdout().flush().unwrap();
    let mut input = String::new();
    std::io::stdin().read_line(&mut input).ok()?;
    let trimmed = input.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn prompt_password(prompt: &str) -> String {
    print!("{}", prompt);
    std::io::stdout().flush().unwrap();

    #[cfg(unix)]
    {
        let mut password = String::new();
        unsafe {
            let mut termios: libc::termios = std::mem::zeroed();
            let ret = libc::tcgetattr(libc::STDIN_FILENO, &mut termios);
            if ret != 0 {
                std::io::stdin().read_line(&mut password).ok();
                return password.trim().to_string();
            }
            let mut no_echo = termios;
            no_echo.c_lflag &= !(libc::ECHO);
            libc::tcsetattr(libc::STDIN_FILENO, libc::TCSANOW, &no_echo);

            std::io::stdin().read_line(&mut password).ok();

            libc::tcsetattr(libc::STDIN_FILENO, libc::TCSANOW, &termios);

            println!();
        }
        password.trim().to_string()
    }

    #[cfg(not(unix))]
    {
        let mut password = String::new();
        std::io::stdin().read_line(&mut password).ok();
        password.trim().to_string()
    }
}

pub async fn prompt_terminal_approval() -> bool {
    println!();
    println!("  ╔══════════════════════════════════════════╗");
    println!("  ║  PAIRING REQUEST from mobile device      ║");
    println!("  ║  Accept? (y/n):                          ║");
    println!("  ╚══════════════════════════════════════════╝");
    print!("  > ");

    std::io::stdout().flush().unwrap();

    let result = tokio::task::spawn_blocking(|| {
        let mut input = String::new();
        std::io::stdin().read_line(&mut input).ok();
        let trimmed = input.trim().to_lowercase();
        trimmed == "y" || trimmed == "yes"
    })
    .await;

    match result {
        Ok(accepted) => {
            if accepted {
                println!("  Pairing ACCEPTED");
            } else {
                println!("  Pairing REJECTED");
            }
            accepted
        }
        Err(_) => {
            println!("  Pairing FAILED (input error)");
            false
        }
    }
}
