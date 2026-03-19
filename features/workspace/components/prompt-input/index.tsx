import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import {
  Animated,
  Keyboard,
  LayoutAnimation,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  View,
} from "react-native";
import { Plus, ArrowUp, Mic, Square } from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
import { useQuery } from "@tanstack/react-query";

import { Fonts } from "@/constants/theme";
import { formatAgentModeLabel } from "@/features/agent/mode";
import { useAgentStore } from "@/features/agent/store";
import { useResponsiveLayout } from "@/features/navigation/hooks/use-responsive-layout";
import { useSpeechRecognition } from "@/features/speech/hooks/use-speech-recognition";
import { useSpeechSettingsStore } from "@/features/speech/store";
import { getCommands } from "@/features/api/generated/sdk.gen";
import { unwrapApiData } from "@/features/api/unwrap";

import {
  SlashCommand,
  Attachment,
  LARGE_PASTE_THRESHOLD,
} from "./constants";
import { usePromptTheme } from "./use-theme-colors";
import { SlashCommandDropdown } from "./slash-command-dropdown";
import { AttachmentChips } from "./attachment-chips";
import {
  Toolbar,
  TOOLBAR_ANDROID_MARGIN_TOP,
  TOOLBAR_BORDER_WIDTH,
  TOOLBAR_CONTROL_HEIGHT,
  TOOLBAR_CORNER_RADIUS,
  TOOLBAR_HORIZONTAL_MARGIN,
  TOOLBAR_VERTICAL_PADDING,
  TOOLBAR_WRAP_OFFSET,
} from "./toolbar";
import { MobileModelSheet } from "./mobile-model-sheet";
import { MobileEffortSheet } from "./mobile-effort-sheet";

const BAR_COUNT = 5;
const BAR_SCALES = [0.6, 0.85, 1, 0.85, 0.6];
const EMPTY_SLASH_COMMANDS: SlashCommand[] = [];

