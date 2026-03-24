import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Columns2, Rows2, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useResponsiveLayout } from "@/features/navigation/hooks/use-responsive-layout";
import { useAppSettingsStore, type DiffViewMode } from "@/features/settings/store";
import { useDiffPanel, type DiffTab } from "../diff-panel/context";
import { parseToolArguments, isToolCallActive } from "./tool-call-utils";
import {
  TokenizedText,
  SplitDiffView,
  CodePreview,
  buildCodeRows,
  buildInline,
  buildSideBySide,
  simpleDiff,
  editStyles,
  type DiffOp,
} from "./code-preview";
import type { ToolCallInfo } from "../../types";
import {
  MobileDiffSheetContext,
} from "./visibility-context";

export function MobileDiffSheetProvider({ children }: { children: ReactNode }) {
  const { isWideScreen } = useResponsiveLayout();
  const { tabs, activeTabId, selectTab, closeTab, findToolCall } = useDiffPanel();
  const suppressedRef = useRef(false);
  const [visible, setVisible] = useState(false);
  const prevTabCountRef = useRef(0);

  useEffect(() => {
    if (isWideScreen) return;
    if (tabs.length > prevTabCountRef.current && !suppressedRef.current) {
      setVisible(true);
    }
    prevTabCountRef.current = tabs.length;
  }, [tabs.length, isWideScreen]);

  useEffect(() => {
    if (tabs.length === 0 && visible) {
      setVisible(false);
    }
  }, [tabs.length, visible]);

  const open = useCallback(
    (tabId?: string) => {
      if (tabId) {
        const tab = tabs.find((t) => t.id === tabId);
        if (tab) selectTab(tab);
      }
      setVisible(true);
    },
    [tabs, selectTab],
  );

  const handleClose = useCallback(() => {
    suppressedRef.current = true;
    setVisible(false);
  }, []);

  const ctx = useMemo(() => ({ open }), [open]);

  return (
    <MobileDiffSheetContext.Provider value={ctx}>
      {children}
      {!isWideScreen && visible && tabs.length > 0 && (
        <MobileDiffSheetModal
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={selectTab}
          onCloseTab={closeTab}
          onClose={handleClose}
          findToolCall={findToolCall}
        />
      )}
    </MobileDiffSheetContext.Provider>
  );
}

interface MobileDiffSheetModalProps {
  tabs: DiffTab[];
  activeTabId: string | null;
  onSelectTab: (tab: DiffTab) => void;
  onCloseTab: (id: string) => void;
  onClose: () => void;
  findToolCall: (id: string) => ToolCallInfo | undefined;
}

