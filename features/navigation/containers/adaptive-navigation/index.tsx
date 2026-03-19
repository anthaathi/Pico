import {
  ReactNode,
  useRef,
  useState,
  useCallback,
  useEffect,
} from "react";
import {
  Animated,
  PanResponder,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useResponsiveLayout } from "../../hooks/use-responsive-layout";
import { NavigationRail } from "../../components/navigation-rail";
import { HeaderBar } from "../../components/header-bar";
import { MobileHeaderBar } from "../../components/mobile-header-bar";
import { WorkspaceSheet } from "../../components/workspace-sheet";
import { MobileChangesSheet } from "../../components/mobile-changes-sheet";
import { SessionSidebar } from "@/features/workspace/components/session-sidebar";
import { useAuthStore } from "@/features/auth/store";
import { useWorkspaceStore } from "@/features/workspace/store";
import { useAppMode } from "@/hooks/use-app-mode";
import { AppModeToggle } from "../../components/app-mode-toggle";
import { ChatSidebar } from "@/features/chat/components/chat-sidebar";
import { ChatSheet } from "@/features/chat/components/chat-sheet";
import { useChatStore } from "@/features/chat/store";
import { ConnectionStatusBanner } from "@/features/agent/components/connection-status-banner";

const SIDEBAR_DEFAULT = 280;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const RAIL_WIDTH = 64;

type SidebarMode = "persistent" | "hover";

interface AdaptiveNavigationProps {
  children: ReactNode;
}

