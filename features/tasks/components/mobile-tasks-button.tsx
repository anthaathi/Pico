import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ListTodo } from 'lucide-react-native';

import { Fonts } from '@/constants/theme';
import { useTasksStore } from '../store';
import { useWorkspaceStore } from '@/features/workspace/store';

interface MobileTasksButtonProps {
  color: string;
  bgColor: string;
  onPress: () => void;
}

export function MobileTasksButton({ color, bgColor, onPress }: MobileTasksButtonProps) {
  const instances = useTasksStore((s) => s.instances);
  const hasConfig = useTasksStore((s) => s.hasConfig);
  const fetchConfig = useTasksStore((s) => s.fetchConfig);
  const fetchInstances = useTasksStore((s) => s.fetchInstances);

  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === s.selectedWorkspaceId),
  );

  useEffect(() => {
    if (workspace?.id) {
      fetchConfig(workspace.id);
      fetchInstances(workspace.id);
    }
  }, [workspace?.id, fetchConfig, fetchInstances]);

  const runningCount = instances.filter((i) => i.status === 'running').length;

  if (!hasConfig && instances.length === 0) return null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: bgColor },
        pressed && { opacity: 0.7 },
      ]}
      accessibilityRole="button"
      accessibilityLabel="Tasks"
    >
      <ListTodo size={16} color={color} strokeWidth={1.8} />
      {runningCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{runningCount}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    width: 32,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#34C759',
    borderRadius: 6,
    minWidth: 12,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  badgeText: {
    color: '#fff',
    fontSize: 8,
    fontFamily: Fonts.sansSemiBold,
    fontWeight: '600',
  },
});
