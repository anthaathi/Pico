import { useCallback, useMemo, useRef, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { buildVncHtml } from './vnc-html';

interface VncViewerProps {
  serverUrl: string;
  accessToken: string;
  vncPort: number;
  vncPassword?: string | null;
  onToggleFullscreen?: (fullscreen: boolean) => void;
}

export function VncViewer({ serverUrl, accessToken, vncPort, vncPassword, onToggleFullscreen }: VncViewerProps) {
  const [immersive, setImmersive] = useState(false);
  const immersiveRef = useRef(immersive);
  immersiveRef.current = immersive;

  const html = useMemo(() => {
    const url = new URL(serverUrl);
    const wsScheme = url.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${wsScheme}://${url.host}/api/desktop/ws?access_token=${encodeURIComponent(accessToken)}`;
    return buildVncHtml(wsUrl, vncPassword);
  }, [serverUrl, accessToken, vncPort, vncPassword]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'toggleFullscreen') {
        const next = !immersiveRef.current;
        setImmersive(next);
        onToggleFullscreen?.(next);
      }
    } catch {}
  }, [onToggleFullscreen]);

  const key = `vnc_${vncPort}`;

  return (
    <View style={styles.container}>
      <StatusBar hidden={immersive} />
      <WebView
        key={key}
        source={{ html, baseUrl: 'https://cdn.jsdelivr.net' }}
        style={styles.webview}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        startInLoadingState
        setSupportMultipleWindows={false}
        mixedContentMode="always"
        keyboardDisplayRequiresUserAction={false}
        scrollEnabled={false}
        automaticallyAdjustContentInsets={false}
        onMessage={handleMessage}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: '#111',
  },
});
