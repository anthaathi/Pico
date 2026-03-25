export function buildVncHtml(wsUrl: string, vncPassword?: string | null): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<meta name="apple-mobile-web-app-capable" content="yes">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #111; position: fixed; inset: 0; }
  #screen { position: fixed; inset: 0; }
  #status {
    position: fixed; top: 0; left: 0; right: 0;
    padding: 6px 12px;
    font: 12px/1.4 system-ui, -apple-system, sans-serif;
    color: #aaa; background: rgba(0,0,0,0.7);
    z-index: 100; text-align: center;
    transition: opacity 0.3s;
  }
  #status.connected { opacity: 0; pointer-events: none; }
  #status button {
    background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3);
    color: #fff; padding: 4px 14px; border-radius: 5px; margin-left: 8px;
    font: 12px/1.4 system-ui, sans-serif; cursor: pointer;
  }

  #menu-toggle {
    position: fixed; left: 0; top: 50%; transform: translateY(-50%);
    width: 24px; height: 56px; z-index: 200;
    background: rgba(30,30,30,0.7); border: none;
    border-radius: 0 8px 8px 0;
    color: #aaa; font-size: 14px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.2s;
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  }
  #menu-toggle:hover { background: rgba(50,50,50,0.85); color: #fff; }
  #menu-toggle.open { left: 160px; border-radius: 0 8px 8px 0; }

  #menu-panel {
    position: fixed; left: -160px; top: 50%; transform: translateY(-50%);
    width: 160px; z-index: 199;
    background: rgba(25,25,25,0.9); border-radius: 0 10px 10px 0;
    padding: 6px 0; transition: left 0.2s ease;
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    border-right: 1px solid rgba(255,255,255,0.08);
  }
  #menu-panel.open { left: 0; }

  #menu-panel button {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 10px 14px; border: none;
    background: transparent; color: #ccc;
    font: 12px/1.3 system-ui, -apple-system, sans-serif;
    cursor: pointer; text-align: left;
  }
  #menu-panel button:hover { background: rgba(255,255,255,0.08); color: #fff; }
  #menu-panel button:active { background: rgba(255,255,255,0.12); }
  #menu-panel button.active { color: #4fc3f7; }
</style>
</head>
<body>
<div id="status">Connecting…</div>
<div id="screen"></div>

<div id="menu-panel">
  <button id="btn-kbd">⌨ Keyboard</button>
  <button id="btn-fs">⛶ Fullscreen</button>
  <button id="btn-clip">📋 Paste</button>
  <button id="btn-keys">⌫ Ctrl+Alt+Del</button>
</div>
<button id="menu-toggle">▶</button>

<script type="module">
import RFB from "https://cdn.jsdelivr.net/gh/novnc/noVNC@v1.5.0/core/rfb.js";
import KeyTable from "https://cdn.jsdelivr.net/gh/novnc/noVNC@v1.5.0/core/input/keysym.js";

const target = document.getElementById("screen");
const status = document.getElementById("status");
const menuToggle = document.getElementById("menu-toggle");
const menuPanel = document.getElementById("menu-panel");

const wsUrl = ${JSON.stringify(wsUrl)};
const vncPassword = ${JSON.stringify(vncPassword ?? '')};

let rfb;
let retries = 0;
const MAX_RETRIES = 3;
let menuOpen = false;
let kbdOpen = false;

// --- Menu ---
function toggleMenu() {
  menuOpen = !menuOpen;
  menuPanel.classList.toggle("open", menuOpen);
  menuToggle.classList.toggle("open", menuOpen);
  menuToggle.textContent = menuOpen ? "◀" : "▶";
}
menuToggle.addEventListener("click", toggleMenu);

