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
import { useAgentSession, useAgentConfig, usePiClient } from "@pi-ui/client";
import { useResponsiveLayout } from "@/features/navigation/hooks/use-responsive-layout";
import { useSpeechRecognition } from "@/features/speech/hooks/use-speech-recognition";
import { useSpeechSettingsStore } from "@/features/speech/store";

import {
  SlashCommand,
  Attachment,
} from "./constants";
import { usePromptTheme } from "./use-theme-colors";
import { SlashCommandDropdown } from "./slash-command-dropdown";
import { AttachmentChips } from "./attachment-chips";
import {
  Toolbar,
  TOOLBAR_HORIZONTAL_MARGIN,
  TOOLBAR_WRAP_OFFSET,
} from "./toolbar";
import { MobileModelSheet } from "./mobile-model-sheet";
import { MobileEffortSheet } from "./mobile-effort-sheet";
import { WaveformBars } from "./waveform-bars";
import { ToolbarSkeleton } from "./toolbar-skeleton";
import { ContextUsageRing } from "./context-usage-ring";
import { useDraftStore } from "./draft-store";

const EMPTY_SLASH_COMMANDS: SlashCommand[] = [];
const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "chat", description: "Switch to chat mode" },
  { name: "plan", description: "Switch to plan mode" },
  { name: "compact", description: "Compact conversation history" },
];

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
  ) => Promise<void> | void;
  isStreaming?: boolean;
  onAbort?: () => void;
  disabled?: boolean;
  sessionReady?: boolean;
  allowTypingWhileDisabled?: boolean;
  stackedAbove?: boolean;
  errorMessage?: string | null;
  onClearError?: () => void;
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
  errorMessage,
  onClearError,
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
  const agentSession = useAgentSession(sessionId ?? null);
  const streamedMode = agentSession.mode;
  const agentConfig = useAgentConfig(sessionReady ? (sessionId ?? null) : null);

  // Context usage: input + output + cacheRead + cacheWrite against context window
  const contextUsage = useMemo(() => {
    const contextWindow = agentConfig.state?.model?.contextWindow;
    if (!contextWindow) return null;
    const msgs = agentSession.messages as {
      role: string;
      usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    }[];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i];
      if (msg.role === "assistant" && msg.usage) {
        const u = msg.usage;
        const used = (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
        if (used <= 0) continue;
        return { used, total: contextWindow };
      }
    }
    return null;
  }, [agentSession.messages, agentConfig.state?.model?.contextWindow]);

  const piClient = usePiClient();
  const { data: backendCommands } = useQuery({
    queryKey: ["slash-commands", sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const result = await piClient.api.getCommands(sessionId);
      return (
        result.commands?.map((c) => ({
          name: c.name,
          description: c.description ?? "",
        })) ?? []
      );
    },
    enabled: !!sessionId && sessionReady,
    staleTime: 30_000,
    retry: 2,
    retryDelay: 1000,
    refetchOnMount: true,
  });
  const slashCommands = useMemo(() => {
    const backend = backendCommands ?? EMPTY_SLASH_COMMANDS;
    const backendNames = new Set(backend.map((c) => c.name));
    const builtins = BUILTIN_COMMANDS.filter((c) => !backendNames.has(c.name));
    return [...backend, ...builtins];
  }, [backendCommands]);

  // --- UI state ---
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [hideBottomForKeyboard, setHideBottomForKeyboard] = useState(false);
  const [mobileSheet, setMobileSheet] = useState<null | "model" | "effort">(null);
  const [toolbarPopoverOpen, setToolbarPopoverOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [entryDone, setEntryDone] = useState(false);
  const toolbarHiddenKeepLayout = !isWideScreen && !!mobileSheet;
  const toolbarCollapsed = !isWideScreen && hideBottomForKeyboard;
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

  // --- Keyboard ---
  useEffect(() => {
    if (Platform.OS === "web") return;
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
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
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // --- Speech ---
  const speechLoaded = useSpeechSettingsStore((s) => s.loaded);
  const loadSpeechSettings = useSpeechSettingsStore((s) => s.load);
  useEffect(() => {
    if (!speechLoaded) loadSpeechSettings();
  }, [speechLoaded, loadSpeechSettings]);

  const draftKey = sessionId ?? "__new__";
  const prevDraftKeyRef = useRef(draftKey);
  useEffect(() => {
    const prev = prevDraftKeyRef.current;
    if (prev !== draftKey) {
      useDraftStore.getState().migrateDraft(prev, draftKey);
      prevDraftKeyRef.current = draftKey;
    }
  }, [draftKey]);
  const text = useDraftStore((s) => s.getText(draftKey));
  const attachments = useDraftStore((s) => s.getAttachments(draftKey));
  const setText = useCallback((v: string) => useDraftStore.getState().setText(draftKey, v), [draftKey]);
  const setAttachments = useCallback((v: Attachment[] | ((prev: Attachment[]) => Attachment[])) => {
    const store = useDraftStore.getState();
    if (typeof v === "function") {
      store.setAttachments(draftKey, v(store.getAttachments(draftKey)));
    } else {
      store.setAttachments(draftKey, v);
    }
  }, [draftKey]);
  const [showCommands, setShowCommands] = useState(false);
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trimmedText = text.trim();
  const hasDraft = trimmedText.length > 0 || attachments.length > 0;
  const showAbortButton = !!isStreaming && !hasDraft;
  const showQueueActions = !!isStreaming && hasDraft;

  const textBeforeSpeechRef = useRef("");
  const handleSpeechInterim = useCallback((interim: string) => {
    setText(textBeforeSpeechRef.current + (textBeforeSpeechRef.current ? " " : "") + interim);
  }, [setText]);
  const handleSpeechFinal = useCallback((final: string) => {
    const base = textBeforeSpeechRef.current;
    const newText = base + (base ? " " : "") + final;
    setText(newText);
    textBeforeSpeechRef.current = newText;
  }, [setText]);
  const {
    isListening, start: startListening, stop: stopListening,
    error: speechError, clearError: clearSpeechError, audioLevel,
  } = useSpeechRecognition(handleSpeechInterim, handleSpeechFinal);

  const handleMicPress = useCallback(() => {
    if (inputDisabled) return;
    if (isListening) stopListening();
    else { textBeforeSpeechRef.current = text; startListening(); }
  }, [inputDisabled, isListening, text, startListening, stopListening]);

  // --- Auto-grow ---
  const MIN_LINES = 2;
  const MAX_LINES = 6;
  const lineCount = Math.min(Math.max(text.split("\n").length, MIN_LINES), MAX_LINES);

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
  const slideAnim = useRef(new Animated.Value(shouldAnimateEntry ? 20 : 0)).current;
  const fadeAnim = useRef(new Animated.Value(shouldAnimateEntry ? 0 : 1)).current;

  useEffect(() => {
    if (!shouldAnimateEntry) { setEntryDone(true); return; }
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, delay: 150, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 120, friction: 14, delay: 150, useNativeDriver: true }),
    ]).start(() => setEntryDone(true));
  }, [fadeAnim, shouldAnimateEntry, slideAnim]);

  useEffect(() => {
    Animated.spring(dropdownAnim, { toValue: showCommands ? 1 : 0, tension: 300, friction: 26, useNativeDriver: true }).start();
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

  // --- Send / abort ---
  const clearDraft = useDraftStore((s) => s.clearDraft);
  const sendDraft = useCallback(async (queueBehavior?: QueueBehavior) => {
    if (!hasDraft) return;
    const savedText = trimmedText;
    const savedAttachments = [...attachments];
    clearDraft(draftKey); setShowCommands(false);
    textBeforeSpeechRef.current = "";
    onClearError?.();
    try {
      await onSend?.(savedText, savedAttachments, { queueBehavior });
    } catch {
      setText(savedText);
      setAttachments(savedAttachments);
    }
  }, [attachments, clearDraft, draftKey, hasDraft, onClearError, onSend, setText, setAttachments, trimmedText]);

  const handleSubmit = useCallback(() => {
    if (sendDisabled) return;
    if (showAbortButton) { onAbort?.(); return; }
    sendDraft(isStreaming ? "steer" : undefined);
  }, [isStreaming, onAbort, sendDraft, sendDisabled, showAbortButton]);

  // --- Slash commands ---
  const handleTextChange = useCallback((value: string) => {
    setText(value);
    const slashMatch = value.match(/(?:^|\s)\/([\w:-]*)$/);
    if (slashMatch) {
      const query = slashMatch[1].toLowerCase();
      const matches = slashCommands.filter((cmd) => cmd.name.toLowerCase().startsWith(query));
      setFilteredCommands(matches);
      setSlashIndex(0);
      setShowCommands(matches.length > 0);
    } else {
      setShowCommands(false);
    }
  }, [setText, slashCommands]);

  const handleSelectCommand = useCallback((command: SlashCommand) => {
    const newText = text.replace(/(?:^|\s)\/([\w]*)$/, (match) => {
      const prefix = match.startsWith(" ") ? " " : "";
      return `${prefix}/${command.name} `;
    });
    setText(newText);
    setShowCommands(false);
    inputRef.current?.focus();
  }, [setText, text]);

  // --- Attachments ---
  const storeAddAttachment = useDraftStore((s) => s.addAttachment);
  const storeRemoveAttachment = useDraftStore((s) => s.removeAttachment);

  const addAttachment = useCallback((att: Attachment) => {
    storeAddAttachment(draftKey, att);
  }, [draftKey, storeAddAttachment]);

  const removeAttachment = useCallback((id: string) => {
    storeRemoveAttachment(draftKey, id);
  }, [draftKey, storeRemoveAttachment]);

  const handleFilePick = useCallback(async () => {
    if (inputDisabled) return;
    if (Platform.OS === "web") { fileInputRef.current?.click(); return; }
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
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

  const handleWebFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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
        reader.onload = () => { att.preview = reader.result as string; addAttachment({ ...att }); };
        reader.readAsDataURL(file);
      } else {
        addAttachment(att);
      }
    }
    e.target.value = "";
  }, [addAttachment]);

  // --- Keyboard nav for slash commands ---
  const handleKeyPress = useCallback((e: NativeSyntheticEvent<PromptKeyPressEventData>) => {
    const { key, shiftKey, isComposing, keyCode } = e.nativeEvent;
    const isShiftEnter = key === "Enter" && shiftKey;
    const isImeComposing = isComposing === true || keyCode === 229;
    const PAGE_SIZE = 7;

    if (showCommands && filteredCommands.length > 0) {
      if (key === "ArrowUp") { e.preventDefault?.(); setSlashIndex((prev) => prev <= 0 ? filteredCommands.length - 1 : prev - 1); return; }
      if (key === "ArrowDown") { e.preventDefault?.(); setSlashIndex((prev) => prev >= filteredCommands.length - 1 ? 0 : prev + 1); return; }
      if (key === "PageUp") { e.preventDefault?.(); setSlashIndex((prev) => Math.max(0, prev - PAGE_SIZE)); return; }
      if (key === "PageDown") { e.preventDefault?.(); setSlashIndex((prev) => Math.min(filteredCommands.length - 1, prev + PAGE_SIZE)); return; }
      if (key === "Home") { e.preventDefault?.(); setSlashIndex(0); return; }
      if (key === "End") { e.preventDefault?.(); setSlashIndex(filteredCommands.length - 1); return; }
      if (key === "Tab" || (key === "Enter" && !isShiftEnter)) { e.preventDefault?.(); handleSelectCommand(filteredCommands[slashIndex]); return; }
      if (key === "Escape") { setShowCommands(false); return; }
    }

    if (Platform.OS === "web" && key === "Enter" && !isShiftEnter) {
      if (isImeComposing) return;
      e.preventDefault?.();
      handleSubmit();
    }
  }, [filteredCommands, handleSelectCommand, handleSubmit, showCommands, slashIndex]);

  // =========================================================================
  // Render
  // =========================================================================

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

      {/* Send error */}
      {!!errorMessage && (
        <Pressable
          onPress={onClearError}
          style={[styles.sendError, { backgroundColor: theme.isDark ? "#3a1a1a" : "#FEE2E2" }]}
        >
          <Text style={[styles.sendErrorText, { color: theme.isDark ? "#FCA5A5" : "#DC2626" }]}>
            {errorMessage}
          </Text>
        </Pressable>
      )}

      {/* Speech error */}
      {speechError && (
        <Pressable
          onPress={clearSpeechError}
          style={[styles.speechError, { backgroundColor: theme.isDark ? "#3a1a1a" : "#FEE2E2" }]}
        >
          <Text style={[styles.speechErrorText, { color: theme.isDark ? "#FCA5A5" : "#DC2626" }]}>
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
                    boxShadow: isFocused ? "0px 2px 6px rgba(0, 0, 0, 0.08)" : "0px 0px 0px rgba(0, 0, 0, 0)",
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
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          accessibilityLabel="Prompt input"
          accessibilityHint="Press Enter to send, Shift+Enter for a new line, and type / for commands."
        />

        <AttachmentChips attachments={attachments} onRemove={removeAttachment} />

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
            <Pressable style={styles.micWaveRow} onPress={handleMicPress} accessibilityRole="button" accessibilityLabel="Stop recording">
              <Square size={12} color="#EF4444" strokeWidth={2} fill="#EF4444" />
              <WaveformBars audioLevel={audioLevel} />
            </Pressable>
          ) : (
            <Pressable style={styles.micButton} onPress={handleMicPress} disabled={inputDisabled} accessibilityRole="button" accessibilityLabel="Start voice input">
              <Mic size={16} color={theme.textMuted} strokeWidth={1.8} />
            </Pressable>
          )}
          <View style={{ flex: 1 }} />
          {contextUsage ? (
            <ContextUsageRing used={contextUsage.used} total={contextUsage.total} isDark={theme.isDark} />
          ) : null}
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
                  <Text style={[styles.queueActionText, { color: theme.textSecondary }]}>
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
              disabled={sendDisabled || (!showAbortButton && !hasDraft)}
              style={({ pressed }) => [
                styles.sendButton,
                {
                  backgroundColor: theme.isDark ? "#4d4d4b" : theme.colors.text,
                  opacity: (sendDisabled || (!showAbortButton && !hasDraft)) ? 0.45 : pressed ? 0.85 : 1,
                },
              ]}
            >
              {showAbortButton ? (
                <Square size={12} color="#FFFFFF" strokeWidth={2} fill="#FFFFFF" />
              ) : (
                <ArrowUp size={16} color={theme.isDark ? "#fefdfd" : theme.colors.background} strokeWidth={2} />
              )}
            </Pressable>
          )}
        </View>
      </Animated.View>

      <View
        style={[
          styles.bottomControlsWrap,
          toolbarPopoverOpen && styles.bottomControlsWrapElevated,
          toolbarHiddenKeepLayout && styles.bottomControlsHidden,
          toolbarCollapsed && styles.bottomControlsCollapsed,
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
          config={agentConfig}
        />
      </View>

      {sessionReady && mobileSheet === "model" && (
        <MobileModelSheet visible sessionId={sessionId} onClose={closeMobileSheet} config={agentConfig} />
      )}
      {sessionReady && mobileSheet === "effort" && (
        <MobileEffortSheet visible sessionId={sessionId} onClose={closeMobileSheet} config={agentConfig} />
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
  sendError: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 6,
  },
  sendErrorText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
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
  bottomControlsHidden: {
    opacity: 0,
    pointerEvents: "none" as const,
  },
  bottomControlsCollapsed: {
    height: 0,
    overflow: "hidden" as const,
    opacity: 0,
    pointerEvents: "none" as const,
  },
});
