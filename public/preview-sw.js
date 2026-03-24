const PREVIEW_HEADER_SESSION = "X-Pi-Preview-Session";
const PREVIEW_HEADER_HOSTNAME = "X-Pi-Preview-Hostname";
const PREVIEW_HEADER_PORT = "X-Pi-Preview-Port";
const PREVIEW_HEADER_AUTH = "X-Proxy-Authorization";

const clientToPreview = new Map();

function log(...args) {
  console.log("[preview-sw]", ...args);
}

self.addEventListener("install", () => {
  log("install — skipWaiting");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  log("activate — claiming clients");
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const { type, ...payload } = event.data;
  log("message:", type);

  if (type === "SET_CONFIG") {
    const { sessionId, hostname, port, accessToken } = payload;
    const config = { sessionId, hostname, port, accessToken, serverUrl: self.location.origin };
    event.source && event.source.id && clientToPreview.set(event.source.id, config);
    // Also set as default for any future clients
    self.__defaultConfig = config;
    log("SET_CONFIG stored:", hostname + ":" + port);
    return;
  }

  if (type === "UPDATE_TOKEN") {
    const { accessToken } = payload;
    for (const [, config] of clientToPreview.entries()) {
      config.accessToken = accessToken;
    }
    log("token updated for", clientToPreview.size, "clients");
    return;
  }

  if (type === "PING") {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ type: "PONG" });
    }
    return;
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/swagger-ui") ||
    url.pathname === "/healthz" ||
    url.pathname === "/version" ||
    url.pathname === "/preview-sw.js"
  ) {
    return;
  }

  const piSession = url.searchParams.get("__pi_s");
  if (piSession) {
    log("fetch: initial navigation", url.pathname, "session=", piSession);
    event.respondWith(handleInitialNavigation(event, url));
    return;
  }

  const clientId = event.clientId || event.resultingClientId;
  if (clientId && clientToPreview.has(clientId)) {
    log("fetch: proxy for client", clientId, url.pathname + url.search);
    event.respondWith(proxyRequest(event, clientToPreview.get(clientId), url));
    return;
  }

  // Fallback: use default config for any request on this origin
  if (self.__defaultConfig) {
    log("fetch: proxy via defaultConfig", url.pathname + url.search);
    if (clientId) {
      clientToPreview.set(clientId, self.__defaultConfig);
    }
    event.respondWith(proxyRequest(event, self.__defaultConfig, url));
    return;
  }
});

function parseConfigFromUrl(url) {
  return {
    sessionId: url.searchParams.get("__pi_s"),
    hostname: url.searchParams.get("__pi_h") || "localhost",
    port: url.searchParams.get("__pi_p"),
    accessToken: url.searchParams.get("__pi_t"),
    serverUrl: url.searchParams.get("__pi_server"),
  };
}

async function handleInitialNavigation(event, url) {
  const config = parseConfigFromUrl(url);
  log("initial nav config:", JSON.stringify(config));

  if (!config.sessionId || !config.port || !config.serverUrl) {
    log("ERROR: missing config params, passing through");
    return fetch(event.request);
  }

  const clientId = event.resultingClientId || event.clientId;
  if (clientId) {
    clientToPreview.set(clientId, config);
    log("mapped client", clientId, "→", config.hostname + ":" + config.port);
  }

  const cleanUrl = new URL(url);
  cleanUrl.searchParams.delete("__pi_s");
  cleanUrl.searchParams.delete("__pi_h");
  cleanUrl.searchParams.delete("__pi_p");
  cleanUrl.searchParams.delete("__pi_t");
  cleanUrl.searchParams.delete("__pi_server");
  const cleanPath = cleanUrl.pathname;
  const cleanSearch = cleanUrl.search;

  return doProxyFetch(config, cleanPath, cleanSearch, event.request, true);
}

async function proxyRequest(event, config, url) {
  return doProxyFetch(config, url.pathname, url.search, event.request, false);
}

async function doProxyFetch(config, pathname, search, originalRequest, isInitial) {
  const targetUrl = pathname + (search || "");

  log("proxy →", targetUrl);

  const headers = new Headers();
  for (const [key, value] of originalRequest.headers.entries()) {
    if (key === "host" || key === "origin" || key === "referer") continue;
    headers.set(key, value);
  }

  headers.set(PREVIEW_HEADER_SESSION, config.sessionId);
  headers.set(PREVIEW_HEADER_HOSTNAME, config.hostname);
  headers.set(PREVIEW_HEADER_PORT, String(config.port));
  if (config.accessToken) {
    headers.set(PREVIEW_HEADER_AUTH, "Bearer " + config.accessToken);
  }

  let body = null;
  if (originalRequest.method !== "GET" && originalRequest.method !== "HEAD") {
    body = await originalRequest.arrayBuffer();
  }

  try {
    const response = await fetch(targetUrl, {
      method: originalRequest.method,
      headers,
      body,
      redirect: "manual",
    });

    log("proxy response:", response.status, "for", pathname);

    const contentType = response.headers.get("content-type") || "";
    if (isInitial && contentType.includes("text/html")) {
      return injectHistoryReplace(response, pathname);
    }

    return response;
  } catch (err) {
    log("ERROR: proxy fetch failed:", err.message, "url:", targetUrl);
    return new Response("Preview proxy error: " + err.message, {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

async function injectHistoryReplace(response, cleanPath) {
  const html = await response.text();
  const normalizedPath = cleanPath.split("?")[0] || "/";
  const script = '<script>history.replaceState(null,"","' + normalizedPath + '")</script>';
  const injected = html.replace(/(<head[^>]*>)/i, "$1" + script);

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-encoding");

  return new Response(injected, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

setInterval(async () => {
  const activeClients = await self.clients.matchAll({ type: "all" });
  const activeIds = new Set(activeClients.map((c) => c.id));
  let cleaned = 0;
  for (const clientId of clientToPreview.keys()) {
    if (!activeIds.has(clientId)) {
      clientToPreview.delete(clientId);
      cleaned++;
    }
  }
  if (cleaned > 0) log("cleaned", cleaned, "stale clients");
}, 60000);
