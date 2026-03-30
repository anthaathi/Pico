# Pico

A mobile companion app for [pi-coding-agent](https://github.com/badlogic/pi-mono/). Run the server on your machine, scan the QR code from your phone, and control your coding agent remotely.

## Quick Start

### 1. Install the server

**One-line install (Linux / macOS):**

```bash
curl -fsSL https://raw.githubusercontent.com/anthaathi/pi-companion/main/install.sh | bash
```

The installer will:

1. Detect your OS and architecture
2. Download the latest release to `~/.pi/ui/`
3. Run `pi-server init` to set up credentials (first install)
4. Offer to install as a background service (systemd on Linux, launchd on macOS)
5. Add `~/.pi/ui` to your shell PATH

**Options:**

```bash
# Non-interactive (accept all defaults)
curl -fsSL .../install.sh | bash -s -- --yes

# Install without background service
curl -fsSL .../install.sh | bash -s -- --no-service

# Uninstall (removes binary, service, and PATH entry)
curl -fsSL .../install.sh | bash -s -- --uninstall
```

**Manual download:**

Grab the latest release for your platform from [Releases](https://github.com/anthaathi/pi-companion/releases):

| Platform | Binary |
|----------|--------|
| Linux x86_64 | `pi-server-linux-x86_64` |
| Linux ARM64 | `pi-server-linux-aarch64` |
| macOS Apple Silicon | `pi-server-macos-aarch64` |
| macOS Intel | `pi-server-macos-x86_64` |
| Windows | `pi-server-windows-x86_64.exe` |

```bash
chmod +x pi-server-linux-x86_64  # make executable (Linux/macOS)
```

### 2. Initialize the server

```bash
./pi-server init
```

This will prompt you for:
- **Username** (default: `admin`)
- **Password** (used to authenticate from the mobile app)

It creates a `config.toml` in the current directory.

### 3. Install pi-coding-agent

The server manages a `pi` binary. Make sure Node.js is installed, then the server can install it for you via the mobile app, or install it manually:

```bash
npm install -g @mariozechner/pi-coding-agent
```

### 4. Start the server

```bash
./pi-server
```

The server starts on port **5454** and prints a QR code in the terminal:

```
  Scan to connect:

  [QR CODE]

  pi://connect?hostname=mypc&ips=192.168.1.100&port=5454&qr_id=...&server_id=...
```

### 5. Connect from the mobile app

1. Install the Pico app on your Android device (APK available in releases)
2. Open the app and tap **Scan QR Code**
3. Scan the QR code shown in your terminal
4. Accept the pairing request in the terminal (type `y` and press Enter)
5. Log in with your username and password

You're connected! You can now create workspaces, start coding sessions, and interact with the pi-coding-agent from your phone.

## Screenshots

### Mobile — Workspace & Sessions
<p float="left">
  <img src="docs/screenshots/mobile-workspace-home.png" width="250" alt="Workspace home screen" />
  <img src="docs/screenshots/mobile-workspaces-sessions.jpeg" width="250" alt="Workspaces and session list" />
</p>

### Mobile — Chat & Settings
<p float="left">
  <img src="docs/screenshots/mobile-chat-mode.jpeg" width="250" alt="Chat mode with custom model" />
  <img src="docs/screenshots/mobile-settings.jpeg" width="250" alt="Settings - agent, custom models, appearance" />
</p>

### Tablet & Desktop
<p float="left">
  <img src="docs/screenshots/tablet-session-sidebar.jpg" width="400" alt="Tablet view with session sidebar" />
</p>

<img src="docs/screenshots/desktop-code-session.png" width="700" alt="Desktop view - code session with file preview" />

## Configuration

The `config.toml` file supports these options:

```toml
[server]
port = 5454
host = "0.0.0.0"

[auth]
username = "admin"
password_hash = "..."
access_token_ttl_minutes = 15
refresh_token_ttl_days = 30

[package]
name = "@mariozechner/pi-coding-agent"

# Optional: specify a custom pi binary path
[agent]
pi_binary = "/usr/local/bin/pi"

# Optional: custom session storage
[sessions]
base_path = "~/.pi/agent/sessions"
```

## Development

### Prerequisites

- Node.js 22+
- Yarn 4 (via Corepack: `corepack enable && corepack prepare yarn@4.9.2 --activate`)
- Rust toolchain (for the backend)
- Java 17 (for Android builds)

### Run the mobile app (dev)

```bash
yarn install
yarn start        # Expo dev server
yarn android      # run on Android
yarn web          # run in browser
```

For direct browser login links, the backend prints `http://localhost:8081/connect?...` in debug builds and uses the backend server port in release builds. Set `PI_UI_WEB_ORIGIN` to override the dev web origin if you run Expo web on a different host or port.

### Build the backend

```bash
yarn web:build              # export web assets to dist/
cd backend && cargo build --release   # builds with embedded web UI
```

### Build Android APK

```bash
eas build --platform android --profile preview --local
```

Requires Java 17 (`JAVA_HOME` must point to a JDK 17 installation).
