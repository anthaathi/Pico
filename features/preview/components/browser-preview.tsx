import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import type { PreviewTarget } from "@/features/preview/store";
import { buildPreviewUrl } from "@/features/preview/utils";

interface BrowserPreviewProps {
  serverUrl: string;
  accessToken?: string;
  sessionId: string;
  target: PreviewTarget;
}

export function BrowserPreview({ serverUrl, accessToken, sessionId, target }: BrowserPreviewProps) {
  const src = useMemo(
    () => buildPreviewUrl({ serverUrl, accessToken, sessionId, target }),
    [accessToken, serverUrl, sessionId, target],
  );

  return (
    <View style={styles.container}>
      <iframe
        src={src}
        title={`Preview ${target.label}`}
        style={iframeStyle as unknown as React.CSSProperties}
        sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-popups allow-downloads"
        allow="clipboard-read; clipboard-write"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

const iframeStyle = {
  width: "100%",
  height: "100%",
  border: "none",
  backgroundColor: "transparent",
};
