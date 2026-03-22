import { useEffect, useRef } from "react";
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { X, Columns2, Rows2 } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAppSettingsStore, type DiffViewMode } from "@/features/settings/store";
import type { DiffOp } from "./code-preview";
import {
  TokenizedText,
  buildInline,
  buildSideBySide,
  type CodeRow,
} from "./code-preview";

interface DiffBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  path: string;
  ops: DiffOp[];
  /** For write tool — preview rows when no diff baseline */
  previewRows?: CodeRow[];
  infoText?: string | null;
  addBg?: string;
}

export function DiffBottomSheet({
  visible,
  onClose,
  title,
  path,
  ops,
  previewRows,
  infoText,
  addBg,
}: DiffBottomSheetProps) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = Math.max(320, Math.floor(windowHeight * 0.85));
  const diffViewMode = useAppSettingsStore((s) => s.diffViewMode);
  const updateSettings = useAppSettingsStore((s) => s.update);
  const viewMode = diffViewMode;
  const setViewMode = (mode: DiffViewMode) =>
    updateSettings({ diffViewMode: mode });

  const slideAnim = useRef(new Animated.Value(sheetHeight)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
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
    }
  }, [overlayAnim, slideAnim, visible, sheetHeight]);

  const animateClose = () => {
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
  };

  const textColor = isDark ? "#CCCCCC" : "#1A1A1A";
  const mutedColor = isDark ? "#888" : "#888";
  const bg = isDark ? "#1A1A1A" : "#FFFFFF";
  const headerBg = isDark ? "#222" : "#F5F5F5";
  const addColor = isDark ? "#3FB950" : "#1A7F37";
  const removeColor = isDark ? "#F85149" : "#CF222E";
  const lineNoBg = isDark ? "#111111" : "#F3F3F3";
  const lineNoColor = isDark ? "#444" : "#BBBBBB";
  const dividerColor = isDark ? "#2A2A2A" : "#E0E0E0";
  const emptyBg = isDark
    ? "rgba(255,255,255,0.02)"
    : "rgba(0,0,0,0.02)";
  const diffAddBg =
    addBg ??
    (isDark
      ? "rgba(63, 185, 80, 0.10)"
      : "rgba(26, 127, 55, 0.06)");
  const diffRemoveBg = isDark
    ? "rgba(248, 81, 73, 0.10)"
    : "rgba(207, 34, 46, 0.06)";
  const activeBtnBg = isDark ? "#333" : "#FFFFFF";

  const hasOps = ops.length > 0;
  const inlineRows =
    hasOps && viewMode === "inline" ? buildInline(ops) : [];
  const sideBySideRows =
    hasOps && viewMode === "split" ? buildSideBySide(ops) : [];

  // Determine what to render
  const showInline = hasOps && viewMode === "inline";
  const showSplit = hasOps && viewMode === "split";
  const showPreview =
    !hasOps && previewRows != null && previewRows.length > 0;
  const showEmpty = !hasOps && !showPreview;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={animateClose}
    >
      <View style={s.modalWrap}>
        <Animated.View style={[s.overlay, { opacity: overlayAnim }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={animateClose}
          />
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
          {/* Header */}
          <View style={[s.header, { backgroundColor: headerBg }]}>
            <View style={s.headerLeft}>
              <Text
                style={[s.headerTitle, { color: textColor }]}
                numberOfLines={1}
              >
                {title}
              </Text>
              <Text
                style={[s.headerPath, { color: mutedColor }]}
                numberOfLines={1}
              >
                {path}
              </Text>
            </View>
            <View style={s.headerRight}>
              {hasOps && (
                <View style={s.viewToggle}>
                  <Pressable
                    onPress={() => setViewMode("inline")}
                    style={[
                      s.viewToggleBtn,
                      viewMode === "inline" && {
                        backgroundColor: activeBtnBg,
                      },
                    ]}
                  >
                    <Rows2
                      size={14}
                      color={
                        viewMode === "inline" ? textColor : mutedColor
                      }
                      strokeWidth={1.8}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => setViewMode("split")}
                    style={[
                      s.viewToggleBtn,
                      viewMode === "split" && {
                        backgroundColor: activeBtnBg,
                      },
                    ]}
                  >
                    <Columns2
                      size={14}
                      color={
                        viewMode === "split" ? textColor : mutedColor
                      }
                      strokeWidth={1.8}
                    />
                  </Pressable>
                </View>
              )}
              <Pressable onPress={animateClose} style={s.closeBtn}>
                <X size={18} color={mutedColor} strokeWidth={2} />
              </Pressable>
            </View>
          </View>

          {/* Info banner */}
          {infoText ? (
            <View
              style={[
                s.infoBanner,
                {
                  borderBottomColor: isDark
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(0,0,0,0.06)",
                },
              ]}
            >
              <Text style={[s.infoText, { color: mutedColor }]}>
                {infoText}
              </Text>
            </View>
          ) : null}

          {/* Scrollable diff content */}
          <ScrollView
            style={s.scrollArea}
            contentContainerStyle={s.scrollContent}
            nestedScrollEnabled
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.hScrollContent}
            >
              <View style={s.codeBlock}>
                {showInline &&
                  inlineRows.map((row, i) => {
                    const rowBg =
                      row.type === "added"
                        ? diffAddBg
                        : row.type === "removed"
                          ? diffRemoveBg
                          : undefined;
                    const prefix =
                      row.type === "added"
                        ? "+"
                        : row.type === "removed"
                          ? "-"
                          : " ";
                    const prefixColor =
                      row.type === "added"
                        ? addColor
                        : row.type === "removed"
                          ? removeColor
                          : mutedColor;
                    return (
                      <View
                        key={i}
                        style={[
                          s.row,
                          rowBg ? { backgroundColor: rowBg } : undefined,
                        ]}
                      >
                        <View
                          style={[
                            s.lineNoCol,
                            { backgroundColor: lineNoBg },
                          ]}
                        >
                          <Text
                            style={[s.lineNo, { color: lineNoColor }]}
                          >
                            {row.oldLineNo ?? ""}
                          </Text>
                        </View>
                        <View
                          style={[
                            s.lineNoCol,
                            { backgroundColor: lineNoBg },
                          ]}
                        >
                          <Text
                            style={[s.lineNo, { color: lineNoColor }]}
                          >
                            {row.newLineNo ?? ""}
                          </Text>
                        </View>
                        <Text
                          style={[s.prefix, { color: prefixColor }]}
                        >
                          {prefix}
                        </Text>
                        <TokenizedText
                          line={row.text}
                          isDark={isDark}
                          style={s.lineText}
                        />
                      </View>
                    );
                  })}

                {showSplit &&
                  sideBySideRows.map((row, i) => (
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
                        <View
                          style={[
                            s.lineNoCol,
                            { backgroundColor: lineNoBg },
                          ]}
                        >
                          <Text
                            style={[s.lineNo, { color: lineNoColor }]}
                          >
                            {row.leftLineNo ?? ""}
                          </Text>
                        </View>
                        {row.leftText != null ? (
                          <TokenizedText
                            line={row.leftText}
                            isDark={isDark}
                            style={s.lineText}
                          />
                        ) : (
                          <Text style={s.lineText}>{" "}</Text>
                        )}
                      </View>
                      <View
                        style={[
                          s.splitDivider,
                          { backgroundColor: dividerColor },
                        ]}
                      />
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
                        <View
                          style={[
                            s.lineNoCol,
                            { backgroundColor: lineNoBg },
                          ]}
                        >
                          <Text
                            style={[s.lineNo, { color: lineNoColor }]}
                          >
                            {row.rightLineNo ?? ""}
                          </Text>
                        </View>
                        {row.rightText != null ? (
                          <TokenizedText
                            line={row.rightText}
                            isDark={isDark}
                            style={s.lineText}
                          />
                        ) : (
                          <Text style={s.lineText}>{" "}</Text>
                        )}
                      </View>
                    </View>
                  ))}

                {showPreview &&
                  previewRows!.map((row) => (
                    <View
                      key={row.lineNo}
                      style={[
                        s.row,
                        { backgroundColor: diffAddBg },
                      ]}
                    >
                      <View
                        style={[
                          s.lineNoCol,
                          { backgroundColor: lineNoBg },
                        ]}
                      >
                        <Text
                          style={[s.lineNo, { color: lineNoColor }]}
                        >
                          {row.lineNo}
                        </Text>
                      </View>
                      <TokenizedText
                        line={row.text}
                        isDark={isDark}
                        style={s.lineText}
                      />
                    </View>
                  ))}

                {showEmpty && (
                  <View style={s.emptyState}>
                    <Text style={[s.emptyText, { color: mutedColor }]}>
                      No preview available
                    </Text>
                  </View>
                )}
              </View>
            </ScrollView>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

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
    gap: 12,
  },
  headerLeft: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    fontSize: 15,
    fontFamily: Fonts.sansSemiBold,
    fontWeight: "600",
  },
  headerPath: {
    fontSize: 11,
    fontFamily: Fonts.mono,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  infoBanner: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoText: {
    fontSize: 11,
    fontFamily: Fonts.sans,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  hScrollContent: {
    flexGrow: 1,
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
    lineHeight: 24,
    paddingHorizontal: 8,
    flexShrink: 1,
  },
  emptyState: {
    padding: 24,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
});