export function AdaptiveNavigation({ children }: AdaptiveNavigationProps) {
  const { isWideScreen } = useResponsiveLayout();
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const activeServerId = useAuthStore((s) => s.activeServerId);
  const hasServer = !!activeServerId;
  const hasWorkspaces = useWorkspaceStore((s) => s.workspaces.length > 0);
  const appMode = useAppMode();
  const isCodeMode = appMode === "code";
  const isChatMode = appMode === "chat";
  const showSessions = hasServer && hasWorkspaces;
  const [sheetVisible, setSheetVisible] = useState(false);
  const [changesSheetVisible, setChangesSheetVisible] = useState(false);
  const [chatSidebarVisible, setChatSidebarVisible] = useState(false);
  const [chatSheetVisible, setChatSheetVisible] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("persistent");
  const [hoverVisible, setHoverVisible] = useState(false);
  const [showPersistentSidebar, setShowPersistentSidebar] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT);

  const isDark = colorScheme === "dark";
  const contentBorder = isDark ? "#3b3a39" : "rgba(0,0,0,0.12)";
  const overlayBg = isDark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.08)";

  const persistentAnim = useRef(new Animated.Value(1)).current;
  const hoverAnim = useRef(new Animated.Value(0)).current;
  const codeModeAnim = useRef(new Animated.Value(isCodeMode ? 1 : 0)).current;
  const [railMounted, setRailMounted] = useState(isCodeMode);
  const chatSidebarAnim = useRef(new Animated.Value(0)).current;
  const [chatSidebarMounted, setChatSidebarMounted] = useState(false);

  const isPersistent = sidebarMode === "persistent";

  useEffect(() => {
    if (isCodeMode) {
      setRailMounted(true);
    }
    Animated.spring(codeModeAnim, {
      toValue: isCodeMode ? 1 : 0,
      tension: 200,
      friction: 24,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && !isCodeMode) {
        setRailMounted(false);
      }
    });
  }, [isCodeMode, codeModeAnim]);

  useEffect(() => {
    const shouldShow = isChatMode && chatSidebarVisible;
    if (shouldShow) {
      setChatSidebarMounted(true);
    }
    Animated.spring(chatSidebarAnim, {
      toValue: shouldShow ? 1 : 0,
      tension: 200,
      friction: 24,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && !shouldShow) {
        setChatSidebarMounted(false);
      }
    });
  }, [isChatMode, chatSidebarVisible, chatSidebarAnim]);

  useEffect(() => {
    if (isPersistent) {
      setShowPersistentSidebar(true);
    }
    Animated.spring(persistentAnim, {
      toValue: isPersistent ? 1 : 0,
      tension: 180,
      friction: 22,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && !isPersistent) {
        setShowPersistentSidebar(false);
      }
    });
  }, [isPersistent, persistentAnim]);

  useEffect(() => {
    Animated.spring(hoverAnim, {
      toValue: hoverVisible && !isPersistent ? 1 : 0,
      tension: 200,
      friction: 24,
      useNativeDriver: true,
    }).start();
  }, [hoverAnim, hoverVisible, isPersistent]);

  const handleToggleSidebar = useCallback(() => {
    setSidebarMode((prev) => (prev === "persistent" ? "hover" : "persistent"));
    setHoverVisible(false);
  }, []);

  const handleToggleChatSidebar = useCallback(() => {
    setChatSidebarVisible((prev) => !prev);
  }, []);

  const handleRailHoverIn = useCallback(() => {
    if (!isPersistent) setHoverVisible(true);
  }, [isPersistent]);

  const handleRailHoverOut = useCallback(() => {
    if (!isPersistent) setHoverVisible(false);
  }, [isPersistent]);

  const handleSidebarHoverIn = useCallback(() => {
    if (!isPersistent) setHoverVisible(true);
  }, [isPersistent]);

  const handleSidebarHoverOut = useCallback(() => {
    if (!isPersistent) setHoverVisible(false);
  }, [isPersistent]);

  const startWidthRef = useRef(SIDEBAR_DEFAULT);
  const resizePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startWidthRef.current = sidebarWidthRef.current;
        setIsResizing(true);
        if (Platform.OS === "web") {
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }
      },
      onPanResponderMove: (_e, gestureState) => {
        const newWidth = Math.max(
          SIDEBAR_MIN,
          Math.min(SIDEBAR_MAX, startWidthRef.current + gestureState.dx),
        );
        sidebarWidthRef.current = newWidth;
        setSidebarWidth(newWidth);
      },
      onPanResponderRelease: () => {
        setIsResizing(false);
        if (Platform.OS === "web") {
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        }
      },
      onPanResponderTerminate: () => {
        setIsResizing(false);
        if (Platform.OS === "web") {
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        }
      },
    }),
  ).current;

  const router = useRouter();
  const chatSelectSession = useChatStore((s) => s.selectSession);

  const handleChatNewSession = useCallback(() => {
    chatSelectSession(null);
    router.replace('/chat');
  }, [chatSelectSession, router]);

  const handleChatSelectSession = useCallback(
    (sessionId: string, _filePath: string) => {
      chatSelectSession(sessionId);
      router.replace({ pathname: '/chat/[sessionId]', params: { sessionId } });
    },
    [chatSelectSession, router],
  );

  if (isWideScreen) {
    const animatedRailWidth = codeModeAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, RAIL_WIDTH],
    });

    const animatedSidebarWidth = Animated.multiply(
      persistentAnim,
      Animated.multiply(codeModeAnim, sidebarWidth),
    );

    const contentBorderWidth = codeModeAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.633],
    });

    const contentBorderRadius = Animated.multiply(
      persistentAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [12, 0],
      }),
      codeModeAnim,
    );

    const hoverTranslateX = hoverAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [-sidebarWidth, 0],
    });

    const webHoverProps =
      Platform.OS === "web"
        ? { onMouseEnter: handleRailHoverIn, onMouseLeave: handleRailHoverOut }
        : {};

    const webSidebarHoverProps =
      Platform.OS === "web"
        ? {
            onMouseEnter: handleSidebarHoverIn,
            onMouseLeave: handleSidebarHoverOut,
          }
        : {};

    return (
      <SafeAreaView
        style={[styles.wideContainer, { backgroundColor: colors.background }]}
        edges={["top"]}
      >
        <View
          style={[
            styles.modeToggleRow,
            { backgroundColor: isDark ? "#1a1a1a" : "#F5F4F1" },
          ]}
        >
          <AppModeToggle />
        </View>
        {hasServer ? (
          <HeaderBar
            onToggleSidebar={handleToggleSidebar}
            onToggleChatSidebar={handleToggleChatSidebar}
            sidebarVisible={isPersistent}
          />
        ) : (
          <View style={{ height: 0 }} />
        )}
        <View style={styles.bodyRow}>
          {hasServer && railMounted && (
            <Animated.View
              style={{
                width: animatedRailWidth,
                overflow: "hidden",
                height: "100%",
              }}
              {...webHoverProps}
            >
              <View style={{ width: RAIL_WIDTH, height: "100%" }}>
                <NavigationRail />
              </View>
            </Animated.View>
          )}

          {showSessions && showPersistentSidebar && railMounted && (
            <Animated.View
              style={{
                width: animatedSidebarWidth,
                overflow: "hidden",
                height: "100%",
              }}
            >
              <View
                style={{ width: sidebarWidth, flex: 1, flexDirection: "row" }}
              >
                <View style={{ flex: 1, height: "100%" }}>
                  <SessionSidebar />
                </View>
                <View
                  {...resizePanResponder.panHandlers}
                  hitSlop={{ left: 8, right: 8 }}
                  style={
                    [
                      styles.resizeHandle,
                      isResizing && styles.resizeHandleActive,
                    ] as any
                  }
                />
              </View>
            </Animated.View>
          )}

          {chatSidebarMounted && (
            <Animated.View
              style={{
                width: chatSidebarAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, SIDEBAR_DEFAULT],
                }),
                overflow: "hidden",
                height: "100%",
              }}
            >
              <View style={{ width: SIDEBAR_DEFAULT, height: "100%" }}>
                <ChatSidebar
                  onNewSession={handleChatNewSession}
                  onSelectSession={handleChatSelectSession}
                />
              </View>
            </Animated.View>
          )}

          <Animated.View
            style={[
              styles.content,
              hasServer && isCodeMode
                ? {
                    borderLeftWidth: contentBorderWidth,
                    borderTopWidth: contentBorderWidth,
                    borderLeftColor: contentBorder,
                    borderTopColor: contentBorder,
                    borderTopLeftRadius: contentBorderRadius,
                  }
                : chatSidebarMounted
                  ? {
                      borderLeftWidth: chatSidebarAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 0.633],
                      }),
                      borderTopWidth: chatSidebarAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 0.633],
                      }),
                      borderLeftColor: contentBorder,
                      borderTopColor: contentBorder,
                      borderTopLeftRadius: chatSidebarAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 12],
                      }),
                    }
                  : {},
            ]}
          >
            {children}

            {showSessions && !isPersistent && isCodeMode && (
              <>
                <Animated.View
                  style={[
                    styles.overlay,
                    {
                      backgroundColor: overlayBg,
                      opacity: hoverAnim,
                      pointerEvents: hoverVisible ? "auto" : "none",
                    },
                  ]}
                />
                <Animated.View
                  {...webSidebarHoverProps}
                  style={[
                    styles.hoverSidebar,
                    {
                      transform: [{ translateX: hoverTranslateX }],
                    },
                  ]}
                >
                  <SessionSidebar />
                </Animated.View>
              </>
            )}
          </Animated.View>
        </View>
        {hasServer && <ConnectionStatusBanner />}
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView
      style={[styles.narrowContainer, { backgroundColor: colors.background }]}
    >
      <SafeAreaView
        style={[styles.narrowSafeArea, { backgroundColor: colors.background }]}
        edges={["top"]}
      >
        <View
          style={[
            styles.modeToggleRow,
            { backgroundColor: isDark ? "#1a1a1a" : "#F5F4F1" },
          ]}
        >
          <AppModeToggle />
        </View>
        {hasServer && (
          <MobileHeaderBar
            onWorkspacePress={() => setSheetVisible(true)}
            onGitPress={() => setChangesSheetVisible(true)}
            onChatSessionsPress={() => setChatSheetVisible(true)}
          />
        )}
        <View style={styles.mobileContent}>
          {children}
        </View>
        {hasServer && <ConnectionStatusBanner />}
      </SafeAreaView>
      {hasServer && isCodeMode && (
        <>
          <WorkspaceSheet
            visible={sheetVisible}
            onClose={() => setSheetVisible(false)}
          />
          {hasWorkspaces && (
            <MobileChangesSheet
              visible={changesSheetVisible}
              onClose={() => setChangesSheetVisible(false)}
            />
          )}
        </>
      )}
      {isChatMode && (
        <ChatSheet
          visible={chatSheetVisible}
          onClose={() => setChatSheetVisible(false)}
        />
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  wideContainer: {
    flex: 1,
  },
  modeToggleRow: {
    alignItems: "center",
    paddingVertical: 8,
  },
  bodyRow: {
    flex: 1,
    flexDirection: "row",
  },
  narrowContainer: {
    flex: 1,
  },
  narrowSafeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    overflow: "hidden",
  },
  mobileContent: {
    flex: 1,
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  hoverSidebar: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: SIDEBAR_DEFAULT,
    zIndex: 11,
  },
  resizeHandle: {
    width: Platform.OS === "web" ? 4 : 12,
    cursor: "col-resize",
    alignSelf: "stretch",
    backgroundColor: "transparent",
    marginRight: Platform.OS === "web" ? 0 : -6,
    borderTopColor: "rgba(0,0,0,0.1)",
    borderTopWidth: 0.633,
  },
  resizeHandleActive: {
    backgroundColor: "rgba(0,0,0,0.1)",
    width: 4,
    marginRight: 0,
  },
});
