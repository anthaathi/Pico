import { memo, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ChangesPanel } from "@/features/workspace/components/changes-panel";
import { PreviewPanel } from "@/features/preview/components/preview-panel";
import { usePreviewStore } from "@/features/preview/store";

interface WorkspaceRightPaneProps {
  sessionId: string | null;
}

type PaneTab = "changes" | "preview";

function WorkspaceRightPaneComponent({ sessionId }: WorkspaceRightPaneProps) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const previewPaneOpen = usePreviewStore((state) =>
    sessionId ? state.paneOpenBySession[sessionId] ?? false : false,
  );
  const setPreviewPaneOpen = usePreviewStore((state) => state.setPaneOpen);
  const [activeTab, setActiveTab] = useState<PaneTab>("changes");

  useEffect(() => {
    setActiveTab(previewPaneOpen ? "preview" : "changes");
  }, [previewPaneOpen]);

  const tabs: Array<{ key: PaneTab; label: string }> = [
    { key: "changes", label: "Changes" },
    { key: "preview", label: "Preview" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: isDark ? "#151515" : "#FAFAFA" }]}>
      <View style={[styles.tabBar, { borderBottomColor: isDark ? "#323131" : "rgba(0,0,0,0.08)" }]}>
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => {
                setActiveTab(tab.key);
                if (sessionId && tab.key === "preview") {
                  setPreviewPaneOpen(sessionId, true);
                }
                if (sessionId && tab.key === "changes") {
                  setPreviewPaneOpen(sessionId, false);
                }
              }}
              style={({ pressed }) => [
                styles.tab,
                active && {
                  backgroundColor: isDark ? "#2B2A2A" : "#EDEDED",
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.tabLabel, { color: active ? (isDark ? "#F5F5F5" : "#1A1A1A") : (isDark ? "#8B8685" : "#6B6B6B") }]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.content}>
        {activeTab === "preview" ? <PreviewPanel sessionId={sessionId} /> : <ChangesPanel />}
      </View>
    </View>
  );
}

export const WorkspaceRightPane = memo(WorkspaceRightPaneComponent);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 0.633,
  },
  tab: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  tabLabel: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
  },
  content: {
    flex: 1,
  },
});
