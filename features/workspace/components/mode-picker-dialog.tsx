import { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Star, Layers, Check, CircleOff } from 'lucide-react-native';

import { Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { AgentMode } from '@pi-ui/client';

const NO_MODE_ID = '__none__';

interface ModePickerDialogProps {
  visible: boolean;
  modes: AgentMode[];
  onSelect: (mode: AgentMode) => void;
  onSkip: () => void;
}

export function ModePickerDialog({
  visible,
  modes,
  onSelect,
  onSkip,
}: ModePickerDialogProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';

  const userDefault = useMemo(() => modes.find((m) => m.is_default), [modes]);
  const [selectedId, setSelectedId] = useState<string>(
    userDefault?.id ?? NO_MODE_ID,
  );

  const handleConfirm = useCallback(() => {
    if (selectedId === NO_MODE_ID) {
      onSkip();
    } else {
      const mode = modes.find((m) => m.id === selectedId);
      if (mode) {
        onSelect(mode);
      } else {
        onSkip();
      }
    }
  }, [modes, selectedId, onSelect, onSkip]);

  const bg = isDark ? '#1e1e1c' : '#FFFFFF';
  const overlayBg = 'rgba(0,0,0,0.5)';
  const textPrimary = isDark ? '#fefdfd' : '#1a1a1a';
  const textMuted = isDark ? '#cdc8c5' : '#888';
  const borderColor = isDark ? '#2a2a2a' : 'rgba(0,0,0,0.1)';
  const selectedBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)';
  const selectedBorder = isDark ? '#555' : '#aaa';

  const isNoneSelected = selectedId === NO_MODE_ID;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={[styles.overlay, { backgroundColor: overlayBg }]}>
        <View style={[styles.dialog, { backgroundColor: bg, borderColor }]}>
          <View style={styles.header}>
            <Layers size={18} color={textPrimary} strokeWidth={1.8} />
            <Text style={[styles.title, { color: textPrimary }]}>Select Mode</Text>
          </View>
          <Text style={[styles.subtitle, { color: textMuted }]}>
            Choose how the agent should be configured for this session.
          </Text>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            <Pressable
              onPress={() => setSelectedId(NO_MODE_ID)}
              style={[
                styles.option,
                {
                  borderColor: isNoneSelected ? selectedBorder : borderColor,
                  backgroundColor: isNoneSelected ? selectedBg : 'transparent',
                },
              ]}
            >
              <View style={styles.optionHeader}>
                <View style={styles.optionNameRow}>
                  <CircleOff size={14} color={textMuted} strokeWidth={1.8} />
                  <Text style={[styles.optionName, { color: textPrimary }]}>
                    Default
                  </Text>
                </View>
                {isNoneSelected && (
                  <Check size={16} color={textPrimary} strokeWidth={2} />
                )}
              </View>
              <Text style={[styles.optionDesc, { color: textMuted }]}>
                No extra configuration — standard pi session
              </Text>
            </Pressable>

            {modes.map((mode) => {
              const isSelected = selectedId === mode.id;
              const parts: string[] = [];
              if (mode.model) parts.push(mode.model);
              if (mode.thinking_level) parts.push(`thinking: ${mode.thinking_level}`);
              if (mode.extensions.length) parts.push(`${mode.extensions.length} ext`);

              return (
                <Pressable
                  key={mode.id}
                  onPress={() => setSelectedId(mode.id)}
                  style={[
                    styles.option,
                    {
                      borderColor: isSelected ? selectedBorder : borderColor,
                      backgroundColor: isSelected ? selectedBg : 'transparent',
                    },
                  ]}
                >
                  <View style={styles.optionHeader}>
                    <View style={styles.optionNameRow}>
                      <Text style={[styles.optionName, { color: textPrimary }]}>
                        {mode.name}
                      </Text>
                      {mode.is_default && (
                        <Star size={12} color="#E8A300" fill="#E8A300" strokeWidth={1.8} />
                      )}
                    </View>
                    {isSelected && (
                      <Check size={16} color={textPrimary} strokeWidth={2} />
                    )}
                  </View>
                  {mode.description ? (
                    <Text
                      style={[styles.optionDesc, { color: textMuted }]}
                      numberOfLines={2}
                    >
                      {mode.description}
                    </Text>
                  ) : null}
                  {parts.length > 0 && (
                    <Text
                      style={[styles.optionDetail, { color: textMuted }]}
                      numberOfLines={1}
                    >
                      {parts.join(' · ')}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={handleConfirm}
              style={({ pressed }) => [
                styles.btn,
                {
                  backgroundColor: isDark ? '#fefdfd' : '#1a1a1a',
                  borderColor: isDark ? '#fefdfd' : '#1a1a1a',
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text
                style={[
                  styles.btnText,
                  { color: isDark ? '#1a1a1a' : '#fff' },
                ]}
              >
                Start Session
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 14,
    borderWidth: 0.633,
    padding: 20,
    gap: 12,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 17,
    fontFamily: Fonts.sansSemiBold,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
  list: {
    maxHeight: 320,
  },
  listContent: {
    gap: 8,
  },
  option: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  optionName: {
    fontSize: 14,
    fontFamily: Fonts.sansMedium,
  },
  optionDesc: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
  optionDetail: {
    fontSize: 11,
    fontFamily: Fonts.mono,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 0.633,
  },
  btnText: {
    fontSize: 13,
    fontFamily: Fonts.sansMedium,
  },
});
