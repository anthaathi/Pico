import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Play,
  Square,
  RotateCcw,
  ListTodo,
  Circle,
  X,
  ChevronDown,
  ChevronRight,
  Trash2,
} from 'lucide-react-native';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTasksStore } from '../../store';
import { useWorkspaceStore } from '@/features/workspace/store';
import type { TaskDefinition, TaskInfo } from '../../types';

const SOURCE_COLORS: Record<string, string> = {
  npm: '#CB3837',
  yarn: '#2C8EBB',
  pnpm: '#F69220',
  bun: '#FBF0DF',
  make: '#6D8086',
  cargo: '#CE412B',
  docker: '#2496ED',
  python: '#3776AB',
  rake: '#CC342D',
  gradle: '#02303A',
  deno: '#000000',
  pi: '#8B5CF6',
};

const SOURCE_LABELS: Record<string, string> = {
  npm: 'npm',
  yarn: 'yarn',
  pnpm: 'pnpm',
  bun: 'bun',
  make: 'make',
  cargo: 'cargo',
  docker: 'docker',
  python: 'py',
  rake: 'rake',
  gradle: 'gradle',
  deno: 'deno',
  pi: 'pi',
};

function SourceBadge({ source, isDark }: { source: string; isDark: boolean }) {
  const bg = SOURCE_COLORS[source] ?? (isDark ? '#555' : '#999');
  const label = SOURCE_LABELS[source] ?? source;
  // Use white text on dark badges, dark text on light badges
  const textColor = source === 'bun' ? '#000' : '#fff';
  return (
    <View style={[styles.sourceBadge, { backgroundColor: bg }]}>
      <Text style={[styles.sourceBadgeText, { color: textColor }]}>
        {label}
      </Text>
    </View>
  );
}

function StatusDot({ status }: { status: TaskInfo['status'] }) {
  const color =
    status === 'running'
      ? '#34C759'
      : status === 'failed'
        ? '#FF3B30'
        : '#8E8E93';
  return (
    <Circle
      size={8}
      color={color}
      fill={color}
      strokeWidth={0}
    />
  );
}

export function TasksButton() {
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const textMuted = isDark ? '#cdc8c5' : Colors[colorScheme].textTertiary;

  const panelOpen = useTasksStore((s) => s.panelOpen);
  const togglePanel = useTasksStore((s) => s.togglePanel);
  const instances = useTasksStore((s) => s.instances);
  const hasConfig = useTasksStore((s) => s.hasConfig);
  const fetchConfig = useTasksStore((s) => s.fetchConfig);
  const fetchInstances = useTasksStore((s) => s.fetchInstances);

  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === s.selectedWorkspaceId)
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
    <View>
      <Pressable
        onPress={togglePanel}
        style={({ pressed }) => [
          styles.taskBtn,
          { backgroundColor: isDark ? '#2A2A2A' : '#F0F0F0' },
          pressed && { opacity: 0.7 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Tasks"
      >
        <ListTodo size={14} color={textMuted} strokeWidth={1.8} />
        <Text style={[styles.taskBtnLabel, { color: textMuted }]}>Tasks</Text>
        {runningCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{runningCount}</Text>
          </View>
        )}
      </Pressable>

      {panelOpen && <TasksPanel />}
    </View>
  );
}

