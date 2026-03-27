import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Palette,
  Bell,
  Shield,
  Info,
  ChevronRight,
  Moon,
  Sun,
  Monitor,
  Trash2,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
} from 'lucide-react-native';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppSettingsStore, ThemeMode } from '@/features/settings/store';
import { SpeechSettings } from '@/features/speech/components/speech-settings';
import { CustomModelsSection } from '@/features/settings/components/custom-models-section';
import { AgentModesSection } from '@/features/settings/components/agent-modes-section';
import { useChatStore } from '@/features/chat/store';
import { sdk, unwrapApiData } from '@pi-ui/client';
import type { PackageStatus } from '@pi-ui/client';
const {
  status2: getPackageStatus,
  update: updatePackage,
  install: installPackage,
} = sdk;

// ─── Shared components ────────────────────────────────────────

function SettingsSection({
  title,
  icon: Icon,
  children,
  isDark,
  textPrimary,
}: {
  title: string;
  icon: React.ComponentType<any>;
  children: React.ReactNode;
  isDark: boolean;
  textPrimary: string;
}) {
  const borderColor = isDark ? '#2a2a2a' : 'rgba(0,0,0,0.08)';
  const cardBg = isDark ? '#1a1a1a' : '#FFFFFF';

  return (
    <View style={sectionStyles.container}>
      <View style={sectionStyles.header}>
        <Icon size={15} color={textPrimary} strokeWidth={1.8} />
        <Text style={[sectionStyles.title, { color: textPrimary }]}>{title}</Text>
      </View>
      <View style={[sectionStyles.card, { backgroundColor: cardBg, borderColor }]}>
        {children}
      </View>
    </View>
  );
}

function SettingsRow({
  label,
  description,
  isDark,
  right,
  onPress,
  isLast,
}: {
  label: string;
  description?: string;
  isDark: boolean;
  right?: React.ReactNode;
  onPress?: () => void;
  isLast?: boolean;
}) {
  const textPrimary = isDark ? '#fefdfd' : '#1a1a1a';
  const textMuted = isDark ? '#cdc8c5' : '#888';
  const borderColor = isDark ? '#2a2a2a' : 'rgba(0,0,0,0.06)';

  const content = (
    <View style={[rowStyles.row, !isLast && { borderBottomWidth: 0.633, borderBottomColor: borderColor }]}>
      <View style={rowStyles.textCol}>
        <Text style={[rowStyles.label, { color: textPrimary }]}>{label}</Text>
        {description && (
          <Text style={[rowStyles.desc, { color: textMuted }]}>{description}</Text>
        )}
      </View>
      {right ?? (
        onPress ? <ChevronRight size={16} color={textMuted} strokeWidth={1.8} /> : null
      )}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.7 }}>
        {content}
      </Pressable>
    );
  }
  return content;
}

// ─── Package Update Section ───────────────────────────────────

