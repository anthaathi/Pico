import { useState, useEffect, useCallback, useRef } from "react";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Github,
  Gitlab,
  PanelLeft,
  Search,
  Settings,
} from "lucide-react-native";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { CommandPalette } from "../command-palette";
import { PiLogo } from "@/components/pi-logo";
import { useServersStore, type Server } from "@/features/servers/store";
import { useAuthStore } from "@/features/auth/store";
import { useWorkspaceStore } from "@/features/workspace/store";
import { useAppMode } from "@/hooks/use-app-mode";
import { useGitStatus, useNestedRepos } from "@/features/workspace/hooks/use-git-status";
import { remotesToLinks, type RemoteLink } from "@/features/workspace/utils/git-remote-url";

function RepoIcon({ host, size, color }: { host: string; size: number; color: string }) {
  if (host === "github") return <Github size={size} color={color} strokeWidth={1.8} />;
  if (host === "gitlab") return <Gitlab size={size} color={color} strokeWidth={1.8} />;
  return <ExternalLink size={size} color={color} strokeWidth={1.8} />;
}

interface HeaderBarProps {
  onToggleSidebar: () => void;
  onToggleChatSidebar?: () => void;
  sidebarVisible: boolean;
}

export function HeaderBar({
  onToggleSidebar,
  onToggleChatSidebar,
}: HeaderBarProps) {
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const isDark = colorScheme === "dark";
  const [paletteVisible, setPaletteVisible] = useState(false);
  const [popoverVisible, setPopoverVisible] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const router = useRouter();

  const activeServerId = useAuthStore((s) => s.activeServerId);
  const activateServer = useAuthStore((s) => s.activateServer);
  const servers = useServersStore((s) => s.servers);
  const activeServer = servers.find((s) => s.id === activeServerId);
  const fetchWorkspaces = useWorkspaceStore((s) => s.fetchWorkspaces);
  const appMode = useAppMode();
  const isCodeMode = appMode === "code";

  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === s.selectedWorkspaceId)
  );
  const cwd = isCodeMode ? (workspace?.path ?? null) : null;
  const { data: gitData } = useGitStatus(cwd);
  const { data: nestedRepos } = useNestedRepos(cwd);
  const [repoMenuVisible, setRepoMenuVisible] = useState(false);

  // Collect all remote links: root repo + nested repos
  const allLinks: Array<RemoteLink & { repoPath?: string }> = [];
  const rootLinks = remotesToLinks(gitData?.remotes);
  for (const link of rootLinks) {
    allLinks.push(link);
  }
  if (nestedRepos) {
    for (const repo of nestedRepos) {
      const links = remotesToLinks(repo.remotes);
      for (const link of links) {
        allLinks.push({ ...link, repoPath: repo.path });
      }
    }
  }
  const hasMultipleLinks = allLinks.length > 1;
  const singleLink = allLinks.length === 1 ? allLinks[0] : null;

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setPaletteVisible(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!popoverVisible || Platform.OS !== "web") return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-server-popover]")) {
        setPopoverVisible(false);
      }
    };
    setTimeout(() => document.addEventListener("click", handler), 0);
    return () => document.removeEventListener("click", handler);
  }, [popoverVisible]);

  const handleSwitchServer = useCallback(
    async (server: Server) => {
      if (server.id === activeServerId) {
        setPopoverVisible(false);
        return;
      }
      setSwitchingId(server.id);
      const ok = await activateServer(server);
      if (ok) {
        await fetchWorkspaces();
        const { workspaces, selectedWorkspaceId } =
          useWorkspaceStore.getState();
        const targetId = selectedWorkspaceId ?? workspaces[0]?.id;
        if (targetId) {
          router.replace(`/workspace/${targetId}`);
        }
      }
      setSwitchingId(null);
      setPopoverVisible(false);
    },
    [activeServerId, activateServer, fetchWorkspaces, router],
  );

  const bg = colors.background;
  const btnBg = isDark ? "#282727" : "#E8E8E8";
  const borderColor = isDark ? "#3b3a39" : "rgba(0,0,0,0.12)";
  const textPrimary = isDark ? "#fefdfd" : colors.text;
  const textMuted = isDark ? "#cdc8c5" : colors.textTertiary;
  const popoverBg = isDark ? "#252525" : "#FFFFFF";
  const hoverBg = isDark ? "#333" : "#F5F5F5";

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <View style={styles.leftSection}>
        <Pressable
          onPress={isCodeMode ? onToggleSidebar : onToggleChatSidebar}
          style={({ pressed }) => [
            styles.sidebarToggle,
            { backgroundColor: btnBg },
            pressed && { opacity: 0.7 },
          ]}
        >
          <PanelLeft size={16} color={textPrimary} strokeWidth={1.8} />
        </Pressable>

        <View {...({ "data-server-popover": true } as any)}>
          <Pressable
            onPress={() => setPopoverVisible((v) => !v)}
            style={({ pressed }) => [
              styles.serverSwitcher,
              pressed && { opacity: 0.7 },
            ]}
          >
            <View
              style={[
                styles.serverIcon,
                { backgroundColor: isDark ? "#fefdfd" : "#1a1a1a" },
              ]}
            >
              <PiLogo size={16} color={isDark ? "#1a1a1a" : "#fff"} />
            </View>
            <Text
              style={[styles.serverName, { color: textPrimary }]}
              numberOfLines={1}
            >
              {activeServer?.name ?? "No Server"}
            </Text>
            <ChevronDown size={12} color={textMuted} strokeWidth={2} />
          </Pressable>

          {popoverVisible && (
            <View
              style={[
                styles.popover,
                {
                  backgroundColor: popoverBg,
                  borderColor,
                },
              ]}
            >
              <View style={styles.popoverHeader}>
                <Text style={[styles.popoverTitle, { color: textMuted }]}>
                  Servers
                </Text>
              </View>
              <ScrollView style={styles.popoverList} bounces={false}>
                {servers.map((server) => {
                  const isActive = server.id === activeServerId;
                  const isSwitching = server.id === switchingId;
                  return (
                    <Pressable
                      key={server.id}
                      onPress={() => handleSwitchServer(server)}
                      disabled={isSwitching}
                      style={({ pressed, hovered }: any) => [
                        styles.popoverItem,
                        isActive && {
                          backgroundColor: isDark
                            ? "rgba(255,255,255,0.06)"
                            : "rgba(0,0,0,0.04)",
                        },
                        (pressed || hovered) && { backgroundColor: hoverBg },
                      ]}
                    >
                      <View
                        style={[
                          styles.popoverItemIcon,
                          { backgroundColor: isDark ? "#fefdfd" : "#1a1a1a" },
                        ]}
                      >
                        <PiLogo size={10} color={isDark ? "#1a1a1a" : "#fff"} />
                      </View>
                      <View style={styles.popoverItemInfo}>
                        <Text
                          style={[
                            styles.popoverItemName,
                            { color: textPrimary },
                          ]}
                          numberOfLines={1}
                        >
                          {server.name}
                        </Text>
                        <Text
                          style={[
                            styles.popoverItemAddress,
                            { color: textMuted },
                          ]}
                          numberOfLines={1}
                        >
                          {server.address}
                        </Text>
                      </View>
                      {isActive && (
                        <Check size={14} color="#34C759" strokeWidth={2.5} />
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View
                style={[styles.popoverFooter, { borderTopColor: borderColor }]}
              >
                <Pressable
                  onPress={() => {
                    setPopoverVisible(false);
                    router.push("/servers");
                  }}
                  style={({ pressed, hovered }: any) => [
                    styles.popoverFooterBtn,
                    (pressed || hovered) && { backgroundColor: hoverBg },
                  ]}
                >
                  <Settings size={13} color={textMuted} strokeWidth={1.8} />
                  <Text
                    style={[styles.popoverFooterText, { color: textMuted }]}
                  >
                    Manage Servers
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>

      <View style={styles.centerSection} />

      <CommandPalette
        visible={paletteVisible}
        onClose={() => setPaletteVisible(false)}
      />

      <View style={styles.rightSection}>
        {singleLink && (
          <Pressable
            onPress={() => Linking.openURL(singleLink.browserUrl)}
            style={({ pressed }) => [
              styles.repoBtn,
              { backgroundColor: isDark ? "#2A2A2A" : "#F0F0F0" },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Open in ${singleLink.label}`}
          >
            <RepoIcon host={singleLink.host} size={14} color={textMuted} />
            <Text style={[styles.repoBtnLabel, { color: textMuted }]}>
              Open in {singleLink.label}
            </Text>
          </Pressable>
        )}
        {hasMultipleLinks && (
          <View>
            <Pressable
              onPress={() => setRepoMenuVisible((v) => !v)}
              style={({ pressed }) => [
                styles.repoBtn,
                { backgroundColor: isDark ? "#2A2A2A" : "#F0F0F0" },
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Open repository"
            >
              <RepoIcon host={allLinks[0].host} size={14} color={textMuted} />
              <Text style={[styles.repoBtnLabel, { color: textMuted }]}>
                Open in {allLinks[0].label} +{allLinks.length - 1}
              </Text>
              <ChevronDown size={12} color={textMuted} strokeWidth={1.8} />
            </Pressable>
            {repoMenuVisible && (
              <>
                <Pressable
                  style={StyleSheet.absoluteFill}
                  onPress={() => setRepoMenuVisible(false)}
                />
                <View
                  style={[
                    styles.repoMenu,
                    {
                      backgroundColor: isDark ? "#2A2A2A" : "#FFFFFF",
                      borderColor: isDark ? "#3A3A3A" : "#E0E0E0",
                    },
                  ]}
                >
                  {allLinks.map((link, i) => (
                    <Pressable
                      key={`${link.browserUrl}-${i}`}
                      onPress={() => {
                        Linking.openURL(link.browserUrl);
                        setRepoMenuVisible(false);
                      }}
                      style={({ pressed }) => [
                        styles.repoMenuItem,
                        pressed && { backgroundColor: isDark ? "#333" : "#F0F0F0" },
                      ]}
                    >
                      <View style={styles.repoMenuItemRow}>
                        <RepoIcon host={link.host} size={14} color={textMuted} />
                        <View style={styles.repoMenuItemText}>
                          <Text
                            style={[styles.repoMenuLabel, { color: textPrimary }]}
                            numberOfLines={1}
                          >
                            {link.repoPath
                              ? `${link.repoPath}`
                              : `${link.name}`}
                          </Text>
                          <Text
                            style={[styles.repoMenuUrl, { color: textMuted }]}
                            numberOfLines={1}
                          >
                            {link.browserUrl.replace("https://", "")}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </View>
        )}
        <Pressable
          onPress={() => setPaletteVisible(true)}
          style={({ pressed }) => [
            styles.headerBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Search size={16} color={textMuted} strokeWidth={1.8} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 8,
    zIndex: 100,
  },
  leftSection: {
    flexDirection: "row",
    alignItems: "center",
  },
  centerSection: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  sidebarToggle: {
    width: 32,
    height: 24,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 16,
    marginRight: 9,
  },
  serverSwitcher: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 8,
    paddingRight: 8,
    height: 32,
  },
  serverIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  serverName: {
    fontSize: 13,
    fontFamily: Fonts.sansMedium,
    maxWidth: 120,
  },
  popover: {
    position: "absolute",
    top: 36,
    left: 0,
    width: 260,
    borderRadius: 10,
    borderWidth: 0.633,
    zIndex: 1000,
    boxShadow: "0px 6px 16px rgba(0, 0, 0, 0.15)",
    elevation: 12,
    overflow: "hidden",
  },
  popoverHeader: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
  popoverTitle: {
    fontSize: 11,
    fontFamily: Fonts.sansSemiBold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  popoverList: {
    maxHeight: 240,
  },
  popoverItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  popoverItemIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  popoverItemInfo: {
    flex: 1,
  },
  popoverItemName: {
    fontSize: 13,
    fontFamily: Fonts.sansMedium,
  },
  popoverItemAddress: {
    fontSize: 11,
    fontFamily: Fonts.sans,
    marginTop: 1,
  },
  popoverFooter: {
    borderTopWidth: 0.633,
    paddingVertical: 4,
  },
  popoverFooterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  popoverFooterText: {
    fontSize: 13,
    fontFamily: Fonts.sansMedium,
  },
  headerBtn: {
    width: 32,
    height: 24,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },

  rightSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  repoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 26,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  repoBtnLabel: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
    fontWeight: "500" as const,
  },
  repoMenu: {
    position: "absolute",
    top: 30,
    right: 0,
    minWidth: 240,
    maxWidth: 360,
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 4,
    zIndex: 100,
    ...Platform.select({
      web: { boxShadow: "0 4px 16px rgba(0,0,0,0.15)" },
      default: { elevation: 8 },
    }),
  } as any,
  repoMenuItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  repoMenuItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  repoMenuItemText: {
    flex: 1,
  },
  repoMenuLabel: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
    fontWeight: "500" as const,
  },
  repoMenuUrl: {
    fontSize: 11,
    fontFamily: Fonts.mono,
    marginTop: 1,
  },

});