function TasksPanel() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const textPrimary = isDark ? '#fefdfd' : colors.text;
  const textMuted = isDark ? '#cdc8c5' : colors.textTertiary;
  const popoverBg = isDark ? '#252525' : '#FFFFFF';
  const borderColor = isDark ? '#3b3a39' : 'rgba(0,0,0,0.12)';
  const hoverBg = isDark ? '#333' : '#F5F5F5';
  const logBg = isDark ? '#1a1a1a' : '#F5F5F5';

  const definitions = useTasksStore((s) => s.definitions);
  const instances = useTasksStore((s) => s.instances);
  const logsById = useTasksStore((s) => s.logsById);
  const selectedTaskId = useTasksStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useTasksStore((s) => s.setSelectedTaskId);
  const startTask = useTasksStore((s) => s.startTask);
  const stopTask = useTasksStore((s) => s.stopTask);
  const restartTask = useTasksStore((s) => s.restartTask);
  const removeTask = useTasksStore((s) => s.removeTask);
  const fetchLogs = useTasksStore((s) => s.fetchLogs);
  const setPanelOpen = useTasksStore((s) => s.setPanelOpen);
  const loading = useTasksStore((s) => s.loading);

  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === s.selectedWorkspaceId)
  );
  const workspaceId = workspace?.id ?? '';

  const logScrollRef = useRef<ScrollView>(null);
  const [expandedSection, setExpandedSection] = useState<'available' | 'running' | null>('running');

  // Auto-fetch logs when selecting a task
  useEffect(() => {
    if (selectedTaskId) {
      fetchLogs(selectedTaskId);
    }
  }, [selectedTaskId, fetchLogs]);

  // Auto-scroll logs
  useEffect(() => {
    if (selectedTaskId && logScrollRef.current) {
      setTimeout(() => logScrollRef.current?.scrollToEnd({ animated: false }), 50);
    }
  }, [selectedTaskId, logsById]);

  // Close popover when clicking outside (web)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-tasks-panel]')) {
        setPanelOpen(false);
      }
    };
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [setPanelOpen]);

  const handleStart = useCallback(
    (label: string) => {
      startTask(label, workspaceId);
    },
    [startTask, workspaceId],
  );

  const handleStop = useCallback(
    (taskId: string) => {
      stopTask(taskId);
    },
    [stopTask],
  );

  const handleRestart = useCallback(
    (taskId: string) => {
      restartTask(taskId);
    },
    [restartTask],
  );

  const handleRemove = useCallback(
    (taskId: string) => {
      removeTask(taskId);
    },
    [removeTask],
  );

  const selectedLogs = selectedTaskId ? logsById[selectedTaskId] ?? [] : [];
  const selectedInstance = instances.find((i) => i.id === selectedTaskId);

  // Available tasks = definitions not currently running
  const runningLabels = new Set(
    instances.filter((i) => i.status === 'running').map((i) => i.label),
  );
  const availableTasks = definitions.filter(
    (d) => !runningLabels.has(d.label),
  );

  return (
    <View
      {...({ 'data-tasks-panel': true } as any)}
      style={[
        styles.panel,
        {
          backgroundColor: popoverBg,
          borderColor,
        },
      ]}
    >
      {/* Header */}
      <View style={[styles.panelHeader, { borderBottomColor: borderColor }]}>
        <Text style={[styles.panelTitle, { color: textPrimary }]}>Tasks</Text>
        <Pressable onPress={() => setPanelOpen(false)} style={styles.closeBtn}>
          <X size={14} color={textMuted} strokeWidth={2} />
        </Pressable>
      </View>

      <View style={styles.panelBody}>
        {/* Left side: task list */}
        <View style={[styles.taskList, { borderRightColor: borderColor }]}>
          {/* Running tasks section */}
          {instances.length > 0 && (
            <>
              <Pressable
                onPress={() =>
                  setExpandedSection(expandedSection === 'running' ? null : 'running')
                }
                style={styles.sectionHeader}
              >
                {expandedSection === 'running' ? (
                  <ChevronDown size={12} color={textMuted} strokeWidth={2} />
                ) : (
                  <ChevronRight size={12} color={textMuted} strokeWidth={2} />
                )}
                <Text style={[styles.sectionTitle, { color: textMuted }]}>
                  ACTIVE ({instances.length})
                </Text>
              </Pressable>
              {expandedSection === 'running' && (
                <ScrollView style={styles.sectionList} bounces={false}>
                  {instances.map((instance) => (
                    <TaskInstanceRow
                      key={instance.id}
                      instance={instance}
                      isSelected={instance.id === selectedTaskId}
                      onSelect={() => setSelectedTaskId(instance.id)}
                      onStop={() => handleStop(instance.id)}
                      onRestart={() => handleRestart(instance.id)}
                      onRemove={() => handleRemove(instance.id)}
                      textPrimary={textPrimary}
                      textMuted={textMuted}
                      hoverBg={hoverBg}
                      isDark={isDark}
                    />
                  ))}
                </ScrollView>
              )}
            </>
          )}

          {/* Available tasks section */}
          {availableTasks.length > 0 && (
            <>
              <Pressable
                onPress={() =>
                  setExpandedSection(
                    expandedSection === 'available' ? null : 'available',
                  )
                }
                style={styles.sectionHeader}
              >
                {expandedSection === 'available' ? (
                  <ChevronDown size={12} color={textMuted} strokeWidth={2} />
                ) : (
                  <ChevronRight size={12} color={textMuted} strokeWidth={2} />
                )}
                <Text style={[styles.sectionTitle, { color: textMuted }]}>
                  AVAILABLE ({availableTasks.length})
                </Text>
              </Pressable>
              {expandedSection === 'available' && (
                <ScrollView style={styles.sectionList} bounces={false}>
                  {availableTasks.map((def) => (
                    <AvailableTaskRow
                      key={def.label}
                      definition={def}
                      onStart={() => handleStart(def.label)}
                      textPrimary={textPrimary}
                      textMuted={textMuted}
                      hoverBg={hoverBg}
                      loading={loading}
                      isDark={isDark}
                    />
                  ))}
                </ScrollView>
              )}
            </>
          )}

          {instances.length === 0 && availableTasks.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyText, { color: textMuted }]}>
                No tasks configured.{'\n'}Add .pi/tasks.json to your workspace.
              </Text>
            </View>
          )}
        </View>

        {/* Right side: log viewer */}
        <View style={[styles.logView, { backgroundColor: logBg }]}>
          {selectedInstance ? (
            <>
              <View style={[styles.logHeader, { borderBottomColor: borderColor }]}>
                <StatusDot status={selectedInstance.status} />
                <SourceBadge source={selectedInstance.source ?? 'pi'} isDark={isDark} />
                <Text
                  style={[styles.logHeaderLabel, { color: textPrimary }]}
                  numberOfLines={1}
                >
                  {selectedInstance.label}
                </Text>
                <Text style={[styles.logHeaderCmd, { color: textMuted }]} numberOfLines={1}>
                  {selectedInstance.command}
                </Text>
              </View>
              <ScrollView
                ref={logScrollRef}
                style={styles.logContent}
                bounces={false}
              >
                {selectedLogs.length === 0 ? (
                  <Text style={[styles.logLine, { color: textMuted }]}>
                    No output yet...
                  </Text>
                ) : (
                  selectedLogs.map((line, i) => (
                    <Text
                      key={i}
                      style={[styles.logLine, { color: textPrimary }]}
                      selectable
                    >
                      {line}
                    </Text>
                  ))
                )}
              </ScrollView>
            </>
          ) : (
            <View style={styles.logPlaceholder}>
              <Text style={[styles.emptyText, { color: textMuted }]}>
                Select a task to view logs
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function TaskInstanceRow({
  instance,
  isSelected,
  onSelect,
  onStop,
  onRestart,
  onRemove,
  textPrimary,
  textMuted,
  hoverBg,
  isDark,
}: {
  instance: TaskInfo;
  isSelected: boolean;
  onSelect: () => void;
  onStop: () => void;
  onRestart: () => void;
  onRemove: () => void;
  textPrimary: string;
  textMuted: string;
  hoverBg: string;
  isDark: boolean;
}) {
  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed, hovered }: any) => [
        styles.taskRow,
        isSelected && {
          backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        },
        (pressed || hovered) && { backgroundColor: hoverBg },
      ]}
    >
      <StatusDot status={instance.status} />
      <SourceBadge source={instance.source ?? 'pi'} isDark={isDark} />
      <View style={styles.taskRowInfo}>
        <Text
          style={[styles.taskRowLabel, { color: textPrimary }]}
          numberOfLines={1}
        >
          {instance.label}
        </Text>
        <Text
          style={[styles.taskRowCmd, { color: textMuted }]}
          numberOfLines={1}
        >
          {instance.command}
        </Text>
      </View>
      <View style={styles.taskRowActions}>
        {instance.status === 'running' ? (
          <>
            <Pressable onPress={onRestart} style={styles.actionBtn} accessibilityLabel="Restart task">
              <RotateCcw size={12} color={textMuted} strokeWidth={2} />
            </Pressable>
            <Pressable onPress={onStop} style={styles.actionBtn} accessibilityLabel="Stop task">
              <Square size={12} color="#FF3B30" strokeWidth={2} />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable onPress={onRestart} style={styles.actionBtn} accessibilityLabel="Restart task">
              <Play size={12} color="#34C759" strokeWidth={2} />
            </Pressable>
            <Pressable onPress={onRemove} style={styles.actionBtn} accessibilityLabel="Remove task">
              <Trash2 size={12} color={textMuted} strokeWidth={2} />
            </Pressable>
          </>
        )}
      </View>
    </Pressable>
  );
}

