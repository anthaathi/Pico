import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  View,
} from 'react-native';
import { ChevronDown, Check } from 'lucide-react-native';

import { Fonts } from '@/constants/theme';
import { THINKING_LEVELS, FlatModel, ThinkingLevel } from './constants';
import { matchesModelSearch } from './model-search';
import { usePromptTheme } from './use-theme-colors';
import { ProviderIcon } from './provider-icons';
import {
  useAgentModels,
  useAgentState,
  useSetAgentMode,
  useSetModel,
  useSetThinkingLevel,
  type ModelInfo,
} from '@/features/agent/hooks/use-agent-config';
import type { AgentMode } from '@/features/agent/mode';
import { useAppMode } from '@/hooks/use-app-mode';

interface ToolbarProps {
  sessionId?: string | null;
  isWideScreen: boolean;
  onOpenMobileSheet: (type: 'model' | 'effort') => void;
  onDropdownOpenChange?: (isOpen: boolean) => void;
  inputRef: React.RefObject<TextInput | null>;
  skeleton?: React.ReactNode;
  modeLabel?: string | null;
  ready?: boolean;
}

type DropdownType = null | 'model' | 'effort';

export function Toolbar({
  sessionId,
  isWideScreen,
  onOpenMobileSheet,
  onDropdownOpenChange,
  inputRef,
  skeleton = null,
  modeLabel = null,
  ready = true,
}: ToolbarProps) {
  const theme = usePromptTheme();
  const appMode = useAppMode();
  const modelScrollRef = useRef<ScrollView>(null);
  const modelSearchRef = useRef<TextInput>(null);

  const { data: models, isLoading: modelsLoading } = useAgentModels(sessionId);
  const { data: agentState, isLoading: stateLoading } = useAgentState(sessionId);
  const setModelMutation = useSetModel(sessionId);
  const setThinkingMutation = useSetThinkingLevel(sessionId);
  const setModeMutation = useSetAgentMode(sessionId);

  const currentModel = agentState?.model;
  const currentThinking = agentState?.thinkingLevel ?? 'medium';
  const currentMode: AgentMode =
    agentState?.mode ?? (modeLabel?.trim().toLowerCase() === 'plan' ? 'plan' : 'chat');
  const thinkingLabel = THINKING_LEVELS.find((t) => t.level === currentThinking)?.label ?? currentThinking;
  const [pendingMode, setPendingMode] = useState<AgentMode | null>(null);
  const displayedMode = pendingMode ?? currentMode;

  const [activeDropdown, setActiveDropdown] = useState<DropdownType>(null);
  const [popoverIndex, setPopoverIndex] = useState(0);
  const [modelSearch, setModelSearch] = useState('');
  const toolbarDropdownAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(toolbarDropdownAnim, {
      toValue: activeDropdown ? 1 : 0,
      tension: 300,
      friction: 26,
      useNativeDriver: true,
    }).start();
  }, [activeDropdown, toolbarDropdownAnim]);

  useEffect(() => {
    onDropdownOpenChange?.(activeDropdown !== null);
    return () => onDropdownOpenChange?.(false);
  }, [activeDropdown, onDropdownOpenChange]);

  useEffect(() => {
    setPendingMode(null);
  }, [sessionId]);

  useEffect(() => {
    if (pendingMode && currentMode === pendingMode) {
      setPendingMode(null);
    }
  }, [currentMode, pendingMode]);

  useEffect(() => {
    if (!pendingMode) return;
    const timeoutId = setTimeout(() => setPendingMode(null), 4000);
    return () => clearTimeout(timeoutId);
  }, [pendingMode]);

  const providers = useMemo(() => {
    if (!models) return [];
    const grouped = new Map<string, ModelInfo[]>();
    const order: string[] = [];
    for (const m of models) {
      if (!matchesModelSearch(modelSearch, m)) continue;
      if (!grouped.has(m.provider)) {
        grouped.set(m.provider, []);
        order.push(m.provider);
      }
      grouped.get(m.provider)!.push(m);
    }
    return order.map((p) => ({ name: p, models: grouped.get(p)! }));
  }, [models, modelSearch]);

  const flatModels = useMemo<FlatModel[]>(() => {
    const list: FlatModel[] = [];
    for (const p of providers) {
      for (const m of p.models) {
        list.push({ provider: m.provider, modelId: m.id, modelName: m.name });
      }
    }
    return list;
  }, [providers]);

  useEffect(() => {
    if (activeDropdown === 'model' && modelScrollRef.current) {
      modelScrollRef.current.scrollTo({
        y: Math.max(0, popoverIndex * 34 - 60),
        animated: true,
      });
    }
  }, [popoverIndex, activeDropdown]);

  const handleSelectModel = useCallback((provider: string, modelId: string) => {
    setModelMutation.mutate({ provider, modelId });
    setActiveDropdown(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [setModelMutation, inputRef]);

  const handleSelectThinking = useCallback((level: ThinkingLevel) => {
    setThinkingMutation.mutate(level);
    setActiveDropdown(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [setThinkingMutation, inputRef]);

  const handleSelectMode = useCallback((mode: AgentMode) => {
    if (mode === currentMode) {
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    setPendingMode(mode);
    setModeMutation.mutate({
      mode,
      currentMode,
    }, {
      onError: () => setPendingMode(null),
    });
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [currentMode, inputRef, setModeMutation]);

  const toggleDropdown = useCallback(
    (type: DropdownType) => {
      setActiveDropdown((prev) => {
        if (prev === type) {
          setTimeout(() => inputRef.current?.focus(), 0);
          return null;
        }
        if (type === 'model') {
          setModelSearch('');
          const idx = flatModels.findIndex(
            (m) => m.modelId === currentModel?.id && m.provider === currentModel?.provider
          );
          setPopoverIndex(idx >= 0 ? idx : 0);
          setTimeout(() => modelSearchRef.current?.focus(), 50);
        } else if (type === 'effort') {
          const idx = THINKING_LEVELS.findIndex((e) => e.level === currentThinking);
          setPopoverIndex(idx >= 0 ? idx : 0);
          setTimeout(() => inputRef.current?.focus(), 0);
        }
        return type;
      });
    },
    [flatModels, currentModel, currentThinking, inputRef]
  );

  const handleSearchKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const key = e.nativeEvent.key;
      const maxIdx = flatModels.length - 1;
      if (key === 'ArrowDown') {
        e.preventDefault?.();
        setPopoverIndex((p) => (p >= maxIdx ? 0 : p + 1));
      } else if (key === 'ArrowUp') {
        e.preventDefault?.();
        setPopoverIndex((p) => (p <= 0 ? maxIdx : p - 1));
      } else if (key === 'PageDown') {
        e.preventDefault?.();
        setPopoverIndex((p) => Math.min(maxIdx, p + 5));
      } else if (key === 'PageUp') {
        e.preventDefault?.();
        setPopoverIndex((p) => Math.max(0, p - 5));
      } else if (key === 'Home') {
        e.preventDefault?.();
        setPopoverIndex(0);
      } else if (key === 'End') {
        e.preventDefault?.();
        setPopoverIndex(maxIdx);
      } else if (key === 'Enter' || key === 'Tab') {
        e.preventDefault?.();
        const item = flatModels[popoverIndex];
        if (item) handleSelectModel(item.provider, item.modelId);
      } else if (key === 'Escape') {
        setActiveDropdown(null);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    },
    [flatModels, popoverIndex, handleSelectModel, inputRef]
  );

  if (!ready || modelsLoading || stateLoading || !agentState) return <>{skeleton}</>;

  return (
    <View style={[styles.wrap, activeDropdown && { zIndex: 10 }]}>
      <View
        style={[
          styles.toolbar,
          { backgroundColor: theme.toolbarBg, borderColor: theme.toolbarBorder },
        ]}
      >
        <View style={styles.popoverAnchor}>
          <Pressable
            onPress={() => isWideScreen ? toggleDropdown('model') : onOpenMobileSheet('model')}
            accessibilityRole="button"
            accessibilityLabel={`Model: ${currentModel?.name ?? 'Loading'}. Press to change.`}
            accessibilityState={{ expanded: activeDropdown === 'model' }}
            style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
          >
            <ProviderIcon provider={currentModel?.provider ?? ''} size={14} color={theme.textMuted} />
            <Text style={[styles.buttonText, { color: theme.textSecondary }]} numberOfLines={1}>
              {currentModel?.name ?? '…'}
            </Text>
            <ChevronDown size={14} color={theme.textMuted} strokeWidth={1.8} />
          </Pressable>

          {isWideScreen && activeDropdown === 'model' && (
            <Animated.View
              accessibilityRole="menu"
              accessibilityLabel="Model selection"
              style={[
                styles.popover,
                {
                  backgroundColor: theme.dropdownBg,
                  borderColor: theme.dropdownBorder,
                  opacity: toolbarDropdownAnim,
                  transform: [
                    {
                      translateY: toolbarDropdownAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [4, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={[styles.searchWrap, { borderBottomColor: theme.dropdownBorder }]}>
                <TextInput
                  ref={modelSearchRef}
                  placeholder="Search models..."
                  placeholderTextColor={theme.textMuted}
                  style={[styles.searchInput, { color: theme.textPrimary }]}
                  value={modelSearch}
                  onChangeText={(v) => { setModelSearch(v); setPopoverIndex(0); }}
                  onKeyPress={handleSearchKeyPress}
                  accessibilityLabel="Search models"
                />
              </View>
              <ScrollView
                ref={modelScrollRef}
                style={styles.popoverScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {providers.length === 0 && (
                  <Text style={[styles.noResults, { color: theme.textMuted }]}>
                    No models found
                  </Text>
                )}
                {providers.map((provider) => (
                  <View key={provider.name} accessibilityRole="none">
                    <Text
                      style={[styles.providerHeader, { color: theme.sectionColor }]}
                      accessibilityRole="header"
                    >
                      {provider.name}
                    </Text>
                    {provider.models.map((model) => {
                      const flatIdx = flatModels.findIndex(
                        (m) => m.modelId === model.id && m.provider === model.provider
                      );
                      const isHighlighted = flatIdx === popoverIndex;
                      const isActive = model.id === currentModel?.id;
                      return (
                        <Pressable
                          key={model.id}
                          onPress={() => handleSelectModel(model.provider, model.id)}
                          accessibilityRole="menuitem"
                          accessibilityLabel={`${model.name} by ${model.provider}`}
                          accessibilityState={{ selected: isActive }}
                          style={({ pressed, hovered }: any) => [
                            styles.modelItem,
                            isHighlighted && { backgroundColor: theme.selectedBg },
                            (pressed || hovered) && !isHighlighted && { backgroundColor: theme.hoverBg },
                          ]}
                        >
                          <View style={styles.modelRow}>
                            <ProviderIcon provider={model.provider} size={14} color={isActive ? theme.accentColor : theme.textMuted} />
                            <Text style={[styles.modelName, { color: isActive ? theme.accentColor : theme.textPrimary }]}>
                              {model.name}
                            </Text>
                          </View>
                          {isActive && <Check size={14} color={theme.accentColor} strokeWidth={2} />}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </ScrollView>
            </Animated.View>
          )}
        </View>

        <View style={styles.popoverAnchor}>
          <Pressable
            onPress={() => isWideScreen ? toggleDropdown('effort') : onOpenMobileSheet('effort')}
            accessibilityRole="button"
            accessibilityLabel={`Thinking: ${thinkingLabel}. Press to change.`}
            accessibilityState={{ expanded: activeDropdown === 'effort' }}
            style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
          >
            <Text style={[styles.buttonText, { color: theme.textSecondary }]}>
              {thinkingLabel}
            </Text>
            <ChevronDown size={14} color={theme.textMuted} strokeWidth={1.8} />
          </Pressable>

          {isWideScreen && activeDropdown === 'effort' && (
            <Animated.View
              accessibilityRole="menu"
              accessibilityLabel="Thinking level selection"
              style={[
                styles.popover,
                {
                  backgroundColor: theme.dropdownBg,
                  borderColor: theme.dropdownBorder,
                  opacity: toolbarDropdownAnim,
                  transform: [
                    {
                      translateY: toolbarDropdownAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [4, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              {THINKING_LEVELS.map((item, index) => {
                const isHighlighted = index === popoverIndex;
                const isActive = item.level === currentThinking;
                return (
                  <Pressable
                    key={item.level}
                    onPress={() => handleSelectThinking(item.level)}
                    accessibilityRole="menuitem"
                    accessibilityLabel={`${item.label} — ${item.description}`}
                    accessibilityState={{ selected: isActive }}
                    style={({ pressed, hovered }: any) => [
                      styles.effortItem,
                      isHighlighted && { backgroundColor: theme.selectedBg },
                      (pressed || hovered) && !isHighlighted && { backgroundColor: theme.hoverBg },
                    ]}
                  >
                    <View style={styles.effortRow}>
                      <Text style={[styles.effortLabel, { color: isActive ? theme.accentColor : theme.textPrimary }]}>
                        {item.label}
                      </Text>
                      {isActive && <Check size={14} color={theme.accentColor} strokeWidth={2} />}
                    </View>
                    <Text style={[styles.effortDesc, { color: theme.textMuted }]}>
                      {item.description}
                    </Text>
                  </Pressable>
                );
              })}
            </Animated.View>
          )}
        </View>

        <View style={styles.spacer} />
        {appMode === 'code' && <View
          style={[
            styles.modeToggle,
            {
              backgroundColor: theme.isDark ? '#242422' : '#ECEBE7',
              borderColor: theme.toolbarBorder,
            },
          ]}
        >
          {(['chat', 'plan'] as AgentMode[]).map((mode) => {
            const isActive = displayedMode === mode;
            const isPendingTarget = pendingMode === mode;
            return (
              <Pressable
                key={mode}
                accessibilityRole="button"
                accessibilityLabel={
                  isPendingTarget
                    ? `Switching to ${mode} mode`
                    : `Switch to ${mode} mode`
                }
                accessibilityState={{
                  selected: isActive,
                  disabled: setModeMutation.isPending,
                }}
                disabled={setModeMutation.isPending}
                onPress={() => handleSelectMode(mode)}
                style={({ pressed }) => [
                  styles.modeButton,
                  isActive && {
                    backgroundColor: theme.isDark ? '#343432' : '#FFFFFF',
                  },
                  pressed && !isActive && { opacity: 0.72 },
                ]}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    {
                      color: isActive ? theme.textPrimary : theme.textMuted,
                      opacity: isPendingTarget ? 0 : 1,
                    },
                  ]}
                >
                  {mode === 'chat' ? 'Chat' : 'Plan'}
                </Text>
                {isPendingTarget && (
                  <ActivityIndicator
                    size="small"
                    color={isActive ? theme.textPrimary : theme.textMuted}
                    style={styles.modePendingIndicator}
                  />
                )}
              </Pressable>
            );
          })}
        </View>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: -10,
    paddingTop: 10,
    marginHorizontal: 6,
    overflow: 'visible',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: Platform.OS === 'web' ? 7 : 9,
    borderWidth: 0.633,
    borderTopWidth: 0,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    gap: 2,
    marginTop: Platform.OS === 'android' ? -4 : 0,
    zIndex: Platform.OS === 'android' ? 1 : 5,
  },
  spacer: {
    flex: 1,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: Platform.OS === 'web' ? 26 : 30,
    paddingHorizontal: 8,
    borderRadius: 6,
    maxWidth: 200,
  },
  buttonText: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
    flexShrink: 1,
  },
  modeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 0.633,
    borderRadius: 999,
    padding: 1,
    marginRight: 8,
  },
  modeButton: {
    height: Platform.OS === 'web' ? 26 : 30,
    borderRadius: 999,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  modeButtonText: {
    fontSize: 10,
    fontFamily: Fonts.sansMedium,
    letterSpacing: 0.2,
  },
  modePendingIndicator: {
    position: 'absolute',
    alignSelf: 'center',
  },
  popoverAnchor: {
    position: 'relative',
  },
  popover: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    marginBottom: 6,
    minWidth: 220,
    borderRadius: 10,
    borderWidth: 0.633,
    overflow: 'hidden',
    boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.15)',
    elevation: 8,
    zIndex: 10,
  },
  popoverScroll: {
    maxHeight: 320,
  },
  searchWrap: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 0.633,
  },
  searchInput: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    height: 28,
    paddingHorizontal: 6,
    outlineStyle: 'none',
  } as any,
  noResults: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlign: 'center',
  },
  providerHeader: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
  },
  modelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    height: 34,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  modelName: {
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
  effortItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  effortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  effortLabel: {
    fontSize: 13,
    fontFamily: Fonts.sansMedium,
  },
  effortDesc: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    marginTop: 2,
  },
});
