import { useMemo } from "react";
import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

import type { PreviewTarget } from "@/features/preview/store";

interface BrowserPreviewProps {
  serverUrl: string;
  accessToken?: string;
  sessionId: string;
  target: PreviewTarget;
}

/**
 * Native preview loads from the server root with __pi_* query params.
 * The backend's fallback handler (web.rs try_preview_proxy):
 *   1. Picks up __pi_s, __pi_h, __pi_p, __pi_t from the query
 *   2. Stores them as the "active preview" config
 *   3. Proxies the request to the upstream dev server at /
 *   4. All subsequent requests (JS, CSS, images, API calls) go to
 *      the same server root — the backend uses the stored config
 *      to proxy them to the right upstream
 *
 * This means the app sees location.pathname as "/" and all absolute
 * paths work naturally.
 */
export function BrowserPreview({
  serverUrl,
  accessToken,
  sessionId,
  target,
}: BrowserPreviewProps) {
  const uri = useMemo(() => {
    // Build URL as string to avoid React Native URL constructor issues
    const base = serverUrl.replace(/\/$/, "");
    const params = [
      `__pi_s=${encodeURIComponent(sessionId)}`,
      `__pi_h=${encodeURIComponent(target.hostname)}`,
      `__pi_p=${encodeURIComponent(String(target.port))}`,
    ];
    if (accessToken) {
      params.push(`__pi_t=${encodeURIComponent(accessToken)}`);
    }
    return `${base}/?${params.join("&")}`;
  }, [serverUrl, sessionId, target.hostname, target.port, accessToken]);

  const key = `${sessionId}_${target.hostname}_${target.port}`;

  return (
    <WebView
      key={key}
      source={{ uri }}
      style={styles.webview}
      originWhitelist={["*"]}
      setSupportMultipleWindows={false}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      startInLoadingState
      allowsBackForwardNavigationGestures
    />
  );
}

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
