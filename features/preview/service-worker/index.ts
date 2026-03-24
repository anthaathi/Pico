import { useEffect, useRef } from "react";
import { Platform } from "react-native";

function log(...args: unknown[]) {
  console.log("[preview-sw-client]", ...args);
}

let swRegistered = false;

export async function registerPreviewServiceWorker(): Promise<void> {
  if (Platform.OS !== "web") return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (swRegistered) return;
  swRegistered = true;

  try {
    log("registering service worker...");
    const reg = await navigator.serviceWorker.register("/preview-sw.js", {
      scope: "/",
    });
    log("registered, active:", !!reg.active, "installing:", !!reg.installing);
    await navigator.serviceWorker.ready;
    log("service worker ready and controlling");
  } catch (err) {
    console.warn("[preview-sw-client] Registration failed:", err);
  }
}

export function buildPreviewSrc(params: {
  sessionId: string;
  hostname: string;
  port: number;
  accessToken?: string;
  serverUrl: string;
}): string {
  const qs = new URLSearchParams({
    __pi_s: params.sessionId,
    __pi_h: params.hostname,
    __pi_p: String(params.port),
    __pi_server: params.serverUrl,
  });
  if (params.accessToken) {
    qs.set("__pi_t", params.accessToken);
  }
  return `${params.serverUrl}/?${qs.toString()}`;
}

export function updatePreviewToken(accessToken: string) {
  if (Platform.OS !== "web") return;
  const controller = navigator.serviceWorker?.controller;
  if (controller) {
    controller.postMessage({ type: "UPDATE_TOKEN", accessToken });
  }
}

export function usePreviewServiceWorker() {
  const started = useRef(false);

  useEffect(() => {
    if (Platform.OS !== "web" || started.current) return;
    started.current = true;
    registerPreviewServiceWorker();
  }, []);
}

export function usePreviewTokenSync(accessToken?: string) {
  useEffect(() => {
    if (Platform.OS !== "web" || !accessToken) return;
    updatePreviewToken(accessToken);
  }, [accessToken]);
}
