import { memo, useRef, useEffect } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';

import { Fonts } from '@/constants/theme';
import { THINKING_LEVELS, ThinkingLevel } from './constants';
import { usePromptTheme } from './use-theme-colors';
import {
  useAgentState,
  useSetThinkingLevel,
} from '@/features/agent/hooks/use-agent-config';

interface MobileEffortSheetProps {
  visible: boolean;
  sessionId?: string | null;
  onClose: () => void;
}

function MobileEffortSheetComponent({
  visible,
  sessionId,
  onClose,
}: MobileEffortSheetProps) {
  const theme = usePromptTheme();
  const slideAnim = useRef(new Animated.Value(300)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  const { data: agentState } = useAgentState(sessionId);
  const setThinkingMutation = useSetThinkingLevel(sessionId);
  const currentThinking = agentState?.thinkingLevel ?? 'medium';

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
    animateClose(() => onClose());
  };

  const handleSelect = (level: ThinkingLevel) => {
    setThinkingMutation.mutate(level);
    animateClose(() => onClose());
  };

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
          <Text style={[styles.title, { color: theme.textPrimary }]}>Thinking Level</Text>
          {THINKING_LEVELS.map((item) => {
            const isActive = item.level === currentThinking;
            return (
              <Pressable
                key={item.level}
                onPress={() => handleSelect(item.level)}
                style={({ pressed }) => [
                  styles.item,
                  pressed && { backgroundColor: theme.hoverBg },
                ]}
              >
                <View>
                  <Text style={[styles.label, { color: isActive ? theme.accentColor : theme.textPrimary }]}>
                    {item.label}
                  </Text>
                  <Text style={[styles.desc, { color: theme.textMuted }]}>
                    {item.description}
                  </Text>
                </View>
                {isActive && <Check size={16} color={theme.accentColor} strokeWidth={2} />}
              </Pressable>
            );
          })}
        </Animated.View>
      </View>
    </Modal>
  );
}

export const MobileEffortSheet = memo(MobileEffortSheetComponent);

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
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  label: {
    fontSize: 13,
    fontFamily: Fonts.sansMedium,
  },
  desc: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    marginTop: 2,
  },
});
