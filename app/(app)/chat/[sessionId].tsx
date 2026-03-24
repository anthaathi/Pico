import React, { useCallback, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResponsiveLayout } from '@/features/navigation/hooks/use-responsive-layout';
import { MessageList } from '@/features/agent/components/message-list';
import { ChatShimmer } from '@/features/agent/components/message-list/chat-shimmer';
import { PromptInput } from '@/features/workspace/components/prompt-input';
import { ExtensionUiDialog } from '@/features/agent/components/extension-ui-dialog';
import { DiffPanelProvider } from '@/features/agent/components/diff-panel/context';
import { MobileDiffSheetProvider } from '@/features/agent/components/message-list/mobile-diff-sheet';
import { useAgentSession, useChatSessions, useConnection } from '@pi-ui/client';
import { useChatStore } from '@/features/chat/store';
import { useWorkspaceStore } from '@/features/workspace/store';
import type { PendingExtensionUiRequest as LegacyPendingUiRequest } from '@/features/agent/extension-ui';

export default function ChatSessionScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const { isWideScreen } = useResponsiveLayout();
  const insets = useSafeAreaInsets();

  const selectSession = useChatStore((s) => s.selectSession);
  const registerSessionWorkspace = useWorkspaceStore((s) => s.registerSessionWorkspace);
  const { invalidate: invalidateChatSessions } = useChatSessions();
  const [alertMessage, setAlertMessage] = React.useState<string | null>(null);

  const session = useAgentSession(sessionId ?? null, {
    sessionFile: sessionId ?? '',
  });

  const connection = useConnection();
  const inputBlocked = connection.status === 'reconnecting' || connection.status === 'disconnected';

  useEffect(() => {
    if (!sessionId) return;
    selectSession(sessionId);
    registerSessionWorkspace(sessionId, '__chat__');
  }, [sessionId, selectSession, registerSessionWorkspace]);

  const handleSend = useCallback(
    async (text: string, _attachments: unknown[], options?: { queueBehavior?: 'steer' | 'followUp' }) => {
      if (!sessionId || inputBlocked) return;
      setAlertMessage(null);

      const isFirst = !session.messages.length;
      const behavior = options?.queueBehavior ?? (session.isStreaming ? 'steer' : undefined);
      const sendFn = behavior === 'steer'
        ? session.steer
        : behavior === 'followUp'
          ? session.followUp
          : session.prompt;

      try {
        await sendFn(text);
        if (isFirst) setTimeout(() => invalidateChatSessions(), 2000);
      } catch (error) {
        setAlertMessage(error instanceof Error ? error.message : 'Failed to send prompt');
        throw error;
      }
    },
    [sessionId, inputBlocked, session, invalidateChatSessions],
  );

  const handleAbort = useCallback(() => {
    if (!sessionId) return;
    setAlertMessage(null);
    session.abort().catch((error) => {
      setAlertMessage(error instanceof Error ? error.message : 'Failed to abort');
    });
  }, [sessionId, session]);

  const clearAlert = useCallback(() => setAlertMessage(null), []);

  const editorBg = isDark ? '#151515' : '#FAFAFA';
  const hasMessages = session.messages.length > 0;

  const keyboardPadding = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      const height = Platform.OS === 'ios' ? e.endCoordinates.height - insets.bottom : e.endCoordinates.height;
      Animated.spring(keyboardPadding, { toValue: height, tension: 160, friction: 20, useNativeDriver: false }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      Animated.spring(keyboardPadding, { toValue: 0, tension: 160, friction: 20, useNativeDriver: false }).start();
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, [keyboardPadding, insets.bottom]);

  return (
    <DiffPanelProvider messages={session.messages as any[]}>
    <MobileDiffSheetProvider>
    <Animated.View
      style={[styles.container, { backgroundColor: isDark ? '#121212' : colors.background, paddingBottom: isWideScreen ? 0 : Animated.add(keyboardPadding, insets.bottom) }]}
    >
      <View style={[styles.editorColumn, { backgroundColor: editorBg }]}>
        {hasMessages && sessionId ? (
          <MessageList key={sessionId} sessionId={sessionId} />
        ) : session.isLoading || (!session.isReady && sessionId) ? (
          Platform.OS === 'ios' ? (
            <View style={styles.emptyCenter}>
              <ActivityIndicator size="small" />
            </View>
          ) : (
            <ChatShimmer />
          )
        ) : (
          <View style={styles.emptyCenter} />
        )}
        <ExtensionUiDialog sessionId={sessionId} request={session.pendingExtensionUiRequest as LegacyPendingUiRequest | null} />
        <PromptInput
          sessionId={sessionId}
          onSend={handleSend}
          isStreaming={session.isStreaming}
          onAbort={handleAbort}
          sessionReady={session.isReady}
          disabled={inputBlocked || !session.isReady || !!session.pendingExtensionUiRequest}
          allowTypingWhileDisabled={!inputBlocked}
          stackedAbove={!!session.pendingExtensionUiRequest}
          errorMessage={alertMessage}
          onClearError={clearAlert}
        />
      </View>
    </Animated.View>
    </MobileDiffSheetProvider>
    </DiffPanelProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  editorColumn: { flex: 1 },
  emptyCenter: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const },
});
