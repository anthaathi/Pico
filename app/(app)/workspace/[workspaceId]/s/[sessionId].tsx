import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import {
  Animated,
  Keyboard,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/theme";
import { useResponsiveLayout } from "@/features/navigation/hooks/use-responsive-layout";
import { ChangesPanel } from "@/features/workspace/components/changes-panel";
import { PromptInput } from "@/features/workspace/components/prompt-input";
import { WorkspaceSidebar } from "@/features/workspace/components/workspace-sidebar";
import { useWorkspaceStore } from "@/features/workspace/store";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { MessageList } from "@/features/agent/components/message-list";
import { ChatShimmer } from "@/features/agent/components/message-list/chat-shimmer";
import { ExtensionUiDialog } from "@/features/agent/components/extension-ui-dialog";
import {
  useAgentSession,
  useSendPrompt,
  useAbortAgent,
  type PromptStreamingBehavior,
} from "@/features/agent/hooks/use-agent-session";
import { useAgentStore } from "@/features/agent/store";
import { useSessions } from "@/features/workspace/hooks/use-sessions";
import type { ChatMessage } from "@/features/agent/types";
import { requestBrowserNotificationPermission } from "@/features/agent/browser-notifications";

const EMPTY_MESSAGES: ChatMessage[] = [];

export default function SessionScreen() {
  const { workspaceId, sessionId } = useLocalSearchParams<{
    workspaceId: string;
    sessionId: string;
  }>();
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const { isWideScreen } = useResponsiveLayout();
  const insets = useSafeAreaInsets();

  const selectWorkspace = useWorkspaceStore((s) => s.selectWorkspace);
  const clearWorkspaceNotification = useWorkspaceStore(
    (s) => s.clearWorkspaceNotification,
  );
  const setLastSession = useWorkspaceStore((s) => s.setLastSession);

  useEffect(() => {
    if (!workspaceId) return;
    selectWorkspace(workspaceId);
    clearWorkspaceNotification(workspaceId);
  }, [workspaceId, selectWorkspace, clearWorkspaceNotification]);

  useEffect(() => {
    if (workspaceId && sessionId) {
      setLastSession(workspaceId, sessionId);
    }
  }, [workspaceId, sessionId, setLastSession]);

  const { sessions } = useSessions(workspaceId ?? null);
  const session = (sessions as any[])?.find(
    (s: any) => s.id === sessionId,
  );
  const sessionFile = session?.file_path ?? null;

  const { isSessionReady } = useAgentSession(
    sessionId ?? null,
    workspaceId ?? null,
    sessionFile,
  );

  const isStreaming = useAgentStore(
    (s) => s.streaming[sessionId ?? ""] ?? false,
  );
  const messages = useAgentStore(
    (s) => s.messages[sessionId ?? ""] ?? EMPTY_MESSAGES,
  );
  const pendingExtensionUiRequest = useAgentStore(
    (s) => s.pendingExtensionUiRequests[sessionId ?? ""] ?? null,
  );
  const connectionStatus = useAgentStore((s) => s.connection.status);
  const inputBlockedByConnection =
    connectionStatus === "reconnecting" || connectionStatus === "disconnected";

  const sendPromptMutation = useSendPrompt();
  const abortAgent = useAbortAgent();
  const sendRef = useRef(sendPromptMutation.mutate);
  sendRef.current = sendPromptMutation.mutate;

  const handleSend = useCallback(
    (
      text: string,
      _attachments: unknown[],
      options?: { queueBehavior?: PromptStreamingBehavior },
    ) => {
      if (!sessionId || inputBlockedByConnection) return;
      requestBrowserNotificationPermission();
      sendRef.current({
        sessionId,
        message: text,
        streamingBehavior: options?.queueBehavior ?? (isStreaming ? "steer" : undefined),
        workspaceId: workspaceId ?? undefined,
        sessionFile: sessionFile ?? undefined,
      });
    },
    [inputBlockedByConnection, sessionId, isStreaming, workspaceId, sessionFile],
  );

  const handleAbort = useCallback(() => {
    if (!sessionId) return;
    abortAgent.mutate(sessionId);
  }, [sessionId, abortAgent]);

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

  const hasMessages = messages.length > 0;
  const isLoadingHistory = !!sessionId && !hasMessages;

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
        <View style={[styles.editorColumn, { backgroundColor: editorBg }]}>
          {hasMessages && sessionId ? (
            <MessageList key={sessionId} sessionId={sessionId} />
          ) : isLoadingHistory ? (
            <ChatShimmer />
          ) : (
            <View style={styles.emptyCenter} />
          )}
          <ExtensionUiDialog
            sessionId={sessionId}
            request={pendingExtensionUiRequest}
          />
          <PromptInput
            sessionId={sessionId}
            onSend={handleSend}
            isStreaming={isStreaming}
            onAbort={handleAbort}
            sessionReady={isSessionReady}
            disabled={
              inputBlockedByConnection ||
              !isSessionReady ||
              !!pendingExtensionUiRequest
            }
            allowTypingWhileDisabled={!inputBlockedByConnection}
            stackedAbove={!!pendingExtensionUiRequest}
          />
        </View>

        {isWideScreen && (
          <WorkspaceSidebar>
            <View style={{ flex: 1, backgroundColor: editorBg }}>
              <ChangesPanel />
            </View>
          </WorkspaceSidebar>
        )}
      </View>

      {/* Terminal stub removed */}
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
  emptyCenter: {
    flex: 1,
  },
});