function WaveformBars({ audioLevel }: { audioLevel: number }) {
  const anims = useRef(
    Array.from({ length: BAR_COUNT }, () => new Animated.Value(0)),
  ).current;

  useEffect(() => {
    anims.forEach((anim, i) => {
      const scale = BAR_SCALES[i];
      const target = Math.max(0.15, audioLevel * scale);
      Animated.timing(anim, {
        toValue: target,
        duration: 80,
        useNativeDriver: false,
      }).start();
    });
  }, [anims, audioLevel]);

  return (
    <View style={waveStyles.container}>
      {anims.map((anim, i) => (
        <Animated.View
          key={i}
          style={[
            waveStyles.bar,
            {
              backgroundColor: "#EF4444",
              height: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [3, 18],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
}

const waveStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: 18,
  },
  bar: {
    width: 3,
    borderRadius: 1.5,
  },
});

function ToolbarSkeleton({ isDark }: { isDark: boolean }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  const fill = isDark ? "#2A2A28" : "#E2E2DF";
  const bg = isDark ? "#1a1a1a" : "#F6F6F6";
  const border = isDark ? "#3b3a39" : "rgba(0,0,0,0.12)";

  return (
    <View style={skeletonStyles.wrap}>
      <View style={[skeletonStyles.toolbar, { backgroundColor: bg, borderColor: border }]}>
        <Animated.View style={[skeletonStyles.track, { opacity }]}>
          <View style={[skeletonStyles.pill, skeletonStyles.pillWide, { backgroundColor: fill }]} />
          <View style={[skeletonStyles.pill, skeletonStyles.pillNarrow, { backgroundColor: fill }]} />
        </Animated.View>
      </View>
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  wrap: {
    marginTop: -TOOLBAR_WRAP_OFFSET,
    paddingTop: TOOLBAR_WRAP_OFFSET,
    marginHorizontal: TOOLBAR_HORIZONTAL_MARGIN,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingVertical: TOOLBAR_VERTICAL_PADDING,
    borderWidth: TOOLBAR_BORDER_WIDTH,
    borderTopWidth: 0,
    borderBottomLeftRadius: TOOLBAR_CORNER_RADIUS,
    borderBottomRightRadius: TOOLBAR_CORNER_RADIUS,
    marginTop: TOOLBAR_ANDROID_MARGIN_TOP,
  },
  track: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  pill: {
    height: TOOLBAR_CONTROL_HEIGHT,
    borderRadius: 6,
  },
  pillWide: {
    width: 148,
  },
  pillNarrow: {
    width: 92,
  },
});

type PromptKeyPressEventData = TextInputKeyPressEventData & {
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
};

type QueueBehavior = "steer" | "followUp";

function formatQueueBehaviorLabel(behavior: QueueBehavior): string {
  return behavior === "followUp" ? "Follow up" : "Steer";
}

interface PromptInputProps {
  sessionId?: string | null;
  onSend?: (
    text: string,
    attachments: Attachment[],
    options?: { queueBehavior?: QueueBehavior },
  ) => void;
  isStreaming?: boolean;
  onAbort?: () => void;
  disabled?: boolean;
  sessionReady?: boolean;
  allowTypingWhileDisabled?: boolean;
  stackedAbove?: boolean;
}

export function PromptInput({
  sessionId,
  onSend,
  isStreaming,
  onAbort,
  disabled,
  sessionReady = true,
  allowTypingWhileDisabled = false,
  stackedAbove = false,
}: PromptInputProps) {
  const theme = usePromptTheme();
  const { isWideScreen } = useResponsiveLayout();
  const inputRef = useRef<TextInput>(null);
  const shouldAnimateEntry = !sessionId;
  const isStartingSession = !!sessionId && !sessionReady;
  const canComposeWhileDisabled =
    allowTypingWhileDisabled && isStartingSession;
  const inputDisabled = !!disabled && !canComposeWhileDisabled;
  const sendDisabled = !!disabled;
  const streamedMode = useAgentStore(
    (s) => (sessionId ? s.modes[sessionId] ?? null : null),
  );

  const { data: backendCommands } = useQuery({
    queryKey: ["slash-commands", sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const result = await getCommands({ body: { session_id: sessionId } });
      if (result.error) return [];
      const data = unwrapApiData(result.data) as
        | { commands?: { name: string; description?: string }[] }
        | undefined;
      return (
        data?.commands?.map((c) => ({
          name: c.name,
          description: c.description ?? "",
        })) ?? []
      );
    },
    enabled: !!sessionId && sessionReady,
    staleTime: 60_000,
  });
  const slashCommands = backendCommands ?? EMPTY_SLASH_COMMANDS;

  // Keyboard visibility (mobile)
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [hideBottomForKeyboard, setHideBottomForKeyboard] = useState(false);
  const [mobileSheet, setMobileSheet] = useState<null | "model" | "effort">(
    null,
  );
  const [toolbarPopoverOpen, setToolbarPopoverOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [entryDone, setEntryDone] = useState(false);
  const toolbarVisible = isWideScreen || (!hideBottomForKeyboard && !mobileSheet);
  const toolbarOverlap = Platform.OS === "web" || isWideScreen ? -4 : -1;
  const toolbarSkeleton = useMemo(
    () => <ToolbarSkeleton isDark={theme.isDark} />,
    [theme.isDark],
  );

  const closeMobileSheet = useCallback(() => {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
    );
    setMobileSheet(null);
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (e) => {
      const duration = (e as any).duration ?? 250;
      LayoutAnimation.configureNext(
        LayoutAnimation.create(duration, LayoutAnimation.Types.keyboard, LayoutAnimation.Properties.opacity),
      );
      setKeyboardVisible(true);
      setHideBottomForKeyboard(true);
    });
    const hideSub = Keyboard.addListener(hideEvent, (e) => {
      const duration = (e as any).duration ?? 250;
      LayoutAnimation.configureNext(
        LayoutAnimation.create(duration, LayoutAnimation.Types.keyboard, LayoutAnimation.Properties.opacity),
      );
      setKeyboardVisible(false);
      setHideBottomForKeyboard(false);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (isWideScreen) return;
    if (keyboardVisible) {
      setMobileSheet(null);
    }
  }, [isWideScreen, keyboardVisible]);

  // Load speech settings
  const speechLoaded = useSpeechSettingsStore((s) => s.loaded);
  const loadSpeechSettings = useSpeechSettingsStore((s) => s.load);
  useEffect(() => {
    if (!speechLoaded) loadSpeechSettings();
  }, [speechLoaded, loadSpeechSettings]);

  // --- State ---
  const [text, setText] = useState("");
  const [showCommands, setShowCommands] = useState(false);
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trimmedText = text.trim();
  const hasDraft = trimmedText.length > 0 || attachments.length > 0;
  const showAbortButton = !!isStreaming && !hasDraft;
  const showQueueActions = !!isStreaming && hasDraft;

  // --- Speech ---
  const textBeforeSpeechRef = useRef("");
  const handleSpeechInterim = useCallback((interim: string) => {
    setText(
      textBeforeSpeechRef.current +
        (textBeforeSpeechRef.current ? " " : "") +
        interim,
    );
  }, []);
  const handleSpeechFinal = useCallback((final: string) => {
    const base = textBeforeSpeechRef.current;
    const newText = base + (base ? " " : "") + final;
    setText(newText);
    textBeforeSpeechRef.current = newText;
  }, []);
  const {
    isListening,
    start: startListening,
    stop: stopListening,
    error: speechError,
    audioLevel,
  } = useSpeechRecognition(handleSpeechInterim, handleSpeechFinal);

  const handleMicPress = useCallback(() => {
    if (inputDisabled) return;
    if (isListening) {
      stopListening();
    } else {
      textBeforeSpeechRef.current = text;
      startListening();
    }
  }, [inputDisabled, isListening, text, startListening, stopListening]);

  // --- Auto-grow ---
  const MIN_LINES = 2;
  const MAX_LINES = 6;
  const lineCount = Math.min(
    Math.max(text.split("\n").length, MIN_LINES),
    MAX_LINES,
  );

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = inputRef.current as any;
    const textarea = el?.querySelector?.("textarea") ?? el;
    if (textarea && textarea.tagName === "TEXTAREA") {
      textarea.rows = lineCount;
      textarea.style.resize = "none";
    }
  }, [lineCount]);

  // --- Animations ---
  const dropdownAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(
    new Animated.Value(shouldAnimateEntry ? 20 : 0),
  ).current;
  const fadeAnim = useRef(
    new Animated.Value(shouldAnimateEntry ? 0 : 1),
  ).current;

  useEffect(() => {
    if (!shouldAnimateEntry) {
      setEntryDone(true);
      return;
    }

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 350,
        delay: 150,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 120,
        friction: 14,
        delay: 150,
        useNativeDriver: true,
      }),
    ]).start(() => setEntryDone(true));
  }, [fadeAnim, shouldAnimateEntry, slideAnim]);

  useEffect(() => {
    Animated.spring(dropdownAnim, {
      toValue: showCommands ? 1 : 0,
      tension: 300,
      friction: 26,
      useNativeDriver: true,
    }).start();
  }, [dropdownAnim, showCommands]);

  useEffect(() => {
    if (Platform.OS !== "web" || inputDisabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if (e.key.length !== 1) return;
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [inputDisabled]);

  const sendDraft = useCallback((queueBehavior?: QueueBehavior) => {
    if (!hasDraft) return;

    const nextText = trimmedText;
    const nextAttachments = attachments;

    onSend?.(nextText, nextAttachments, { queueBehavior });
    setText("");
    setAttachments([]);
    setShowCommands(false);
    textBeforeSpeechRef.current = "";
  }, [attachments, hasDraft, onSend, trimmedText]);

  const handleSubmit = useCallback(() => {
    if (sendDisabled) return;

    if (showAbortButton) {
      onAbort?.();
      return;
    }

    sendDraft(isStreaming ? "steer" : undefined);
  }, [isStreaming, onAbort, sendDraft, sendDisabled, showAbortButton]);

  // --- Slash commands ---
  const handleTextChange = useCallback(
    (value: string) => {
      setText(value);
      const slashMatch = value.match(/(?:^|\s)\/([\w:-]*)$/);
      if (slashMatch) {
        const query = slashMatch[1].toLowerCase();
        const matches = slashCommands.filter((cmd) =>
          cmd.name.toLowerCase().startsWith(query),
        );
        setFilteredCommands(matches);
        setSlashIndex(0);
        setShowCommands(matches.length > 0);
      } else {
        setShowCommands(false);
      }
    },
    [slashCommands],
  );

  const handleSelectCommand = useCallback(
    (command: SlashCommand) => {
      const newText = text.replace(/(?:^|\s)\/([\w]*)$/, (match) => {
        const prefix = match.startsWith(" ") ? " " : "";
        return `${prefix}/${command.name} `;
      });
      setText(newText);
      setShowCommands(false);
      inputRef.current?.focus();
    },
    [text],
  );

  // --- Attachments ---
  const addAttachment = useCallback((att: Attachment) => {
    setAttachments((prev) => [...prev, att]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleFilePick = useCallback(async () => {
    if (inputDisabled) return;
    if (Platform.OS === "web") {
      fileInputRef.current?.click();
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (!result.canceled && result.assets) {
      for (const asset of result.assets) {
        const isImage = asset.mimeType?.startsWith("image/");
        addAttachment({
          id: `${Date.now()}-${Math.random()}`,
          name: asset.name,
          type: isImage ? "image" : "file",
          uri: asset.uri,
          size: asset.size ?? undefined,
        });
      }
    }
  }, [addAttachment, inputDisabled]);

  const handleWebFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isImage = file.type.startsWith("image/");
        const att: Attachment = {
          id: `${Date.now()}-${Math.random()}`,
          name: file.name,
          type: isImage ? "image" : "file",
          size: file.size,
        };
        if (isImage) {
          const reader = new FileReader();
          reader.onload = () => {
            att.preview = reader.result as string;
            addAttachment({ ...att });
          };
          reader.readAsDataURL(file);
        } else {
          addAttachment(att);
        }
      }
      e.target.value = "";
    },
    [addAttachment],
  );

  // Paste handler
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;
          const reader = new FileReader();
          reader.onload = () => {
            addAttachment({
              id: `${Date.now()}-${Math.random()}`,
              name: `pasted-image-${Date.now()}.png`,
              type: "image",
              size: blob.size,
              preview: reader.result as string,
            });
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
      const pastedText = e.clipboardData?.getData("text/plain");
      if (pastedText && pastedText.length > LARGE_PASTE_THRESHOLD) {
        e.preventDefault();
        addAttachment({
          id: `${Date.now()}-${Math.random()}`,
          name: `pasted-text-${Date.now()}.txt`,
          type: "text",
          size: pastedText.length,
        });
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [addAttachment]);

  // --- Keyboard nav for slash commands ---
  const handleKeyPress = useCallback(
    (e: NativeSyntheticEvent<PromptKeyPressEventData>) => {
      const { key, shiftKey, isComposing, keyCode } = e.nativeEvent;
      const isShiftEnter = key === "Enter" && shiftKey;
      const isImeComposing = isComposing === true || keyCode === 229;
      const PAGE_SIZE = 7;

      if (showCommands && filteredCommands.length > 0) {
        if (key === "ArrowUp") {
          e.preventDefault?.();
          setSlashIndex((prev) =>
            prev <= 0 ? filteredCommands.length - 1 : prev - 1,
          );
          return;
        }
        if (key === "ArrowDown") {
          e.preventDefault?.();
          setSlashIndex((prev) =>
            prev >= filteredCommands.length - 1 ? 0 : prev + 1,
          );
          return;
        }
        if (key === "PageUp") {
          e.preventDefault?.();
          setSlashIndex((prev) => Math.max(0, prev - PAGE_SIZE));
          return;
        }
        if (key === "PageDown") {
          e.preventDefault?.();
          setSlashIndex((prev) =>
            Math.min(filteredCommands.length - 1, prev + PAGE_SIZE),
          );
          return;
        }
        if (key === "Home") {
          e.preventDefault?.();
          setSlashIndex(0);
          return;
        }
        if (key === "End") {
          e.preventDefault?.();
          setSlashIndex(filteredCommands.length - 1);
          return;
        }
        if (key === "Tab" || (key === "Enter" && !isShiftEnter)) {
          e.preventDefault?.();
          handleSelectCommand(filteredCommands[slashIndex]);
          return;
        }
        if (key === "Escape") {
          setShowCommands(false);
          return;
        }
      }

      if (Platform.OS === "web" && key === "Enter" && !isShiftEnter) {
        if (isImeComposing) return;
        e.preventDefault?.();
        handleSubmit();
      }
    },
    [
      filteredCommands,
      handleSelectCommand,
      handleSubmit,
      showCommands,
      slashIndex,
    ],
  );

  return (
    <Animated.View
      style={[
        styles.wrapper,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
          paddingBottom: keyboardVisible && !isWideScreen ? 24 : 12,
        },
      ]}
    >
      {/* Slash command dropdown */}
      {showCommands && (
        <SlashCommandDropdown
          commands={filteredCommands}
          selectedIndex={slashIndex}
          dropdownAnim={dropdownAnim}
          onSelect={handleSelectCommand}
        />
      )}

      {/* Speech error */}
      {speechError && (
        <Pressable
          onPress={() => {}}
          style={[
            styles.speechError,
            { backgroundColor: theme.isDark ? "#3a1a1a" : "#FEE2E2" },
          ]}
        >
          <Text
            style={[
              styles.speechErrorText,
              { color: theme.isDark ? "#FCA5A5" : "#DC2626" },
            ]}
          >
            {speechError}
          </Text>
        </Pressable>
      )}

      {/* Input card */}
      <Animated.View
        style={[
          styles.card,
          {
            backgroundColor: theme.cardBg,
            borderColor: theme.cardBorder,
            borderTopLeftRadius: showCommands || stackedAbove ? 0 : 12,
            borderTopRightRadius: showCommands || stackedAbove ? 0 : 12,
            marginBottom: toolbarOverlap,
            ...(entryDone
              ? Platform.OS === "web"
                ? {
                    boxShadow: isFocused
                      ? "0px 2px 6px rgba(0, 0, 0, 0.08)"
                      : "0px 0px 0px rgba(0, 0, 0, 0)",
                    transitionProperty: "box-shadow",
                    transitionDuration: "180ms",
                    transitionTimingFunction: "ease",
                  }
                : {
                    boxShadow: isFocused
                      ? `0px ${Platform.OS === "ios" ? 2 : 3}px ${Platform.OS === "ios" ? 5 : 8}px rgba(0, 0, 0, ${Platform.OS === "ios" ? 0.07 : 0.1})`
                      : "0px 0px 0px rgba(0, 0, 0, 0)",
                    elevation: isFocused ? 2 : 0,
                  }
              : {}),
          } as any,
        ]}
      >
        <TextInput
          ref={inputRef}
          placeholder="Ask anything..."
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            { color: theme.textPrimary },
            sendDisabled && !canComposeWhileDisabled && { opacity: 0.5 },
          ]}
          editable={!inputDisabled}
          multiline
          numberOfLines={lineCount}
          {...(Platform.OS === "web" ? ({ rows: lineCount } as any) : {})}
          value={text}
          onChangeText={handleTextChange}
          onKeyPress={handleKeyPress}
          onTouchStart={undefined}
          onFocus={() => {
            setIsFocused(true);
          }}
          onBlur={() => {
            setIsFocused(false);
          }}
          accessibilityLabel="Prompt input"
          accessibilityHint="Press Enter to send, Shift+Enter for a new line, and type / for commands."
        />

        <AttachmentChips
          attachments={attachments}
          onRemove={removeAttachment}
        />

        <View style={styles.actionRow}>
          {Platform.OS === "web" && (
            <input
              ref={fileInputRef as any}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.json,.csv,.js,.ts,.tsx,.jsx,.py,.go,.rs,.java,.c,.cpp,.h"
              onChange={handleWebFileChange as any}
              style={{ display: "none" }}
            />
          )}
          <Pressable
            style={styles.attachButton}
            onPress={handleFilePick}
            disabled={inputDisabled}
            accessibilityRole="button"
            accessibilityLabel="Attach file"
          >
            <Plus size={18} color={theme.textMuted} strokeWidth={1.8} />
          </Pressable>
          {isListening ? (
            <Pressable
              style={[styles.micWaveRow]}
              onPress={handleMicPress}
              accessibilityRole="button"
              accessibilityLabel="Stop recording"
            >
              <Square
                size={12}
                color="#EF4444"
                strokeWidth={2}
                fill="#EF4444"
              />
              <WaveformBars audioLevel={audioLevel} />
            </Pressable>
          ) : (
            <Pressable
              style={styles.micButton}
              onPress={handleMicPress}
              disabled={inputDisabled}
              accessibilityRole="button"
              accessibilityLabel="Start voice input"
            >
              <Mic size={16} color={theme.textMuted} strokeWidth={1.8} />
            </Pressable>
          )}
          <View style={{ flex: 1 }} />
          {showQueueActions ? (
            <View style={styles.queueActionGroup}>
              {(["steer", "followUp"] as QueueBehavior[]).map((behavior) => (
                <Pressable
                  key={behavior}
                  accessibilityRole="button"
                  accessibilityLabel={`Send as ${formatQueueBehaviorLabel(behavior)}`}
                  onPress={() => sendDraft(behavior)}
                  disabled={sendDisabled}
                  style={({ pressed }) => [
                    styles.queueActionButton,
                    {
                      backgroundColor: theme.isDark ? "#242422" : "#EFEDE8",
                      borderColor: theme.cardBorder,
                      opacity: sendDisabled ? 0.45 : pressed ? 0.82 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.queueActionText,
                      { color: theme.textSecondary },
                    ]}
                  >
                    {formatQueueBehaviorLabel(behavior)}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showAbortButton ? "Stop generation" : "Send message"}
              onPress={handleSubmit}
              disabled={sendDisabled}
              style={({ pressed }) => [
                styles.sendButton,
                {
                  backgroundColor: theme.isDark ? "#4d4d4b" : theme.colors.text,
                  opacity: sendDisabled ? 0.45 : pressed ? 0.85 : 1,
                },
              ]}
            >
              {showAbortButton ? (
                <Square
                  size={12}
                  color="#FFFFFF"
                  strokeWidth={2}
                  fill="#FFFFFF"
                />
              ) : (
                <ArrowUp
                  size={16}
                  color={theme.isDark ? "#fefdfd" : theme.colors.background}
                  strokeWidth={2}
                />
              )}
            </Pressable>
          )}
        </View>
      </Animated.View>

      {toolbarVisible && (
        <View
          style={[
            styles.bottomControlsWrap,
            toolbarPopoverOpen && styles.bottomControlsWrapElevated,
          ]}
        >
          <Toolbar
            sessionId={sessionId}
            isWideScreen={isWideScreen}
            onOpenMobileSheet={setMobileSheet}
            onDropdownOpenChange={setToolbarPopoverOpen}
            inputRef={inputRef}
            skeleton={toolbarSkeleton}
            modeLabel={
              sessionId && sessionReady && streamedMode
                ? formatAgentModeLabel(streamedMode)
                : null
            }
            ready={!!sessionReady && !!sessionId}
          />
        </View>
      )}

      {/* Mobile bottom sheets */}
      {sessionReady && mobileSheet === "model" && (
        <MobileModelSheet
          visible
          sessionId={sessionId}
          onClose={closeMobileSheet}
        />
      )}
      {sessionReady && mobileSheet === "effort" && (
        <MobileEffortSheet
          visible
          sessionId={sessionId}
          onClose={closeMobileSheet}
        />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    maxWidth: 1080,
    alignSelf: "center",
    width: "100%",
    overflow: "visible",
  },
  speechError: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 6,
  },
  speechErrorText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
  card: {
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderWidth: 0.633,
    position: "relative",
    zIndex: Platform.OS === "android" ? 5 : 8,
  },
  input: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    fontSize: 15,
    fontFamily: Fonts.sans,
    outlineStyle: "none" as never,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  attachButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  micButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  micWaveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingHorizontal: 4,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  queueActionGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  queueActionButton: {
    height: 36,
    borderRadius: 999,
    borderWidth: 0.633,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  queueActionText: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
  },
  bottomControlsWrap: {
    overflow: "visible",
    position: "relative",
    zIndex: Platform.OS === "android" ? 4 : 7,
  },
  bottomControlsWrapElevated: {
    zIndex: Platform.OS === "android" ? 12 : 12,
  },
});
