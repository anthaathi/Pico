import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Search,
  FileText,
  FolderOpen,
  Settings,
  User,
  GitBranch,
  Plus,
  Layers,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useWorkspaceStore } from '@/features/workspace/store';
import { usePiClient } from '@pi-ui/client';
import { requestBrowserNotificationPermission } from '@/features/agent/browser-notifications';

interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ComponentType<any>;
  section: string;
  onSelect: () => void;
}

export function CommandPalette({ visible, onClose }: CommandPaletteProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const itemRefs = useRef<Record<number, View | null>>({});
  const scrollContentRef = useRef<View>(null);
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.96)).current;

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const selectWorkspace = useWorkspaceStore((s) => s.selectWorkspace);
  const selectedWorkspaceId = useWorkspaceStore((s) => s.selectedWorkspaceId);
  const piClient = usePiClient();
  const createSessionPending = useRef(false);

  const bg = isDark ? '#1e1e1e' : '#FFFFFF';
  const borderColor = isDark ? '#3b3a39' : 'rgba(0,0,0,0.12)';
  const textPrimary = isDark ? '#fefdfd' : colors.text;
  const textMuted = isDark ? '#cdc8c5' : colors.textTertiary;
  const textDim = isDark ? '#888' : '#999';
  const hoverBg = isDark ? '#2a2a2a' : '#F0F0F0';
  const selectedBg = isDark ? '#333' : '#E8E8E8';

  const commands: CommandItem[] = [
    // Workspaces
    ...workspaces.map((ws) => ({
      id: `ws-${ws.id}`,
      label: ws.title,
      description: ws.path,
      icon: FolderOpen,
      section: 'Workspaces',
      onSelect: () => {
        selectWorkspace(ws.id);
        router.replace(`/workspace/${ws.id}`);
        handleClose();
      },
    })),
    // Actions
    {
      id: 'new-session',
      label: 'New Session',
      description: 'Start a new chat session',
      icon: Plus,
      section: 'Actions',
      onSelect: async () => {
        if (!selectedWorkspaceId || createSessionPending.current) return;
        createSessionPending.current = true;
        requestBrowserNotificationPermission();
        handleClose();
        try {
          const info = await piClient.createAgentSession({
            workspaceId: selectedWorkspaceId,
          });
          router.navigate(
            `/workspace/${selectedWorkspaceId}/s/${info.session_id}`,
          );
        } catch {} finally { createSessionPending.current = false; }
      },
    },
    {
      id: 'new-workspace',
      label: 'New Workspace',
      description: 'Create a new workspace',
      icon: FolderOpen,
      section: 'Actions',
      onSelect: () => handleClose(),
    },
    // Navigation
    {
      id: 'settings',
      label: 'Settings',
      description: 'Open application settings',
      icon: Settings,
      section: 'Navigation',
      onSelect: () => {
        router.push('/settings');
        handleClose();
      },
    },
    {
      id: 'profile',
      label: 'Profile',
      description: 'View your profile',
      icon: User,
      section: 'Navigation',
      onSelect: () => {
        router.push('/profile');
        handleClose();
      },
    },
    // Tools
    {
      id: 'git',
      label: 'Git Status',
      description: 'View git changes and branches',
      icon: GitBranch,
      section: 'Tools',
      onSelect: () => handleClose(),
    },
    {
      id: 'sessions',
      label: 'Sessions',
      description: 'Browse all sessions',
      icon: Layers,
      section: 'Tools',
      onSelect: () => handleClose(),
    },
    {
      id: 'files',
      label: 'Open File',
      description: 'Browse and open project files',
      icon: FileText,
      section: 'Tools',
      onSelect: () => handleClose(),
    },
  ];

  const query = search.toLowerCase();
  const filtered = query
    ? commands.filter(
        (c) =>
          c.label.toLowerCase().includes(query) ||
          c.description?.toLowerCase().includes(query) ||
          c.section.toLowerCase().includes(query)
      )
    : commands;

  // Group by section
  const sections: { title: string; items: CommandItem[] }[] = [];
  for (const item of filtered) {
    let section = sections.find((s) => s.title === item.section);
    if (!section) {
      section = { title: item.section, items: [] };
      sections.push(section);
    }
    section.items.push(item);
  }

  const flatItems = filtered;

  const handleClose = useCallback(() => {
    Animated.parallel([
      Animated.timing(overlayAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 0.96, duration: 120, useNativeDriver: true }),
    ]).start(() => {
      setSearch('');
      onClose();
    });
  }, [onClose, overlayAnim, scaleAnim]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  useEffect(() => {
    const itemView = itemRefs.current[selectedIndex];
    const container = scrollContentRef.current;
    if (itemView && container) {
      itemView.measureLayout(
        container as any,
        (_x, y, _w, h) => {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
        },
        () => {}
      );
    }
  }, [selectedIndex]);

  useEffect(() => {
    if (visible) {
      setSearch('');
      setSelectedIndex(0);
      Animated.parallel([
        Animated.timing(overlayAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, tension: 300, friction: 24, useNativeDriver: true }),
      ]).start();
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible, overlayAnim, scaleAnim]);

  // Keyboard shortcut (Ctrl+P / Cmd+P)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        if (visible) {
          handleClose();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [visible, handleClose]);

  const handleKeyPress = useCallback(
    (e: any) => {
      const key = e.nativeEvent.key;
      if (key === 'ArrowDown') {
        e.preventDefault?.();
        setSelectedIndex((prev) => (prev >= flatItems.length - 1 ? 0 : prev + 1));
      } else if (key === 'ArrowUp') {
        e.preventDefault?.();
        setSelectedIndex((prev) => (prev <= 0 ? flatItems.length - 1 : prev - 1));
      } else if (key === 'Enter') {
        e.preventDefault?.();
        flatItems[selectedIndex]?.onSelect();
      } else if (key === 'Escape') {
        handleClose();
      }
    },
    [flatItems, selectedIndex, handleClose]
  );

  if (!visible) return null;

  let flatIdx = 0;

  return (
    <Modal visible transparent animationType="none" onRequestClose={handleClose}>
      <View style={styles.root}>
        <Animated.View style={[styles.overlay, { opacity: overlayAnim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.palette,
            {
              backgroundColor: bg,
              borderColor,
              transform: [{ scale: scaleAnim }],
              opacity: overlayAnim,
            },
          ]}
        >
          {/* Search input */}
          <View style={[styles.searchRow, { borderBottomColor: borderColor }]}>
            <Search size={16} color={textMuted} strokeWidth={2} />
            <TextInput
              ref={inputRef}
              style={[styles.searchInput, { color: textPrimary }]}
              value={search}
              onChangeText={setSearch}
              onKeyPress={handleKeyPress}
              placeholder="Type a command or search..."
              placeholderTextColor={textDim}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
            />
          </View>

          {/* Results */}
          <ScrollView
            ref={scrollRef}
            style={styles.results}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View ref={scrollContentRef}>
            {sections.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyText, { color: textDim }]}>
                  No results found
                </Text>
              </View>
            )}
            {sections.map((section) => (
              <View key={section.title}>
                <Text style={[styles.sectionHeader, { color: textDim }]}>
                  {section.title}
                </Text>
                {section.items.map((item) => {
                  const idx = flatIdx++;
                  const isSelected = idx === selectedIndex;
                  const Icon = item.icon;
                  return (
                    <Pressable
                      key={item.id}
                      ref={(ref) => { itemRefs.current[idx] = ref as any; }}
                      onPress={item.onSelect}
                      style={({ pressed, hovered }: any) => [
                        styles.item,
                        isSelected && { backgroundColor: selectedBg },
                        !isSelected && (pressed || hovered) && { backgroundColor: hoverBg },
                      ]}
                    >
                      <Icon size={15} color={isSelected ? textPrimary : textMuted} strokeWidth={1.8} />
                      <View style={styles.itemText}>
                        <Text
                          style={[styles.itemLabel, { color: textPrimary }]}
                          numberOfLines={1}
                        >
                          {item.label}
                        </Text>
                        {item.description && (
                          <Text
                            style={[styles.itemDesc, { color: textMuted }]}
                            numberOfLines={1}
                          >
                            {item.description}
                          </Text>
                        )}
                      </View>
                      {isSelected && (
                        <Text style={[styles.enterHint, { color: textDim }]}>
                          {'\u21B5'}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 80,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  palette: {
    width: '90%',
    maxWidth: 560,
    borderRadius: 12,
    borderWidth: 0.633,
    overflow: 'hidden',
    maxHeight: 420,
    boxShadow: '0px 8px 24px rgba(0, 0, 0, 0.15)',
    elevation: 8,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 48,
    gap: 10,
    borderBottomWidth: 0.633,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: Fonts.sans,
    outlineStyle: 'none',
  } as any,
  results: {
    maxHeight: 370,
  },
  sectionHeader: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  itemText: {
    flex: 1,
  },
  itemLabel: {
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
  itemDesc: {
    fontSize: 11,
    fontFamily: Fonts.sans,
    marginTop: 1,
  },
  enterHint: {
    fontSize: 14,
    fontFamily: Fonts.mono,
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
});
