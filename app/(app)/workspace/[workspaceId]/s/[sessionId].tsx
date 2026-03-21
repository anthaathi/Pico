import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { useAgentSession, useConnection } from "@pi-ui/client";
import { useSessions } from "@/features/workspace/hooks/use-sessions";
import { requestBrowserNotificationPermission } from "@/features/agent/browser-notifications";
import type { PendingExtensionUiRequest as LegacyPendingUiRequest } from "@/features/agent/extension-ui";

export default function SessionScreen() {
  const { workspaceId, sessionId } = useLocalSearchParams<{
    workspaceId: string;
    sessionId: string;
  }>();
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const { isWideScreen } = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

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
  const session = (sessions as Array<{ id: string; file_path: string }>)?.find(
    (s) => s.id === sessionId,
  );
  const sessionFile = session?.file_path || sessionId || "";

  const agentSession = useAgentSession(sessionId ?? null, {
    workspaceId: workspaceId ?? "",
    sessionFile,
  });

  const connection = useConnection();
  const inputBlockedByConnection =
    connection.status === "reconnecting" || connection.status === "disconnected";

  const handleSend = useCallback(
    async (
      text: string,
      _attachments: unknown[],
      options?: { queueBehavior?: "steer" | "followUp" },
    ) => {
      if (!sessionId || inputBlockedByConnection) return;
      setAlertMessage(null);
      requestBrowserNotificationPermission();

      const behavior = options?.queueBehavior ?? (agentSession.isStreaming ? "steer" : undefined);
      const sendFn = behavior === "steer"
        ? agentSession.steer
        : behavior === "followUp"
          ? agentSession.followUp
          : agentSession.prompt;

      try {
        await sendFn(text);
      } catch (error) {
        setAlertMessage(
          error instanceof Error ? error.message : "Failed to send prompt",
        );
        throw error;
      }
    },
    [inputBlockedByConnection, sessionId, agentSession],
  );

  const handleAbort = useCallback(() => {
    if (!sessionId) return;
    setAlertMessage(null);
    agentSession.abort().catch((error) => {
      setAlertMessage(
        error instanceof Error ? error.message : "Failed to abort",
      );
    });
  }, [sessionId, agentSession]);

  const clearAlert = useCallback(() => setAlertMessage(null), []);

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
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardPadding, insets.bottom]);

  const hasMessages = agentSession.messages.length > 0;

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
          ) : agentSession.isLoading || (!agentSession.isReady && sessionId) ? (
            Platform.OS === "ios" ? (
              <View style={styles.emptyCenter}>
                <ActivityIndicator size="small" />
              </View>
            ) : (
              <ChatShimmer />
            )
          ) : (
            <View style={styles.emptyCenter} />
          )}
          <ExtensionUiDialog
            sessionId={sessionId}
            request={agentSession.pendingExtensionUiRequest as LegacyPendingUiRequest | null}
          />
          <PromptInput
            sessionId={sessionId}
            onSend={handleSend}
            isStreaming={agentSession.isStreaming}
            onAbort={handleAbort}
            sessionReady={agentSession.isReady}
            disabled={
              inputBlockedByConnection ||
              !agentSession.isReady ||
              !!agentSession.pendingExtensionUiRequest
            }
            allowTypingWhileDisabled={!inputBlockedByConnection}
            stackedAbove={!!agentSession.pendingExtensionUiRequest}
            errorMessage={alertMessage}
            onClearError={clearAlert}
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
    alignItems: "center",
    justifyContent: "center",
  },
});
