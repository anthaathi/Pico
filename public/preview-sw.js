const PREVIEW_HEADER_AUTH = "X-Proxy-Authorization";

const clientToPreview = new Map();
const pendingRefreshRequests = new Map();

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
  const { type, ...payload } = event.data || {};
  log("message:", type);

  if (type === "SET_CONFIG") {
    const { sessionId, hostname, port, accessToken } = payload;
    const config = { sessionId, hostname, port, accessToken, serverUrl: self.location.origin };
    event.source && event.source.id && clientToPreview.set(event.source.id, config);
    log("SET_CONFIG stored for client:", event.source && event.source.id, hostname + ":" + port);
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

  if (type === "REFRESH_TOKEN_RESULT") {
    const { requestId, accessToken } = payload;
    const pending = pendingRefreshRequests.get(requestId);
    if (pending) {
      pendingRefreshRequests.delete(requestId);
      pending(accessToken || null);
    }
    return;
  }

  if (type === "PING") {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ type: "PONG" });
    }
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/preview-sw.js") return;

  const piSession = url.searchParams.get("__pi_s");
  if (piSession) {
    log("fetch: initial navigation", url.pathname, "session=", piSession);
    event.respondWith(handleInitialNavigation(event, url));
    return;
  }

  const clientId = event.clientId || event.resultingClientId;
  if (clientId && clientToPreview.has(clientId)) {
    log("fetch: proxy for client", clientId, url.pathname + url.search);
    event.respondWith(proxyRequest(event, clientToPreview.get(clientId), url, clientId));
    return;
  }

  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/swagger-ui") ||
    url.pathname === "/healthz" ||
    url.pathname === "/version"
  ) {
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

  return doProxyFetch(config, cleanPath, cleanSearch, event.request, true, clientId);
}

async function proxyRequest(event, config, url, clientId) {
  return doProxyFetch(config, url.pathname, url.search, event.request, false, clientId);
}

function buildProxyUrl(config, pathname, search) {
  const normalizedPath = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const base =
    "/api/agent/sessions/" +
    encodeURIComponent(config.sessionId) +
    "/preview/" +
    encodeURIComponent(config.hostname) +
    "/" +
    encodeURIComponent(String(config.port));

  return base + (normalizedPath ? "/" + normalizedPath : "") + (search || "");
}

async function requestTokenRefresh(clientId, config) {
  if (!clientId) return null;

  const client = await self.clients.get(clientId);
  if (!client) {
    log("refresh: no client for", clientId);
    return null;
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const token = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingRefreshRequests.delete(requestId);
      resolve(null);
    }, 10000);

    pendingRefreshRequests.set(requestId, (accessToken) => {
      clearTimeout(timeout);
      resolve(accessToken || null);
    });

    client.postMessage({ type: "REQUEST_TOKEN_REFRESH", requestId });
  });

  if (token) {
    config.accessToken = token;
    clientToPreview.set(clientId, config);
    log("refresh: received new token for client", clientId);
  } else {
    log("refresh: no token returned for client", clientId);
  }

  return token;
}

async function ensureAccessToken(clientId, config) {
  if (config.accessToken) {
    return config.accessToken;
  }
  return requestTokenRefresh(clientId, config);
}

async function sendProxyRequest(proxyUrl, originalRequest, config) {
  const headers = new Headers();
  for (const [key, value] of originalRequest.headers.entries()) {
    if (
      key === "host" ||
      key === "origin" ||
      key === "referer" ||
      key === "cookie" ||
      key === "authorization" ||
      key === "x-proxy-authorization" ||
      key === "x-pi-preview-session" ||
      key === "x-pi-preview-hostname" ||
      key === "x-pi-preview-port"
    ) {
      continue;
    }
    headers.set(key, value);
  }

  if (config.accessToken) {
    headers.set(PREVIEW_HEADER_AUTH, "Bearer " + config.accessToken);
  }

  let body = null;
  if (originalRequest.method !== "GET" && originalRequest.method !== "HEAD") {
    body = await originalRequest.arrayBuffer();
  }

  return fetch(proxyUrl, {
    method: originalRequest.method,
    headers,
    body,
    redirect: "manual",
  });
}

async function doProxyFetch(config, pathname, search, originalRequest, isInitial, clientId) {
  const targetUrl = pathname + (search || "");
  const proxyUrl = buildProxyUrl(config, pathname, search);

  log("proxy →", targetUrl, "via", proxyUrl);

  await ensureAccessToken(clientId, config);

  try {
    let response = await sendProxyRequest(proxyUrl, originalRequest, config);

    if (response.status === 401) {
      const refreshed = await requestTokenRefresh(clientId, config);
      if (refreshed) {
        response = await sendProxyRequest(proxyUrl, originalRequest, config);
      }
    }

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
