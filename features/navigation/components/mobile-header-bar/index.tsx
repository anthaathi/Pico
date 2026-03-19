import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GitBranch, PanelLeft, SquarePen } from 'lucide-react-native';
import { useRouter } from 'expo-router';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppMode } from '@/hooks/use-app-mode';
import { useWorkspaceStore } from '@/features/workspace/store';
import { useChatStore } from '@/features/chat/store';

interface MobileHeaderBarProps {
  onWorkspacePress: () => void;
  onGitPress: () => void;
  onChatSessionsPress?: () => void;
}

export function MobileHeaderBar({ onWorkspacePress, onGitPress, onChatSessionsPress }: MobileHeaderBarProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const appMode = useAppMode();
  const router = useRouter();
  const selectChatSession = useChatStore((s) => s.selectSession);

  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === s.selectedWorkspaceId)
  );

  const textPrimary = isDark ? '#fefdfd' : colors.text;
  const borderColor = isDark ? '#323131' : 'rgba(0,0,0,0.08)';
  const buttonBg = isDark ? '#2F2D2C' : '#F7F4EE';

  const handleNewChatPress = () => {
    selectChatSession(null);
    router.replace('/chat');
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          borderBottomColor: borderColor,
        },
      ]}
    >
      <View style={styles.leftSection}>
        {appMode === 'chat' && (
          <Pressable
            onPress={onChatSessionsPress}
            style={({ pressed }) => [
              styles.menuButton,
              { backgroundColor: buttonBg },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Open chat sessions"
          >
            <PanelLeft size={16} color={textPrimary} strokeWidth={1.8} />
          </Pressable>
        )}

        <Pressable
          onPress={appMode === 'code' ? onWorkspacePress : onChatSessionsPress}
          style={({ pressed }) => [
            styles.workspaceButton,
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={appMode === 'chat' ? 'Open chat sessions' : 'Open workspace switcher'}
        >
          {appMode === 'code' && workspace && (
            <View style={[styles.avatar, { backgroundColor: workspace.color }]}>
              <Text style={styles.avatarInitial}>
                {workspace.title.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={[styles.workspaceName, { color: textPrimary }]} numberOfLines={1}>
            {appMode === 'chat' ? 'Chat' : (workspace?.title ?? 'Workspace')}
          </Text>
        </Pressable>
      </View>

      <View style={styles.headerActions}>
        {appMode === 'code' && (
          <Pressable
            onPress={onGitPress}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: buttonBg },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Git changes"
          >
            <GitBranch size={16} color={textPrimary} strokeWidth={1.8} />
          </Pressable>
        )}
        {appMode === 'chat' && (
          <Pressable
            onPress={handleNewChatPress}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: buttonBg },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Start new chat"
          >
            <SquarePen size={16} color={textPrimary} strokeWidth={1.8} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    minHeight: 40,
    paddingVertical: 8,
    borderBottomWidth: 0.633,
  },
  leftSection: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  menuButton: {
    width: 32,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  workspaceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
    minHeight: 24,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontSize: 11,
    fontFamily: Fonts.sansSemiBold,
  },
  workspaceName: {
    fontSize: 15,
    fontFamily: Fonts.sansMedium,
    flex: 1,
    lineHeight: 18,
  },
  headerActions: {
    minWidth: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    justifyContent: 'flex-end',
  },
  iconButton: {
    width: 32,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