// --- VNC Connection ---
function connect() {
  status.textContent = "Connecting…";
  status.className = "";

  const opts = {};
  if (vncPassword) {
    opts.credentials = { password: vncPassword };
  }
  rfb = new RFB(target, wsUrl, opts);
  rfb.scaleViewport = true;
  rfb.resizeSession = false;
  rfb.clipViewport = true;

  rfb.addEventListener("connect", () => {
    retries = 0;
    status.textContent = "Connected";
    status.classList.add("connected");
    rfb.focus();
  });

  rfb.addEventListener("disconnect", (e) => {
    status.classList.remove("connected");
    if (e.detail.clean) {
      status.innerHTML = 'Disconnected <button onclick="retries=0;connect()">Reconnect</button>';
    } else if (retries < MAX_RETRIES) {
      retries++;
      status.textContent = "Connection lost — retrying (" + retries + "/" + MAX_RETRIES + ")…";
      setTimeout(connect, 2000);
    } else {
      status.innerHTML = 'Connection lost <button onclick="retries=0;connect()">Reconnect</button>';
    }
  });

  rfb.addEventListener("credentialsrequired", () => {
    rfb.sendCredentials({ password: vncPassword });
  });
}
connect();

// --- Keysym map for special keys ---
const KEYSYM_MAP = {
  Enter: KeyTable.XK_Return,
  Backspace: KeyTable.XK_BackSpace,
  Tab: KeyTable.XK_Tab,
  Escape: KeyTable.XK_Escape,
  ArrowUp: KeyTable.XK_Up,
  ArrowDown: KeyTable.XK_Down,
  ArrowLeft: KeyTable.XK_Left,
  ArrowRight: KeyTable.XK_Right,
  Delete: KeyTable.XK_Delete,
  Home: KeyTable.XK_Home,
  End: KeyTable.XK_End,
  PageUp: KeyTable.XK_Page_Up,
  PageDown: KeyTable.XK_Page_Down,
  F1: KeyTable.XK_F1, F2: KeyTable.XK_F2, F3: KeyTable.XK_F3,
  F4: KeyTable.XK_F4, F5: KeyTable.XK_F5, F6: KeyTable.XK_F6,
  F7: KeyTable.XK_F7, F8: KeyTable.XK_F8, F9: KeyTable.XK_F9,
  F10: KeyTable.XK_F10, F11: KeyTable.XK_F11, F12: KeyTable.XK_F12,
};

// API for React Native to send keystrokes (called via injectJavaScript)
window._vncSendKey = function(key) {
  if (!rfb) return;
  const sym = KEYSYM_MAP[key];
  if (sym) {
    rfb.sendKey(sym, null, true);
    rfb.sendKey(sym, null, false);
  }
};

window._vncSendText = function(text) {
  if (!rfb) return;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    rfb.sendKey(code, null, true);
    rfb.sendKey(code, null, false);
  }
};

window._vncSendCtrlAltDel = function() {
  if (rfb) rfb.sendCtrlAltDel();
};

window._vncPaste = function(text) {
  if (rfb && text) rfb.clipboardPasteFrom(text);
};

// Notify React Native about taps (for toolbar show)
target.addEventListener("click", () => {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "tap" }));
  }
});

// --- Keyboard toggle: managed by React Native, just track state for UI ---
document.getElementById("btn-kbd").addEventListener("click", () => {
  kbdOpen = !kbdOpen;
  document.getElementById("btn-kbd").classList.toggle("active", kbdOpen);
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: "keyboard",
      visible: kbdOpen,
    }));
  }
});

// React Native can tell us keyboard was dismissed
window._vncSetKeyboardState = function(open) {
  kbdOpen = open;
  document.getElementById("btn-kbd").classList.toggle("active", kbdOpen);
};

document.getElementById("btn-fs").addEventListener("click", () => {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "toggleFullscreen" }));
    return;
  }
  const el = document.documentElement;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else if (el.requestFullscreen) {
    el.requestFullscreen().catch(() => {});
  }
});

document.getElementById("btn-clip").addEventListener("click", async () => {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "paste" }));
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    if (text && rfb) rfb.clipboardPasteFrom(text);
  } catch {}
});

document.getElementById("btn-keys").addEventListener("click", () => {
  if (rfb) rfb.sendCtrlAltDel();
});
</script>
</body>
</html>`;
}
