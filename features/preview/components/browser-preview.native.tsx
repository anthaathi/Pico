import { useMemo } from "react";
import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

import type { PreviewTarget } from "@/features/preview/store";
import { buildPreviewUrl } from "@/features/preview/utils";

interface BrowserPreviewProps {
  serverUrl: string;
  accessToken?: string;
  sessionId: string;
  target: PreviewTarget;
}

export function BrowserPreview({ serverUrl, accessToken, sessionId, target }: BrowserPreviewProps) {
  const uri = useMemo(
    () => buildPreviewUrl({ serverUrl, accessToken, sessionId, target }),
    [accessToken, serverUrl, sessionId, target],
  );

  return (
    <WebView
      source={{ uri }}
      style={styles.webview}
      originWhitelist={["*"]}
      setSupportMultipleWindows={false}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
    />
  );
}

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
