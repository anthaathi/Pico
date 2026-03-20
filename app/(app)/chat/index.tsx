import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResponsiveLayout } from '@/features/navigation/hooks/use-responsive-layout';
import { PromptInput } from '@/features/workspace/components/prompt-input';
import { WorkspaceHero } from '@/features/workspace/components/workspace-hero';
import { useAgentStore } from '@/features/agent/store';
import { useChatStore } from '@/features/chat/store';
import { createChatSession } from '@/features/chat/api';
import { useChatSessions } from '@/features/chat/hooks/use-chat-sessions';
import { useSendPrompt } from '@/features/agent/hooks/use-agent-session';
import { useWorkspaceStore } from '@/features/workspace/store';

export default function ChatIndexScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const { isWideScreen } = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const noTools = useChatStore((s) => s.noTools);
  const systemPrompt = useChatStore((s) => s.systemPrompt);
  const selectSession = useChatStore((s) => s.selectSession);
  const setAlertMessage = useAgentStore((s) => s.setAlertMessage);
  const registerSessionWorkspace = useWorkspaceStore((s) => s.registerSessionWorkspace);
  const { invalidate: invalidateChatSessions } = useChatSessions();
  const sendPrompt = useSendPrompt();

  const [sending, setSending] = useState(false);
  const [preSessionId, setPreSessionId] = useState<string | null>(null);
  const pendingRef = useRef<Promise<string> | null>(null);

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (preSessionId) return preSessionId;
    if (pendingRef.current) return pendingRef.current;

    const promise = createChatSession({
      no_tools: noTools,
      system_prompt: systemPrompt ?? undefined,
    }).then((info) => {
      registerSessionWorkspace(info.session_id, info.workspace_id ?? '__chat__');
      setPreSessionId(info.session_id);
      return info.session_id;
    });
    pendingRef.current = promise;

    try {
      return await promise;
    } catch (e) {
      setAlertMessage(e instanceof Error ? e.message : 'Failed to create chat session');
      return null;
    } finally {
      pendingRef.current = null;
    }
  }, [preSessionId, noTools, systemPrompt, registerSessionWorkspace, setAlertMessage]);

  useEffect(() => {
    ensureSession().catch(() => {});
  }, [ensureSession]);

  const handleSend = useCallback(
    async (text: string) => {
      if (sending) return;
      setAlertMessage(null);
      setSending(true);

      try {
        const sid = await ensureSession();
        if (!sid) {
          setSending(false);
          return;
        }

        await sendPrompt.mutateAsync({ sessionId: sid, message: text });
        selectSession(sid);
        invalidateChatSessions();
        router.replace({ pathname: '/chat/[sessionId]', params: { sessionId: sid } });
      } catch (e) {
        setAlertMessage(e instanceof Error ? e.message : 'Failed to send prompt');
        setSending(false);
      }
    },
    [sending, ensureSession, sendPrompt, selectSession, invalidateChatSessions, router, setAlertMessage],
  );

  const editorBg = isDark ? '#151515' : '#FAFAFA';

  const keyboardPadding = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      const height = Platform.OS === 'ios'
        ? e.endCoordinates.height - insets.bottom
        : e.endCoordinates.height;
      Animated.spring(keyboardPadding, {
        toValue: height,
        tension: 160,
        friction: 20,
        useNativeDriver: false,
      }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      Animated.spring(keyboardPadding, {
        toValue: 0,
        tension: 160,
        friction: 20,
        useNativeDriver: false,
      }).start();
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, [keyboardPadding, insets.bottom]);

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
        {sending ? (
          <View style={styles.sendingContainer}>
            <ActivityIndicator size="small" color={isDark ? '#cdc8c5' : colors.textTertiary} />
            <Text style={[styles.sendingText, { color: isDark ? '#cdc8c5' : colors.textTertiary }]}>
              Starting chat…
            </Text>
          </View>
        ) : (
          <WorkspaceHero />
        )}
        <PromptInput
          sessionId={preSessionId}
          onSend={handleSend}
          disabled={sending}
          sessionReady={!!preSessionId}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  editorColumn: { flex: 1 },
  sendingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  sendingText: { fontSize: 14, fontFamily: Fonts.sansMedium },
});