const MobileDiffSheetModal = memo(function MobileDiffSheetModal({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onClose,
  findToolCall,
}: MobileDiffSheetModalProps) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = Math.max(320, Math.floor(windowHeight * 0.85));

  const slideAnim = useRef(new Animated.Value(sheetHeight)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    slideAnim.setValue(sheetHeight);
    Animated.parallel([
      Animated.timing(overlayAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 100,
        friction: 16,
        useNativeDriver: true,
      }),
    ]).start();
  }, [overlayAnim, slideAnim, sheetHeight]);

  const animateClose = useCallback(() => {
    Animated.parallel([
      Animated.timing(overlayAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: sheetHeight,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  }, [overlayAnim, slideAnim, sheetHeight, onClose]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[tabs.length - 1];
  const activeTc = activeTab ? findToolCall(activeTab.id) : undefined;

  const bg = isDark ? "#1A1A1A" : "#FFFFFF";
  const headerBg = isDark ? "#222" : "#F5F5F5";
  const textColor = isDark ? "#CCCCCC" : "#1A1A1A";
  const mutedColor = isDark ? "#888" : "#888";

  return (
    <Modal visible transparent animationType="none" onRequestClose={animateClose}>
      <View style={s.modalWrap}>
        <Animated.View style={[s.overlay, { opacity: overlayAnim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={animateClose} />
        </Animated.View>

        <Animated.View
          style={[
            s.sheet,
            {
              backgroundColor: bg,
              height: sheetHeight,
              paddingBottom: insets.bottom,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={[s.header, { backgroundColor: headerBg }]}>
            <Text style={[s.headerTitle, { color: textColor }]} numberOfLines={1}>
              Changes
            </Text>
            <Pressable onPress={animateClose} style={s.closeBtn}>
              <X size={18} color={mutedColor} strokeWidth={2} />
            </Pressable>
          </View>

          {tabs.length > 1 && (
            <MobileTabBar
              tabs={tabs}
              activeTabId={activeTab?.id ?? null}
              onSelect={(id) => {
                const tab = tabs.find((t) => t.id === id);
                if (tab) onSelectTab(tab);
              }}
              onClose={onCloseTab}
              isDark={isDark}
            />
          )}

          {activeTc && activeTab ? (
            <ActiveTabContent tc={activeTc} tab={activeTab} isDark={isDark} />
          ) : (
            <View style={s.emptyState}>
              <Text style={[s.emptyText, { color: mutedColor }]}>
                No file selected
              </Text>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
});

function MobileTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  isDark,
}: {
  tabs: DiffTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  isDark: boolean;
}) {
  const textColor = isDark ? "#CCCCCC" : "#1A1A1A";
  const mutedColor = isDark ? "#666" : "#999";
  const activeBg = isDark ? "#1E1E1E" : "#FFFFFF";
  const inactiveBg = isDark ? "#141414" : "#F0F0F0";
  const borderColor = isDark ? "#2A2A2A" : "#E0E0E0";
  const verbColor = isDark ? "#888" : "#888";

  return (
    <View style={[tabStyles.container, { borderBottomColor: borderColor }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={tabStyles.scrollContent}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <Pressable
              key={tab.id}
              onPress={() => onSelect(tab.id)}
              style={[
                tabStyles.tab,
                {
                  backgroundColor: isActive ? activeBg : inactiveBg,
                  borderBottomColor: isActive ? activeBg : borderColor,
                },
              ]}
            >
              <Text style={[tabStyles.verb, { color: verbColor }]} numberOfLines={1}>
                {tab.toolName === "edit" ? "E" : "W"}
              </Text>
              <Text
                style={[tabStyles.fileName, { color: isActive ? textColor : mutedColor }]}
                numberOfLines={1}
              >
                {tab.fileName}
              </Text>
              <Pressable
                onPress={() => onClose(tab.id)}
                hitSlop={6}
                style={tabStyles.tabCloseBtn}
              >
                <X size={10} color={isActive ? mutedColor : isDark ? "#555" : "#BBB"} strokeWidth={2} />
              </Pressable>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function ActiveTabContent({
  tc,
  tab,
  isDark,
}: {
  tc: ToolCallInfo;
  tab: DiffTab;
  isDark: boolean;
}) {
  if (tab.toolName === "edit") {
    return <EditContent tc={tc} tab={tab} isDark={isDark} />;
  }
  return <WriteContent tc={tc} tab={tab} isDark={isDark} />;
}

function EditContent({
  tc,
  tab,
  isDark,
}: {
  tc: ToolCallInfo;
  tab: DiffTab;
  isDark: boolean;
}) {
  const diffViewMode = useAppSettingsStore((s) => s.diffViewMode);
  const updateSettings = useAppSettingsStore((s) => s.update);
  const viewMode = diffViewMode;
  const setViewMode = (mode: DiffViewMode) => updateSettings({ diffViewMode: mode });
  const isRunning = isToolCallActive(tc);

  const parsed = parseToolArguments(tc.arguments);
  const oldText = parsed.oldText ?? "";
  const newText = parsed.newText ?? "";

  const ops = useMemo(() => {
    if (!oldText && !newText) return [];
    return simpleDiff(oldText, newText);
  }, [oldText, newText]);

  const hasOps = ops.length > 0;
  const inlineRows = hasOps && viewMode === "inline" ? buildInline(ops) : [];
  const sideBySideRows = hasOps && viewMode === "split" ? buildSideBySide(ops) : [];

  const textColor = isDark ? "#CCCCCC" : "#1A1A1A";
  const mutedColor = isDark ? "#888" : "#888";
  const addColor = isDark ? "#3FB950" : "#1A7F37";
  const removeColor = isDark ? "#F85149" : "#CF222E";
  const lineNoBg = isDark ? "#111111" : "#F3F3F3";
  const lineNoColor = isDark ? "#444" : "#BBBBBB";
  const dividerColor = isDark ? "#2A2A2A" : "#E0E0E0";
  const emptyBg = isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)";
  const diffAddBg = isDark ? "rgba(63, 185, 80, 0.10)" : "rgba(26, 127, 55, 0.06)";
  const diffRemoveBg = isDark ? "rgba(248, 81, 73, 0.10)" : "rgba(207, 34, 46, 0.06)";
  const toolbarBg = isDark ? "#161616" : "#F3F3F3";
  const toolbarBorder = isDark ? "#2A2A2A" : "#E0E0E0";
  const activeBtnBg = isDark ? "#333" : "#FFFFFF";

  return (
    <View style={s.tabContent}>
      <View style={[s.toolbar, { backgroundColor: toolbarBg, borderBottomColor: toolbarBorder }]}>
        <Text style={[s.toolbarPath, { color: mutedColor }]} numberOfLines={1}>
          {tab.path}
        </Text>
        {hasOps && (
          <View style={s.viewToggle}>
            <Pressable
              onPress={() => setViewMode("inline")}
              style={[s.viewToggleBtn, viewMode === "inline" && { backgroundColor: activeBtnBg }]}
            >
              <Rows2 size={14} color={viewMode === "inline" ? textColor : mutedColor} strokeWidth={1.8} />
            </Pressable>
            <Pressable
              onPress={() => setViewMode("split")}
              style={[s.viewToggleBtn, viewMode === "split" && { backgroundColor: activeBtnBg }]}
            >
              <Columns2 size={14} color={viewMode === "split" ? textColor : mutedColor} strokeWidth={1.8} />
            </Pressable>
          </View>
        )}
      </View>

      {hasOps && viewMode === "split" ? (
        <ScrollView style={s.scrollArea} nestedScrollEnabled>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={s.codeBlock}>
              {sideBySideRows.map((row, i) => (
                <View key={i} style={s.splitRow}>
                  <View
                    style={[
                      s.splitHalf,
                      row.leftType === "removed"
                        ? { backgroundColor: diffRemoveBg }
                        : row.leftType === "empty"
                          ? { backgroundColor: emptyBg }
                          : undefined,
                    ]}
                  >
                    <View style={[s.lineNoCol, { backgroundColor: lineNoBg }]}>
                      <Text style={[s.lineNo, { color: lineNoColor }]}>{row.leftLineNo ?? ""}</Text>
                    </View>
                    {row.leftText != null ? (
                      <TokenizedText line={row.leftText} isDark={isDark} style={s.splitLineText} />
                    ) : (
                      <Text style={s.splitLineText}>{" "}</Text>
                    )}
                  </View>
                  <View style={[s.splitDivider, { backgroundColor: dividerColor }]} />
                  <View
                    style={[
                      s.splitHalf,
                      row.rightType === "added"
                        ? { backgroundColor: diffAddBg }
                        : row.rightType === "empty"
                          ? { backgroundColor: emptyBg }
                          : undefined,
                    ]}
                  >
                    <View style={[s.lineNoCol, { backgroundColor: lineNoBg }]}>
                      <Text style={[s.lineNo, { color: lineNoColor }]}>{row.rightLineNo ?? ""}</Text>
                    </View>
                    {row.rightText != null ? (
                      <TokenizedText line={row.rightText} isDark={isDark} style={s.splitLineText} />
                    ) : (
                      <Text style={s.splitLineText}>{" "}</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </ScrollView>
      ) : hasOps && viewMode === "inline" ? (
        <ScrollView style={s.scrollArea} nestedScrollEnabled>
          {inlineRows.map((row, i) => {
            const rowBg = row.type === "added" ? diffAddBg : row.type === "removed" ? diffRemoveBg : undefined;
            const prefix = row.type === "added" ? "+" : row.type === "removed" ? "-" : " ";
            const prefixColor = row.type === "added" ? addColor : row.type === "removed" ? removeColor : mutedColor;
            return (
              <View key={i} style={[s.row, rowBg ? { backgroundColor: rowBg } : undefined]}>
                <View style={[s.lineNoCol, { backgroundColor: lineNoBg }]}>
                  <Text style={[s.lineNo, { color: lineNoColor }]}>{row.oldLineNo ?? ""}</Text>
                </View>
                <View style={[s.lineNoCol, { backgroundColor: lineNoBg }]}>
                  <Text style={[s.lineNo, { color: lineNoColor }]}>{row.newLineNo ?? ""}</Text>
                </View>
                <Text style={[s.prefix, { color: prefixColor }]}>{prefix}</Text>
                <TokenizedText line={row.text} isDark={isDark} style={s.lineText} />
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <View style={s.emptyState}>
          <Text style={[s.emptyText, { color: mutedColor }]}>
            {isRunning ? "Preparing diff..." : "No changes to display"}
          </Text>
        </View>
      )}
    </View>
  );
}

function WriteContent({
  tc,
  tab,
  isDark,
}: {
  tc: ToolCallInfo;
  tab: DiffTab;
  isDark: boolean;
}) {
  const isRunning = isToolCallActive(tc);
  const parsed = parseToolArguments(tc.arguments);
  const newText = parsed.content ?? "";
  const previewRows = useMemo(() => buildCodeRows(newText, 1), [newText]);

  const mutedColor = isDark ? "#888" : "#888";
  const lineNoBg = isDark ? "#111111" : "#F3F3F3";
  const lineNoColor = isDark ? "#444" : "#BBBBBB";
  const toolbarBg = isDark ? "#161616" : "#F3F3F3";
  const toolbarBorder = isDark ? "#2A2A2A" : "#E0E0E0";
  const diffAddBg = isDark ? "rgba(63, 185, 80, 0.10)" : "rgba(26, 127, 55, 0.06)";

  return (
    <View style={s.tabContent}>
      <View style={[s.toolbar, { backgroundColor: toolbarBg, borderBottomColor: toolbarBorder }]}>
        <Text style={[s.toolbarPath, { color: mutedColor }]} numberOfLines={1}>
          {tab.path}
        </Text>
      </View>

      {isRunning && previewRows.length === 0 ? (
        <View style={s.emptyState}>
          <Text style={[s.emptyText, { color: mutedColor }]}>Writing file...</Text>
        </View>
      ) : previewRows.length > 0 ? (
        <ScrollView style={s.scrollArea} nestedScrollEnabled>
          {previewRows.map((row) => (
            <View key={row.lineNo} style={[s.row, { backgroundColor: diffAddBg }]}>
              <View style={[s.lineNoCol, { backgroundColor: lineNoBg }]}>
                <Text style={[s.lineNo, { color: lineNoColor }]}>{row.lineNo}</Text>
              </View>
              <TokenizedText line={row.text} isDark={isDark} style={s.lineText} />
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={s.emptyState}>
          <Text style={[s.emptyText, { color: mutedColor }]}>No preview available</Text>
        </View>
      )}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    flexDirection: "row",
  },
  scrollContent: {
    flexDirection: "row",
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 2,
    maxWidth: 180,
  },
  verb: {
    fontSize: 10,
    fontFamily: Fonts.mono,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  fileName: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
    fontWeight: "500",
    flexShrink: 1,
  },
  tabCloseBtn: {
    width: 16,
    height: 16,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 2,
  },
});

const s = StyleSheet.create({
  modalWrap: {
    flex: 1,
    justifyContent: "flex-end",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 15,
    fontFamily: Fonts.sansSemiBold,
    fontWeight: "600",
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarPath: {
    fontSize: 11,
    fontFamily: Fonts.mono,
    flex: 1,
    marginRight: 8,
  },
  viewToggle: {
    flexDirection: "row",
    borderRadius: 6,
    overflow: "hidden",
    gap: 2,
  },
  viewToggleBtn: {
    width: 30,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  tabContent: {
    flex: 1,
    minHeight: 0,
  },
  scrollArea: {
    flex: 1,
  },
  codeBlock: {
    minWidth: "100%",
  },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: 24,
  },
  splitRow: {
    flexDirection: "row",
    minHeight: 24,
  },
  splitHalf: {
    flexDirection: "row",
    alignItems: "stretch",
    width: 200,
    overflow: "hidden",
  },
  splitDivider: {
    width: 1,
  },
  lineNoCol: {
    width: 36,
    paddingHorizontal: 4,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  lineNo: {
    fontSize: 11,
    fontFamily: Fonts.mono,
    lineHeight: 24,
  },
  prefix: {
    width: 16,
    fontSize: 12,
    fontFamily: Fonts.mono,
    lineHeight: 24,
    textAlign: "center",
  },
  lineText: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    lineHeight: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
    flex: 1,
  },
  splitLineText: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    lineHeight: 24,
    paddingHorizontal: 8,
    flexShrink: 1,
  },
  emptyState: {
    flex: 1,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
});
