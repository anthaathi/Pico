import { useCallback, useEffect, useRef } from 'react';
import {
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
import {
  useSendPrompt,
  useAbortAgent,
  type PromptStreamingBehavior,
} from '@/features/agent/hooks/use-agent-session';
import { useAgentStore } from '@/features/agent/store';
import { useChatStore } from '@/features/chat/store';
import { useChatSessions } from '@/features/chat/hooks/use-chat-sessions';
import { touchChatSession } from '@/features/chat/api';
import {
  getMessages as apiGetMessages,
  getState as apiGetState,
} from '@/features/api/generated/sdk.gen';
import { unwrapApiData } from '@/features/api/unwrap';
import { parsePendingExtensionUiRequest } from '@/features/agent/extension-ui';
import { useWorkspaceStore } from '@/features/workspace/store';
import type { ChatMessage } from '@/features/agent/types';

const EMPTY_MESSAGES: ChatMessage[] = [];

export default function ChatSessionScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const { isWideScreen } = useResponsiveLayout();
  const insets = useSafeAreaInsets();

  const selectSession = useChatStore((s) => s.selectSession);
  const setHistoryMessages = useAgentStore((s) => s.setHistoryMessages);
  const setAlertMessage = useAgentStore((s) => s.setAlertMessage);
  const setPendingExtensionUiRequest = useAgentStore((s) => s.setPendingExtensionUiRequest);
  const registerSessionWorkspace = useWorkspaceStore((s) => s.registerSessionWorkspace);
  const { invalidate: invalidateChatSessions } = useChatSessions();

  const isStreaming = useAgentStore((s) => s.streaming[sessionId ?? ''] ?? false);
  const messages = useAgentStore((s) => s.messages[sessionId ?? ''] ?? EMPTY_MESSAGES);
  const pendingExtensionUiRequest = useAgentStore(
    (s) => s.pendingExtensionUiRequests[sessionId ?? ''] ?? null,
  );
  const connectionStatus = useAgentStore((s) => s.connection.status);
  const inputBlocked = connectionStatus === 'reconnecting' || connectionStatus === 'disconnected';

  const sendPromptMutation = useSendPrompt();
  const abortAgent = useAbortAgent();
  const touchedRef = useRef<string | null>(null);
  const [isReady, setIsReady] = React.useState(false);

  useEffect(() => {
    if (!sessionId) return;
    selectSession(sessionId);
    registerSessionWorkspace(sessionId, '__chat__');
  }, [sessionId, selectSession, registerSessionWorkspace]);

  useEffect(() => {
    if (!sessionId) return;
    if (touchedRef.current === sessionId) return;
    touchedRef.current = sessionId;
    setIsReady(false);

    let cancelled = false;

    (async () => {
      const msgs = await apiGetMessages({ body: { session_id: sessionId } });
      if (!cancelled && !msgs.error) {
        const data = unwrapApiData(msgs.data) as Record<string, any> | undefined;
        if (data?.messages) setHistoryMessages(sessionId, data.messages);
      }

      try {
        await touchChatSession(sessionId, '');
      } catch {}

      const stateResult = await apiGetState({ body: { session_id: sessionId } });
      if (!cancelled && !stateResult.error) {
        const data = unwrapApiData(stateResult.data) as Record<string, unknown> | undefined;
        setPendingExtensionUiRequest(
          sessionId,
          parsePendingExtensionUiRequest(data?.pendingExtensionUiRequest),
        );
      }

      if (!cancelled) setIsReady(true);
    })();

    return () => { cancelled = true; };
  }, [sessionId, setHistoryMessages, setPendingExtensionUiRequest]);

  const handleSend = useCallback(
    (text: string, _attachments: unknown[], options?: { queueBehavior?: PromptStreamingBehavior }) => {
      if (!sessionId || inputBlocked) return;
      setAlertMessage(null);

      const isFirst = !messages.length;

      sendPromptMutation.mutate(
        {
          sessionId,
          message: text,
          streamingBehavior: options?.queueBehavior ?? (isStreaming ? 'steer' : undefined),
        },
        {
          onSuccess: () => {
            if (isFirst) setTimeout(() => invalidateChatSessions(), 2000);
          },
          onError: (error) => {
            setAlertMessage(error instanceof Error ? error.message : 'Failed to send prompt');
          },
        },
      );
    },
    [sessionId, inputBlocked, isStreaming, messages.length, sendPromptMutation, setAlertMessage, invalidateChatSessions],
  );

  const handleAbort = useCallback(() => {
    if (!sessionId) return;
    setAlertMessage(null);
    abortAgent.mutate(sessionId, {
      onError: (error) => {
        setAlertMessage(error instanceof Error ? error.message : 'Failed to abort');
      },
    });
  }, [sessionId, abortAgent, setAlertMessage]);

  const editorBg = isDark ? '#151515' : '#FAFAFA';
  const hasMessages = messages.length > 0;

  const keyboardPadding = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      Animated.spring(keyboardPadding, {
        toValue: e.endCoordinates.height, tension: 160, friction: 20, useNativeDriver: false,
      }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      Animated.spring(keyboardPadding, {
        toValue: 0, tension: 160, friction: 20, useNativeDriver: false,
      }).start();
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, [keyboardPadding]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? '#121212' : colors.background,
          paddingBottom: isWideScreen ? 0 : Animated.add(keyboardPadding, insets.bottom),
        },
      ]}
    >
      <View style={[styles.editorColumn, { backgroundColor: editorBg }]}>
        {hasMessages && sessionId ? (
          <MessageList key={sessionId} sessionId={sessionId} />
        ) : !isReady ? (
          <ChatShimmer />
        ) : (
          <View style={styles.emptyCenter} />
        )}
        <ExtensionUiDialog sessionId={sessionId} request={pendingExtensionUiRequest} />
        <PromptInput
          sessionId={sessionId}
          onSend={handleSend}
          isStreaming={isStreaming}
          onAbort={handleAbort}
          sessionReady={isReady}
          disabled={inputBlocked || !isReady || !!pendingExtensionUiRequest}
          allowTypingWhileDisabled={!inputBlocked}
          stackedAbove={!!pendingExtensionUiRequest}
        />
      </View>
    </Animated.View>
  );
}

import React from 'react';

const styles = StyleSheet.create({
  container: { flex: 1 },
  editorColumn: { flex: 1 },
  emptyCenter: { flex: 1 },
});
