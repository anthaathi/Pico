import { memo, useRef, useState, useEffect } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, X } from 'lucide-react-native';

import { Fonts } from '@/constants/theme';
import { matchesModelSearch } from './model-search';
import { usePromptTheme } from './use-theme-colors';
import { ProviderIcon } from './provider-icons';
import {
  useAgentModels,
  useAgentState,
  useSetModel,
  type ModelInfo,
} from '@/features/agent/hooks/use-agent-config';

interface MobileModelSheetProps {
  visible: boolean;
  sessionId?: string | null;
  onClose: () => void;
}

function MobileModelSheetComponent({
  visible,
  sessionId,
  onClose,
}: MobileModelSheetProps) {
  const theme = usePromptTheme();
  const searchRef = useRef<TextInput>(null);
  const [search, setSearch] = useState('');
  const slideAnim = useRef(new Animated.Value(300)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  const { data: models } = useAgentModels(sessionId);
  const { data: agentState } = useAgentState(sessionId);
  const setModelMutation = useSetModel(sessionId);
  const currentModel = agentState?.model;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(overlayAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 120, friction: 14, useNativeDriver: true }),
      ]).start();
    }
  }, [overlayAnim, slideAnim, visible]);

  const animateClose = (cb: () => void) => {
    Animated.parallel([
      Animated.timing(overlayAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 300, duration: 200, useNativeDriver: true }),
    ]).start(() => cb());
  };

  const handleClose = () => {
    animateClose(() => {
      setSearch('');
      onClose();
    });
  };

  const handleSelect = (provider: string, modelId: string) => {
    setModelMutation.mutate({ provider, modelId });
    animateClose(() => {
      setSearch('');
      onClose();
    });
  };

  const providers = (() => {
    if (!models) return [];
    const grouped = new Map<string, ModelInfo[]>();
    const order: string[] = [];
    for (const m of models) {
      if (!matchesModelSearch(search, m)) continue;
      if (!grouped.has(m.provider)) {
        grouped.set(m.provider, []);
        order.push(m.provider);
      }
      grouped.get(m.provider)!.push(m);
    }
    return order.map((p) => ({ name: p, models: grouped.get(p)! }));
  })();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
    >
      <View style={styles.modalRoot}>
        <Animated.View style={[styles.overlay, { opacity: overlayAnim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.container,
            { backgroundColor: theme.isDark ? '#1e1e1e' : '#FFFFFF', transform: [{ translateY: slideAnim }] },
          ]}
        >
          <View style={styles.handle}>
            <View style={[styles.handleBar, { backgroundColor: theme.isDark ? '#555' : '#CCC' }]} />
          </View>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Select Model</Text>
          <View style={[styles.searchRow, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
            <TextInput
              ref={searchRef}
              style={[styles.searchInput, { color: theme.textPrimary }]}
              value={search}
              onChangeText={setSearch}
              placeholder="Search models..."
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')}>
                <X size={16} color={theme.textMuted} strokeWidth={2} />
              </Pressable>
            )}
          </View>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {providers.map((provider) => (
              <View key={provider.name}>
                <Text style={[styles.providerHeader, { color: theme.sectionColor }]}>
                  {provider.name}
                </Text>
                {provider.models.map((model) => {
                  const isActive = model.id === currentModel?.id;
                  return (
                    <Pressable
                      key={model.id}
                      onPress={() => handleSelect(model.provider, model.id)}
                      style={({ pressed }) => [
                        styles.item,
                        pressed && { backgroundColor: theme.hoverBg },
                      ]}
                    >
                      <View style={styles.modelRow}>
                        <ProviderIcon provider={model.provider} size={14} color={isActive ? theme.accentColor : theme.textMuted} />
                        <Text style={[styles.modelName, { color: isActive ? theme.accentColor : theme.textPrimary }]}>
                          {model.name}
                        </Text>
                      </View>
                      {isActive && <Check size={16} color={theme.accentColor} strokeWidth={2} />}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

export const MobileModelSheet = memo(MobileModelSheetComponent);

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  container: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingBottom: 34,
    maxHeight: '70%',
  },
  handle: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  title: {
    fontSize: 15,
    fontFamily: Fonts.sansSemiBold,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 12,
    height: 40,
    borderRadius: 8,
    borderWidth: 0.633,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: Fonts.sans,
    outlineStyle: 'none',
  } as any,
  scroll: {
    maxHeight: 400,
  },
  providerHeader: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modelName: {
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
});