function PackageUpdateSection({
  isDark,
  textPrimary,
  textMuted,
}: {
  isDark: boolean;
  textPrimary: string;
  textMuted: string;
}) {
  const borderColor = isDark ? '#2a2a2a' : 'rgba(0,0,0,0.08)';
  const cardBg = isDark ? '#1a1a1a' : '#FFFFFF';

  const [pkg, setPkg] = useState<PackageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPackageStatus();
      const data = unwrapApiData(result.data) as PackageStatus | undefined;
      setPkg(data ?? null);
    } catch {
      setError('Could not fetch package status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleUpdate = useCallback(async () => {
    setUpdating(true);
    setError(null);
    setSuccess(null);
    try {
      if (pkg && !pkg.installed) {
        await installPackage();
        setSuccess('Pi agent installed successfully');
      } else {
        await updatePackage();
        setSuccess('Pi agent updated successfully');
      }
      await fetchStatus();
    } catch {
      setError('Update failed. Check server logs for details.');
    } finally {
      setUpdating(false);
    }
  }, [pkg, fetchStatus]);

  const hasUpdate =
    pkg?.installed &&
    pkg.latest_version &&
    pkg.installed_version &&
    pkg.latest_version !== pkg.installed_version;

  return (
    <View style={sectionStyles.container}>
      <View style={sectionStyles.header}>
        <Download size={15} color={textPrimary} strokeWidth={1.8} />
        <Text style={[sectionStyles.title, { color: textPrimary }]}>
          Pi Agent
        </Text>
      </View>
      <View style={[sectionStyles.card, { backgroundColor: cardBg, borderColor }]}>
        {loading ? (
          <View style={updateStyles.row}>
            <ActivityIndicator size="small" color={textMuted} />
            <Text style={[updateStyles.statusText, { color: textMuted }]}>
              Checking for updates...
            </Text>
          </View>
        ) : pkg ? (
          <>
            <View style={updateStyles.infoRow}>
              <View style={updateStyles.infoCol}>
                <Text style={[rowStyles.label, { color: textPrimary }]}>
                  {pkg.name}
                </Text>
                {pkg.installed ? (
                  <Text style={[rowStyles.desc, { color: textMuted }]}>
                    Installed: {pkg.installed_version ?? 'unknown'}
                    {pkg.latest_version ? ` · Latest: ${pkg.latest_version}` : ''}
                  </Text>
                ) : (
                  <Text style={[rowStyles.desc, { color: textMuted }]}>
                    Not installed
                    {pkg.latest_version ? ` · Latest: ${pkg.latest_version}` : ''}
                  </Text>
                )}
              </View>

              {!pkg.installed ? (
                <Pressable
                  onPress={handleUpdate}
                  disabled={updating}
                  style={({ pressed }) => [
                    updateStyles.actionBtn,
                    { backgroundColor: isDark ? '#fefdfd' : '#1a1a1a' },
                    pressed && { opacity: 0.7 },
                    updating && { opacity: 0.5 },
                  ]}
                >
                  {updating ? (
                    <ActivityIndicator size="small" color={isDark ? '#1a1a1a' : '#fff'} />
                  ) : (
                    <>
                      <Download size={13} color={isDark ? '#1a1a1a' : '#fff'} strokeWidth={2} />
                      <Text style={[updateStyles.actionBtnText, { color: isDark ? '#1a1a1a' : '#fff' }]}>
                        Install
                      </Text>
                    </>
                  )}
                </Pressable>
              ) : hasUpdate ? (
                <Pressable
                  onPress={handleUpdate}
                  disabled={updating}
                  style={({ pressed }) => [
                    updateStyles.actionBtn,
                    { backgroundColor: isDark ? '#fefdfd' : '#1a1a1a' },
                    pressed && { opacity: 0.7 },
                    updating && { opacity: 0.5 },
                  ]}
                >
                  {updating ? (
                    <ActivityIndicator size="small" color={isDark ? '#1a1a1a' : '#fff'} />
                  ) : (
                    <>
                      <RefreshCw size={13} color={isDark ? '#1a1a1a' : '#fff'} strokeWidth={2} />
                      <Text style={[updateStyles.actionBtnText, { color: isDark ? '#1a1a1a' : '#fff' }]}>
                        Update
                      </Text>
                    </>
                  )}
                </Pressable>
              ) : (
                <View style={updateStyles.upToDateBadge}>
                  <CheckCircle2 size={13} color="#34C759" strokeWidth={2} />
                  <Text style={updateStyles.upToDateText}>Up to date</Text>
                </View>
              )}
            </View>

            {success && (
              <View style={[updateStyles.messageBanner, { backgroundColor: 'rgba(52, 199, 89, 0.08)' }]}>
                <CheckCircle2 size={13} color="#34C759" strokeWidth={2} />
                <Text style={[updateStyles.messageText, { color: '#34C759' }]}>
                  {success}
                </Text>
              </View>
            )}
            {error && (
              <View style={[updateStyles.messageBanner, { backgroundColor: 'rgba(215, 25, 33, 0.08)' }]}>
                <AlertCircle size={13} color="#D71921" strokeWidth={2} />
                <Text style={[updateStyles.messageText, { color: '#D71921' }]}>
                  {error}
                </Text>
              </View>
            )}
          </>
        ) : error ? (
          <View style={updateStyles.row}>
            <AlertCircle size={14} color="#D71921" strokeWidth={1.8} />
            <Text style={[updateStyles.statusText, { color: '#D71921' }]}>
              {error}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  const textPrimary = isDark ? '#fefdfd' : colors.text;
  const textMuted = isDark ? '#cdc8c5' : colors.textTertiary;
  const bg = isDark ? '#121212' : colors.background;

  const { themeMode, pushNotifications, soundEffects, diffPanelAutoOpen, loaded, load, update } =
    useAppSettingsStore();

  const chatNoTools = useChatStore((s) => s.noTools);
  const setChatNoTools = useChatStore((s) => s.setNoTools);
  const chatLoaded = useChatStore((s) => s.loaded);
  const loadChat = useChatStore((s) => s.load);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  useEffect(() => {
    if (!chatLoaded) loadChat();
  }, [chatLoaded, loadChat]);

  const themes: { key: ThemeMode; icon: React.ComponentType<any>; label: string }[] = [
    { key: 'light', icon: Sun, label: 'Light' },
    { key: 'dark', icon: Moon, label: 'Dark' },
    { key: 'system', icon: Monitor, label: 'System' },
  ];

  return (
    <View style={[styles.outerContainer, { backgroundColor: bg }]}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: textPrimary }]}>Settings</Text>
          <Text style={[styles.description, { color: textMuted }]}>
            Configure your workspace and preferences.
          </Text>
        </View>

        {/* Pi Agent Update */}
        <PackageUpdateSection isDark={isDark} textPrimary={textPrimary} textMuted={textMuted} />

        {/* Agent Modes */}
        <AgentModesSection isDark={isDark} />

        {/* Custom Models */}
        <CustomModelsSection isDark={isDark} />

        {/* Chat */}
        <SettingsSection title="Chat" icon={MessageSquare} isDark={isDark} textPrimary={textPrimary}>
          <SettingsRow
            label="Enable Tools"
            description="Allow the model to use tools (read, write, bash, etc.) in chat sessions"
            isDark={isDark}
            right={
              <Switch
                value={!chatNoTools}
                onValueChange={(v) => setChatNoTools(!v)}
                trackColor={{ false: isDark ? '#3b3a39' : '#E0E0E0', true: '#D71921' }}
              />
            }
          />
          <SettingsRow
            label="Auto-open Diff Panel"
            description="Automatically show file changes in the sidebar when the agent edits or writes files"
            isDark={isDark}
            right={
              <Switch
                value={diffPanelAutoOpen}
                onValueChange={(v) => update({ diffPanelAutoOpen: v })}
                trackColor={{ false: isDark ? '#3b3a39' : '#E0E0E0', true: '#D71921' }}
              />
            }
            isLast
          />
        </SettingsSection>

        {/* Appearance */}
        <SettingsSection title="Appearance" icon={Palette} isDark={isDark} textPrimary={textPrimary}>
          <View style={rowStyles.row}>
            <View style={rowStyles.textCol}>
              <Text style={[rowStyles.label, { color: textPrimary }]}>Theme</Text>
              <Text style={[rowStyles.desc, { color: textMuted }]}>
                {themeMode === 'system' ? 'Following system' : themeMode === 'dark' ? 'Dark mode' : 'Light mode'}
              </Text>
            </View>
            <View style={rowStyles.themeIcons}>
              {themes.map(({ key, icon: Icon }) => {
                const isActive = themeMode === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => update({ themeMode: key })}
                    style={[
                      rowStyles.themeBtn,
                      isActive && {
                        backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
                      },
                    ]}
                  >
                    <Icon
                      size={14}
                      color={isActive ? textPrimary : textMuted}
                      strokeWidth={1.8}
                    />
                  </Pressable>
                );
              })}
            </View>
          </View>
        </SettingsSection>

        {/* Speech */}
        <SpeechSettings />

        {/* Notifications */}
        <SettingsSection title="Notifications" icon={Bell} isDark={isDark} textPrimary={textPrimary}>
          <SettingsRow
            label="Push Notifications"
            description="Receive alerts for session updates"
            isDark={isDark}
            right={
              <Switch
                value={pushNotifications}
                onValueChange={(v) => update({ pushNotifications: v })}
                trackColor={{ false: isDark ? '#3b3a39' : '#E0E0E0', true: '#D71921' }}
              />
            }
          />
          <SettingsRow
            label="Sound Effects"
            description="Play sounds for actions and alerts"
            isDark={isDark}
            right={
              <Switch
                value={soundEffects}
                onValueChange={(v) => update({ soundEffects: v })}
                trackColor={{ false: isDark ? '#3b3a39' : '#E0E0E0', true: '#D71921' }}
              />
            }
            isLast
          />
        </SettingsSection>

        {/* Data */}
        <SettingsSection title="Data" icon={Shield} isDark={isDark} textPrimary={textPrimary}>
          <SettingsRow
            label="Clear Local Data"
            description="Remove cached data and preferences"
            isDark={isDark}
            onPress={() => {
              update({ themeMode: 'system', pushNotifications: true, soundEffects: false });
            }}
            right={<Trash2 size={16} color={textMuted} strokeWidth={1.8} />}
            isLast
          />
        </SettingsSection>

        {/* About */}
        <SettingsSection title="About" icon={Info} isDark={isDark} textPrimary={textPrimary}>
          <SettingsRow
            label="Version"
            isDark={isDark}
            right={<Text style={[rowStyles.valueText, { color: textMuted }]}>1.0.0</Text>}
          />
          <SettingsRow
            label="Licenses"
            isDark={isDark}
            onPress={() => {}}
            isLast
          />
        </SettingsSection>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    alignItems: 'center',
  },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 600,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 20,
  },
  header: {
    gap: 4,
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontFamily: Fonts.sansBold,
  },
  description: {
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
});

const sectionStyles = StyleSheet.create({
  container: {
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 4,
  },
  title: {
    fontSize: 14,
    fontFamily: Fonts.sansSemiBold,
  },
  card: {
    borderRadius: 12,
    borderWidth: 0.633,
    overflow: 'hidden',
  },
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  textCol: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
  desc: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    marginTop: 2,
  },
  valueText: {
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
  themeIcons: {
    flexDirection: 'row',
    gap: 4,
  },
  themeBtn: {
    width: 32,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const updateStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  statusText: {
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  infoCol: {
    flex: 1,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 6,
  },
  actionBtnText: {
    fontSize: 12,
    fontFamily: Fonts.sansSemiBold,
  },
  upToDateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
    backgroundColor: 'rgba(52, 199, 89, 0.1)',
  },
  upToDateText: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
    color: '#34C759',
  },
  messageBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  messageText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    flex: 1,
  },
});
