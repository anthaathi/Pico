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

  #clip-overlay {
    display: none;
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 300;
    align-items: center; justify-content: center;
  }
  #clip-overlay.open { display: flex; }

  #clip-panel {
    width: 90%; max-width: 360px;
    background: rgba(25,25,25,0.95);
    border-radius: 12px;
    padding: 14px;
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.1);
  }
  #clip-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 10px;
    color: #ddd; font: 13px/1.4 system-ui, sans-serif;
  }
  #clip-close {
    background: none; border: none; color: #999; font-size: 16px;
    cursor: pointer; padding: 2px 6px;
  }
  #clip-close:hover { color: #fff; }
  #clip-text {
    width: 100%; height: 100px;
    background: rgba(0,0,0,0.4); color: #eee;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 8px; padding: 10px;
    font: 13px/1.4 system-ui, -apple-system, sans-serif;
    resize: vertical;
  }
  #clip-text::placeholder { color: #666; }
  #clip-text:focus { outline: none; border-color: rgba(255,255,255,0.3); }
  #clip-actions {
    display: flex; gap: 8px; margin-top: 10px;
  }
  #clip-actions button {
    flex: 1; padding: 8px 12px;
    border-radius: 8px; border: none;
    font: 12px/1.3 system-ui, sans-serif;
    cursor: pointer;
  }
  #clip-send {
    background: #2a6cb6; color: #fff;
  }
  #clip-send:active { background: #1e5a9e; }
  #clip-type {
    background: rgba(255,255,255,0.12); color: #ccc;
  }
  #clip-type:active { background: rgba(255,255,255,0.2); }
</style>
</head>
<body>
<div id="status">Connecting…</div>
<div id="screen"></div>

<div id="menu-panel">
  <button id="btn-drag" class="active">✋ Drag Viewport</button>
  <button id="btn-kbd">⌨ Keyboard</button>
  <button id="btn-fs">⛶ Fullscreen</button>
  <button id="btn-clip">📋 Clipboard</button>
  <button id="btn-keys">⌫ Ctrl+Alt+Del</button>
</div>

<div id="clip-overlay">
  <div id="clip-panel">
    <div id="clip-header">
      <span>📋 Clipboard</span>
      <button id="clip-close">✕</button>
    </div>
    <textarea id="clip-text" placeholder="Paste or type text here…"></textarea>
    <div id="clip-actions">
      <button id="clip-send">Send to remote</button>
      <button id="clip-type">Type out text</button>
    </div>
  </div>
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
let dragMode = true;

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
  rfb.dragViewport = dragMode;

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
document.getElementById("btn-drag").addEventListener("click", () => {
  dragMode = !dragMode;
  document.getElementById("btn-drag").classList.toggle("active", dragMode);
  if (rfb) rfb.dragViewport = dragMode;
});

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

// --- Clipboard panel ---
const clipOverlay = document.getElementById("clip-overlay");
const clipText = document.getElementById("clip-text");

function openClipboard() {
  clipText.value = "";
  clipOverlay.classList.add("open");
  clipText.focus();
  // Try to pre-fill from system clipboard
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(t => {
      if (t) clipText.value = t;
    }).catch(() => {});
  }
}

function closeClipboard() {
  clipOverlay.classList.remove("open");
  if (rfb) rfb.focus();
}

document.getElementById("btn-clip").addEventListener("click", () => {
  openClipboard();
});

document.getElementById("clip-close").addEventListener("click", closeClipboard);
clipOverlay.addEventListener("click", (e) => {
  if (e.target === clipOverlay) closeClipboard();
});

// Send to remote clipboard (paste into guest clipboard)
document.getElementById("clip-send").addEventListener("click", () => {
  const text = clipText.value;
  if (text && rfb) {
    rfb.clipboardPasteFrom(text);
  }
  closeClipboard();
});

// Type out text character by character (as if typed on keyboard)
document.getElementById("clip-type").addEventListener("click", () => {
  const text = clipText.value;
  if (text && rfb) {
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (ch === '\\n') {
        rfb.sendKey(0xff0d, null, true);
        rfb.sendKey(0xff0d, null, false);
      } else {
        rfb.sendKey(code, null, true);
        rfb.sendKey(code, null, false);
      }
    }
  }
  closeClipboard();
});

document.getElementById("btn-keys").addEventListener("click", () => {
  if (rfb) rfb.sendCtrlAltDel();
});
</script>
</body>
</html>`;
}
