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

  /* Like noVNC: keep textarea in the DOM flow, inside the container,
     but visually hidden. Never move it off-screen — that causes
     mobile browsers/WebViews to consider it unfocusable and dismiss
     the keyboard on any touch. */
  #kbd-input {
    position: fixed;
    bottom: 0; left: 0;
    width: 1px; height: 1px;
    opacity: 0.01;
    font-size: 16px;
    border: none; outline: none;
    color: transparent;
    background: transparent;
    resize: none;
    z-index: -1;
    /* Prevent iOS zoom */
    transform: scale(0);
    transform-origin: bottom left;
  }
  #kbd-input.active {
    /* When keyboard is open, make it "real" enough that the OS keeps it focused */
    transform: scale(1);
    z-index: 300;
  }
</style>
</head>
<body>
<div id="status">Connecting…</div>
<div id="screen"></div>
<textarea id="kbd-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" tabindex="-1"></textarea>

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
const kbdInput = document.getElementById("kbd-input");
const menuToggle = document.getElementById("menu-toggle");
const menuPanel = document.getElementById("menu-panel");

const wsUrl = ${JSON.stringify(wsUrl)};
const vncPassword = ${JSON.stringify(vncPassword ?? '')};

let rfb;
let retries = 0;
const MAX_RETRIES = 3;
let kbdOpen = false;
let menuOpen = false;

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
    if (!kbdOpen) rfb.focus();
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

// --- Keyboard focus management ---
// When the soft keyboard is open we must prevent noVNC from stealing
// focus away from kbd-input. noVNC's RFB calls canvas.focus() on click
// and internally, which would blur the textarea and dismiss the keyboard.
let _origCanvasFocus = null;

function lockFocusToKeyboard() {
  if (!rfb) return;
  // Disable noVNC's built-in click-to-focus
  rfb.focusOnClick = false;
  // Patch the canvas focus() so internal noVNC calls are no-ops
  const canvas = target.querySelector("canvas");
  if (canvas && !_origCanvasFocus) {
    _origCanvasFocus = canvas.focus.bind(canvas);
    canvas.focus = () => {};
  }
}

function unlockFocus() {
  if (!rfb) return;
  rfb.focusOnClick = true;
  const canvas = target.querySelector("canvas");
  if (canvas && _origCanvasFocus) {
    canvas.focus = _origCanvasFocus;
    _origCanvasFocus = null;
  }
}

// Use touchstart (fires before blur) so we can keep focus on the textarea.
function onScreenTap(e) {
  if (kbdOpen) {
    e.preventDefault();
    e.stopPropagation();
    kbdInput.focus({ preventScroll: true });
  } else if (rfb) {
    rfb.focus();
  }
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "tap" }));
  }
}
target.addEventListener("touchstart", onScreenTap, { capture: true, passive: false });
target.addEventListener("mousedown", (e) => {
  if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
  onScreenTap(e);
}, { capture: true });

// --- Mobile keyboard ---
function toggleKeyboard() {
  kbdOpen = !kbdOpen;
  document.getElementById("btn-kbd").classList.toggle("active", kbdOpen);
  kbdInput.classList.toggle("active", kbdOpen);
  if (kbdOpen) {
    lockFocusToKeyboard();
    kbdInput.value = "";
    kbdInput.focus({ preventScroll: true });
  } else {
    unlockFocus();
    kbdInput.blur();
    if (rfb) rfb.focus();
  }
}

kbdInput.addEventListener("input", (e) => {
  if (!rfb || !e.data) return;
  for (const ch of e.data) {
    const code = ch.charCodeAt(0);
    rfb.sendKey(code, null, true);
    rfb.sendKey(code, null, false);
  }
  kbdInput.value = "";
});

kbdInput.addEventListener("keydown", (e) => {
  if (!rfb) return;
  const map = {
    Enter: KeyTable.XK_Return, Backspace: KeyTable.XK_BackSpace,
    Tab: KeyTable.XK_Tab, Escape: KeyTable.XK_Escape,
    ArrowUp: KeyTable.XK_Up, ArrowDown: KeyTable.XK_Down,
    ArrowLeft: KeyTable.XK_Left, ArrowRight: KeyTable.XK_Right,
  };
  const keysym = map[e.key];
  if (keysym) {
    e.preventDefault();
    rfb.sendKey(keysym, null, true);
    rfb.sendKey(keysym, null, false);
  }
});

// --- Fullscreen (sends message to parent for native immersive) ---
document.getElementById("btn-kbd").addEventListener("click", () => { toggleKeyboard(); });

document.getElementById("btn-fs").addEventListener("click", () => {
  // In React Native WebView, always use the native immersive toggle
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "toggleFullscreen" }));
    return;
  }
  // Browser fallback (web platform)
  const el = document.documentElement;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else if (el.requestFullscreen) {
    el.requestFullscreen().catch(() => {});
  }
});

document.getElementById("btn-clip").addEventListener("click", async () => {
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