function AvailableTaskRow({
  definition,
  onStart,
  textPrimary,
  textMuted,
  hoverBg,
  loading,
  isDark,
}: {
  definition: TaskDefinition;
  onStart: () => void;
  textPrimary: string;
  textMuted: string;
  hoverBg: string;
  loading: boolean;
  isDark: boolean;
}) {
  return (
    <Pressable
      onPress={onStart}
      disabled={loading}
      style={({ pressed, hovered }: any) => [
        styles.taskRow,
        (pressed || hovered) && { backgroundColor: hoverBg },
        loading && { opacity: 0.5 },
      ]}
    >
      <Play size={10} color="#34C759" strokeWidth={2.5} />
      <SourceBadge source={definition.source ?? 'pi'} isDark={isDark} />
      <View style={styles.taskRowInfo}>
        <Text
          style={[styles.taskRowLabel, { color: textPrimary }]}
          numberOfLines={1}
        >
          {definition.label}
        </Text>
        <Text
          style={[styles.taskRowCmd, { color: textMuted }]}
          numberOfLines={1}
        >
          {definition.command}
        </Text>
      </View>
      {definition.group && (
        <View style={[styles.groupBadge, { borderColor: textMuted }]}>
          <Text style={[styles.groupBadgeText, { color: textMuted }]}>
            {definition.group}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  taskBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 26,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  taskBtnLabel: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
    fontWeight: '500',
  },
  badge: {
    backgroundColor: '#34C759',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: Fonts.sansSemiBold,
    fontWeight: '600',
  },
  panel: {
    position: 'absolute',
    top: 30,
    right: 0,
    width: 560,
    height: 380,
    borderRadius: 10,
    borderWidth: 0.633,
    zIndex: 1000,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 8px 24px rgba(0,0,0,0.2)' },
      default: { elevation: 16 },
    }),
  } as any,
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 0.633,
  },
  panelTitle: {
    fontSize: 13,
    fontFamily: Fonts.sansSemiBold,
    fontWeight: '600',
  },
  closeBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelBody: {
    flex: 1,
    flexDirection: 'row',
  },
  taskList: {
    width: 220,
    borderRightWidth: 0.633,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: Fonts.sansSemiBold,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  sectionList: {
    maxHeight: 160,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  taskRowInfo: {
    flex: 1,
    minWidth: 0,
  },
  taskRowLabel: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
    fontWeight: '500',
  },
  taskRowCmd: {
    fontSize: 10,
    fontFamily: Fonts.mono,
    marginTop: 1,
  },
  taskRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  actionBtn: {
    width: 22,
    height: 22,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceBadge: {
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    alignSelf: 'flex-start',
  },
  sourceBadgeText: {
    fontSize: 8,
    fontFamily: Fonts.sansSemiBold,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  groupBadge: {
    borderWidth: 0.633,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  groupBadgeText: {
    fontSize: 9,
    fontFamily: Fonts.sansMedium,
    fontWeight: '500',
  },
  logView: {
    flex: 1,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 0.633,
  },
  logHeaderLabel: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
    fontWeight: '500',
  },
  logHeaderCmd: {
    fontSize: 10,
    fontFamily: Fonts.mono,
    flex: 1,
  },
  logContent: {
    flex: 1,
    padding: 8,
  },
  logLine: {
    fontSize: 11,
    fontFamily: Fonts.mono,
    lineHeight: 16,
  },
  logPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  emptyText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    textAlign: 'center',
    lineHeight: 18,
  },
});
