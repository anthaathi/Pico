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
import { useResponsiveLayout } from "@/features/navigation/hooks/use-responsive-layout";
import { PromptInput } from "@/features/workspace/components/prompt-input";
import { WorkspaceHero } from "@/features/workspace/components/workspace-hero";
import { WorkspaceSidebar } from "@/features/workspace/components/workspace-sidebar";
import { WorkspaceRightPane } from "@/features/preview/components/workspace-right-pane";
import { useWorkspaceStore } from "@/features/workspace/store";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { usePiClient } from "@pi-ui/client";
import { requestBrowserNotificationPermission } from "@/features/agent/browser-notifications";

export default function WorkspaceScreen() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const { isWideScreen } = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const client = usePiClient();

  const selectWorkspace = useWorkspaceStore((s) => s.selectWorkspace);
  const clearWorkspaceNotification = useWorkspaceStore(
    (s) => s.clearWorkspaceNotification,
  );
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [preSessionId, setPreSessionId] = useState<string | null>(null);
  const pendingRef = useRef<Promise<{ session_id: string }> | null>(null);
  const currentWorkspaceRef = useRef<string | null>(workspaceId ?? null);

  useEffect(() => {
    if (workspaceId) {
      selectWorkspace(workspaceId);
      clearWorkspaceNotification(workspaceId);
    }
  }, [workspaceId, selectWorkspace, clearWorkspaceNotification]);

  useEffect(() => {
    currentWorkspaceRef.current = workspaceId ?? null;
    setPreSessionId(null);
    setSending(false);
    pendingRef.current = null;
  }, [workspaceId]);

  const ensureSession = useCallback(
    async (targetWorkspaceId: string): Promise<string> => {
      if (preSessionId) return preSessionId;

      if (pendingRef.current) {
        const info = await pendingRef.current;
        return info.session_id;
      }

      const promise = client.createAgentSession({ workspaceId: targetWorkspaceId });
      pendingRef.current = promise;

      try {
        const info = await promise;
        if (currentWorkspaceRef.current === targetWorkspaceId) {
          setPreSessionId(info.session_id);
        }
        return info.session_id;
      } finally {
        if (pendingRef.current === promise) {
          pendingRef.current = null;
        }
      }
    },
    [client, preSessionId],
  );

  useEffect(() => {
    if (!workspaceId || preSessionId) return;
    void ensureSession(workspaceId).catch(() => {});
  }, [ensureSession, preSessionId, workspaceId]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!workspaceId || sending) return;
      setAlertMessage(null);
      requestBrowserNotificationPermission();
      setSending(true);
      try {
        const sessionId = await ensureSession(workspaceId);
        await client.prompt(sessionId, text, { workspaceId });
        router.replace(`/workspace/${workspaceId}/s/${sessionId}`);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to create session or send prompt";
        setAlertMessage(message);
        setSending(false);
        throw e;
      }
    },
    [workspaceId, sending, ensureSession, client, router],
  );

  const clearAlert = useCallback(() => setAlertMessage(null), []);

  const isDark = colorScheme === "dark";
  const editorBg = isDark ? "#151515" : "#FAFAFA";
  const keyboardPadding = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS === "web") return;
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (e) => {
      const height = Platform.OS === "ios"
        ? e.endCoordinates.height - insets.bottom
        : e.endCoordinates.height;
      Animated.spring(keyboardPadding, {
        toValue: height, tension: 160, friction: 20, useNativeDriver: false,
      }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      Animated.spring(keyboardPadding, {
        toValue: 0, tension: 160, friction: 20, useNativeDriver: false,
      }).start();
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, [keyboardPadding, insets.bottom]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? "#121212" : colors.background,
          paddingBottom: isWideScreen ? 0 : Animated.add(keyboardPadding, insets.bottom),
        },
      ]}
    >
      <View style={styles.upperRow}>
        <View style={[styles.editorColumn, { backgroundColor: editorBg }]}>
          {sending ? (
            <View style={styles.sendingContainer}>
              <ActivityIndicator size="small" color={isDark ? "#cdc8c5" : colors.textTertiary} />
              <Text style={[styles.sendingText, { color: isDark ? "#cdc8c5" : colors.textTertiary }]}>
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
            errorMessage={alertMessage}
            onClearError={clearAlert}
          />
        </View>
        {isWideScreen && (
          <WorkspaceSidebar>
            <View style={{ flex: 1, backgroundColor: editorBg }}>
              <WorkspaceRightPane sessionId={preSessionId} />
            </View>
          </WorkspaceSidebar>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  upperRow: { flex: 1, flexDirection: "row" },
  editorColumn: { flex: 1 },
  sendingContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  sendingText: { fontSize: 14, fontFamily: Fonts.sansMedium },
});
