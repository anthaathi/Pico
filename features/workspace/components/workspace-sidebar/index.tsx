import { type ReactNode, useEffect, useRef, useState } from "react";
import { PanResponder, Platform, Pressable, StyleSheet, View } from "react-native";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react-native";
import * as SecureStore from "expo-secure-store";

import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

const PANEL_DEFAULT = 280;
const PANEL_MIN = 180;
const PANEL_MAX = 480;
const RAIL_WIDTH = 28;
const SIDEBAR_WIDTH_KEY = "workspace_sidebar_width";
const SIDEBAR_COLLAPSED_KEY = "workspace_sidebar_collapsed";

let sidebarWidthCache = PANEL_DEFAULT;
let sidebarWidthLoaded = false;
let sidebarCollapsedCache = false;
let sidebarCollapsedLoaded = false;

function clampWidth(width: number) {
  return Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.round(width)));
}

function parseStoredWidth(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clampWidth(parsed);
}

async function loadStoredWidth() {
  try {
    if (Platform.OS === "web") {
      if (typeof localStorage === "undefined") return null;
      return parseStoredWidth(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    }

    return parseStoredWidth(
      await SecureStore.getItemAsync(SIDEBAR_WIDTH_KEY),
    );
  } catch {
    return null;
  }
}

async function saveStoredWidth(width: number) {
  const value = String(clampWidth(width));

  try {
    if (Platform.OS === "web") {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(SIDEBAR_WIDTH_KEY, value);
      return;
    }

    await SecureStore.setItemAsync(SIDEBAR_WIDTH_KEY, value);
  } catch {}
}

async function loadStoredCollapsed(): Promise<boolean | null> {
  try {
    let value: string | null = null;
    if (Platform.OS === "web") {
      if (typeof localStorage === "undefined") return null;
      value = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    } else {
      value = await SecureStore.getItemAsync(SIDEBAR_COLLAPSED_KEY);
    }
    if (value === "true") return true;
    if (value === "false") return false;
    return null;
  } catch {
    return null;
  }
}

async function saveStoredCollapsed(collapsed: boolean) {
  try {
    if (Platform.OS === "web") {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
      return;
    }
    await SecureStore.setItemAsync(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {}
}

interface WorkspaceSidebarProps {
  children: ReactNode;
}

export function WorkspaceSidebar({ children }: WorkspaceSidebarProps) {
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const isDark = colorScheme === "dark";

  const sidebarBorder = isDark ? "#323131" : "rgba(0,0,0,0.08)";
  const railBg = isDark ? "#151515" : "#FAFAFA";
  const railHoverBg = isDark ? "#202020" : "#F2F2F2";
  const iconColor = isDark ? "#8B8685" : colors.textTertiary;

  const [isCollapsed, setIsCollapsed] = useState(sidebarCollapsedCache);
  const [isResizing, setIsResizing] = useState(false);
  const [panelWidth, setPanelWidth] = useState(sidebarWidthCache);
  const panelWidthRef = useRef(sidebarWidthCache);
  const panelStartRef = useRef(sidebarWidthCache);

  useEffect(() => {
    let cancelled = false;

    const promises: Promise<void>[] = [];

    if (sidebarWidthLoaded) {
      const nextWidth = clampWidth(sidebarWidthCache);
      panelWidthRef.current = nextWidth;
      setPanelWidth(nextWidth);
    } else {
      promises.push(
        loadStoredWidth().then((storedWidth) => {
          if (cancelled) return;
          const nextWidth = storedWidth ?? PANEL_DEFAULT;
          sidebarWidthCache = nextWidth;
          sidebarWidthLoaded = true;
          panelWidthRef.current = nextWidth;
          setPanelWidth(nextWidth);
        }),
      );
    }

    if (!sidebarCollapsedLoaded) {
      promises.push(
        loadStoredCollapsed().then((stored) => {
          if (cancelled) return;
          const collapsed = stored ?? false;
          sidebarCollapsedCache = collapsed;
          sidebarCollapsedLoaded = true;
          setIsCollapsed(collapsed);
        }),
      );
    }

    if (promises.length > 0) {
      void Promise.all(promises);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const persistWidth = (width: number) => {
    const nextWidth = clampWidth(width);
    sidebarWidthCache = nextWidth;
    sidebarWidthLoaded = true;
    panelWidthRef.current = nextWidth;
    void saveStoredWidth(nextWidth);
  };

  const panelResizer = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !isCollapsed,
      onMoveShouldSetPanResponder: () => !isCollapsed,
      onPanResponderGrant: () => {
        panelStartRef.current = panelWidthRef.current;
        setIsResizing(true);
        if (Platform.OS === "web") {
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }
      },
      onPanResponderMove: (_e, gs) => {
        const newWidth = Math.max(
          PANEL_MIN,
          Math.min(PANEL_MAX, panelStartRef.current - gs.dx),
        );
        panelWidthRef.current = newWidth;
        setPanelWidth(newWidth);
      },
      onPanResponderRelease: () => {
        setIsResizing(false);
        persistWidth(panelWidthRef.current);
        if (Platform.OS === "web") {
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        }
      },
      onPanResponderTerminate: () => {
        setIsResizing(false);
        persistWidth(panelWidthRef.current);
        if (Platform.OS === "web") {
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        }
      },
    }),
  ).current;

  return (
    <View
      style={[
        styles.container,
        {
          borderLeftColor: sidebarBorder,
          width: isCollapsed ? RAIL_WIDTH : panelWidth,
        },
      ]}
    >
      <View
        style={[
          styles.rail,
          {
            backgroundColor: railBg,
            borderRightColor: sidebarBorder,
            borderRightWidth: isCollapsed ? 0 : 0.633,
          },
        ]}
      >
        <Pressable
          onPress={() => {
            setIsCollapsed((prev) => {
              const next = !prev;
              sidebarCollapsedCache = next;
              void saveStoredCollapsed(next);
              return next;
            });
          }}
          accessibilityRole="button"
          accessibilityLabel={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          {...{
            title: isCollapsed ? "Expand sidebar" : "Collapse sidebar",
          }}
          style={({ hovered, pressed }: any) => [
            styles.toggleButton,
            (hovered || pressed) && { backgroundColor: railHoverBg },
          ]}
        >
          {isCollapsed ? (
            <ChevronLeft size={16} color={iconColor} strokeWidth={2} />
          ) : (
            <ChevronRight size={16} color={iconColor} strokeWidth={2} />
          )}
        </Pressable>

        {!isCollapsed && (
          <View
            {...panelResizer.panHandlers}
            hitSlop={{ left: 8, right: 8 }}
            style={[
              styles.resizeHandle,
              isResizing && { backgroundColor: railHoverBg },
            ]}
          >
            <GripVertical size={14} color={iconColor} strokeWidth={1.8} />
          </View>
        )}
      </View>

      {!isCollapsed && <View style={styles.content}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderLeftWidth: 0.633,
    flexDirection: "row",
    overflow: "hidden",
  },
  rail: {
    width: RAIL_WIDTH,
    alignItems: "center",
  },
  toggleButton: {
    width: "100%",
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  resizeHandle: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    cursor: "col-resize",
  } as any,
  content: {
    flex: 1,
  },
});
