import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Fonts } from "@/constants/theme";
import type { AgentSessionInfo } from "@/features/api/generated/types.gen";
import { useResponsiveLayout } from "@/features/navigation/hooks/use-responsive-layout";
import { ChangesPanel } from "@/features/workspace/components/changes-panel";
import { PromptInput } from "@/features/workspace/components/prompt-input";
import { WorkspaceHero } from "@/features/workspace/components/workspace-hero";
import { WorkspaceSidebar } from "@/features/workspace/components/workspace-sidebar";
import { useWorkspaceStore } from "@/features/workspace/store";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useCreateSession, useSendPrompt } from "@/features/agent/hooks/use-agent-session";
import { requestBrowserNotificationPermission } from "@/features/agent/browser-notifications";

type PendingSessionRequest = {
  workspaceId: string;
  promise: Promise<AgentSessionInfo>;
};

export default function WorkspaceScreen() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const { isWideScreen } = useResponsiveLayout();
  const insets = useSafeAreaInsets();

  const selectWorkspace = useWorkspaceStore((s) => s.selectWorkspace);
  const clearWorkspaceNotification = useWorkspaceStore(
    (s) => s.clearWorkspaceNotification,
  );
  const createSession = useCreateSession();
  const sendPrompt = useSendPrompt();
  const [sending, setSending] = useState(false);
  const [preSession, setPreSession] = useState<{
    workspaceId: string;
    sessionId: string;
  } | null>(null);
  const pendingSessionRef = useRef<PendingSessionRequest | null>(null);
  const currentWorkspaceRef = useRef<string | null>(workspaceId ?? null);

  const preSessionId =
    preSession?.workspaceId === workspaceId ? preSession.sessionId : null;

  useEffect(() => {
    if (workspaceId) {
      selectWorkspace(workspaceId);
      clearWorkspaceNotification(workspaceId);
    }
  }, [workspaceId, selectWorkspace, clearWorkspaceNotification]);

  useEffect(() => {
    currentWorkspaceRef.current = workspaceId ?? null;
    setPreSession(null);
    setSending(false);
  }, [workspaceId]);

  const ensureSession = useCallback(
    async (targetWorkspaceId: string) => {
      if (
        preSession?.workspaceId === targetWorkspaceId &&
        preSession.sessionId
      ) {
        return preSession.sessionId;
      }

      const existingRequest = pendingSessionRef.current;
      if (existingRequest?.workspaceId === targetWorkspaceId) {
        const info = await existingRequest.promise;
        return info.session_id;
      }

      // Reuse the same async path for background pre-creation and Enter submits.
      const request = createSession.mutateAsync({ workspaceId: targetWorkspaceId });
      pendingSessionRef.current = {
        workspaceId: targetWorkspaceId,
        promise: request,
      };

      try {
        const info = await request;
        if (currentWorkspaceRef.current === targetWorkspaceId) {
          setPreSession({
            workspaceId: targetWorkspaceId,
            sessionId: info.session_id,
          });
        }
        return info.session_id;
      } finally {
        if (
          pendingSessionRef.current?.workspaceId === targetWorkspaceId &&
          pendingSessionRef.current.promise === request
        ) {
          pendingSessionRef.current = null;
        }
      }
    },
    [createSession, preSession],
  );

  useEffect(() => {
    if (!workspaceId || preSessionId) return;
    void ensureSession(workspaceId).catch(() => {});
  }, [ensureSession, preSessionId, workspaceId]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!workspaceId || sending) return;
      requestBrowserNotificationPermission();
      setSending(true);
      try {
        const sessionId = await ensureSession(workspaceId);
        await sendPrompt.mutateAsync({ sessionId, message: text, workspaceId });
        router.replace(`/workspace/${workspaceId}/s/${sessionId}`);
      } catch (e) {
        console.error('Failed to create session or send prompt:', e);
        setSending(false);
      }
    },
    [workspaceId, sending, ensureSession, sendPrompt, router],
  );

  const isDark = colorScheme === "dark";
  const editorBg = isDark ? "#151515" : "#FAFAFA";

  const keyboardPadding = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS === "web") return;

    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSub = Keyboard.addListener(showEvent, (e) => {
      Animated.spring(keyboardPadding, {
        toValue: e.endCoordinates.height,
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

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardPadding]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? "#121212" : colors.background,
          paddingBottom: isWideScreen
            ? 0
            : Animated.add(keyboardPadding, insets.bottom),
        },
      ]}
    >
      <View style={styles.upperRow}>
        {/* Editor area */}
        <View style={[styles.editorColumn, { backgroundColor: editorBg }]}>
          {sending ? (
            <View style={styles.sendingContainer}>
              <ActivityIndicator size="small" color={isDark ? '#cdc8c5' : colors.textTertiary} />
              <Text style={[styles.sendingText, { color: isDark ? '#cdc8c5' : colors.textTertiary }]}>
                Starting session…
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

        {/* Right sidebar */}
        {isWideScreen && (
          <WorkspaceSidebar>
            <View style={{ flex: 1, backgroundColor: editorBg }}>
              <ChangesPanel />
            </View>
          </WorkspaceSidebar>
        )}
      </View>

      {/* Terminal panel */}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  upperRow: {
    flex: 1,
    flexDirection: "row",
  },
  editorColumn: {
    flex: 1,
  },
  sendingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  sendingText: {
    fontSize: 14,
    fontFamily: Fonts.sansMedium,
  },
});
