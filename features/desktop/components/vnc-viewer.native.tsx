import { useCallback, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextInputChangeEventData,
} from 'react-native';
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

  const [kbdVisible, setKbdVisible] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const inputRef = useRef<TextInput>(null);
  const lastTextRef = useRef('');

  const html = useMemo(() => {
    const url = new URL(serverUrl);
    const wsScheme = url.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${wsScheme}://${url.host}/api/desktop/ws?access_token=${encodeURIComponent(accessToken)}`;
    return buildVncHtml(wsUrl, vncPassword);
  }, [serverUrl, accessToken, vncPort, vncPassword]);

  const injectJS = useCallback((js: string) => {
    webViewRef.current?.injectJavaScript(`${js}; true;`);
  }, []);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'toggleFullscreen') {
        const next = !immersiveRef.current;
        setImmersive(next);
        onToggleFullscreen?.(next);
      } else if (data.type === 'keyboard') {
        const visible = !!data.visible;
        setKbdVisible(visible);
        if (visible) {
          // Small delay to ensure state update before focus
          setTimeout(() => inputRef.current?.focus(), 50);
        } else {
          inputRef.current?.blur();
        }
      }
    } catch {}
  }, [onToggleFullscreen]);

  // Handle text changes (characters typed)
  const handleChange = useCallback((e: NativeSyntheticEvent<TextInputChangeEventData>) => {
    const newText = e.nativeEvent.text;
    const oldText = lastTextRef.current;

    if (newText.length > oldText.length) {
      // Characters were added
      const added = newText.slice(oldText.length);
      const escaped = JSON.stringify(added);
      injectJS(`window._vncSendText(${escaped})`);
    } else if (newText.length < oldText.length) {
      // Characters were deleted (backspace)
      const deleted = oldText.length - newText.length;
      for (let i = 0; i < deleted; i++) {
        injectJS(`window._vncSendKey("Backspace")`);
      }
    }

    lastTextRef.current = newText;
  }, [injectJS]);

  // Handle special keys (Enter, arrows, etc.)
  const handleKeyPress = useCallback((e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const { key } = e.nativeEvent;

    // Special keys that aren't captured by onChange
    const specialKeys = [
      'Enter', 'Tab', 'Escape',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Delete', 'Home', 'End', 'PageUp', 'PageDown',
    ];

    if (specialKeys.includes(key)) {
      const escaped = JSON.stringify(key);
      injectJS(`window._vncSendKey(${escaped})`);
    }
  }, [injectJS]);

  // When native keyboard is dismissed (blur), sync state to WebView
  const handleInputBlur = useCallback(() => {
    if (kbdVisible) {
      setKbdVisible(false);
      injectJS(`window._vncSetKeyboardState(false)`);
    }
  }, [kbdVisible, injectJS]);

  const key = `vnc_${vncPort}`;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar hidden={immersive} />
      <WebView
        ref={webViewRef}
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
      {/* Native TextInput for keyboard — positioned off-screen but focusable */}
      <TextInput
        ref={inputRef}
        style={styles.hiddenInput}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        blurOnSubmit={false}
        multiline
        onChange={handleChange}
        onKeyPress={handleKeyPress}
        onBlur={handleInputBlur}
        // Keep a buffer of underscores so backspace works
        defaultValue="______"
      />
    </KeyboardAvoidingView>
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
  hiddenInput: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: 1,
    height: 1,
    opacity: 0.01,
    fontSize: 16,
  },
});
