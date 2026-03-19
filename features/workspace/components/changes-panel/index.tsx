import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useWorkspaceStore } from "@/features/workspace/store";
import {
  useGitStatus,
  useGitLog,
  useFileDiff,
} from "@/features/workspace/hooks/use-git-status";
import { FileTree } from "../file-tree";

import type { Tab } from "./constants";
import { useChangesTheme } from "./use-theme-colors";
import { TabBar } from "./tab-bar";
import { BranchBar } from "./branch-bar";
import { ChangesTab } from "./changes-tab";
import { HistoryTab } from "./history-tab";
import { CommitBar, StageAllBar } from "./commit-bar";

export function ChangesPanel() {
  const { textMuted, surfaceBg } = useChangesTheme();

  const [activeTab, setActiveTab] = useState<Tab>("changes");
  const [commitMsg, setCommitMsg] = useState("");
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);
  const [untrackedOpen, setUntrackedOpen] = useState(true);
  const [selectedFile, setSelectedFile] = useState<{
    path: string;
    staged: boolean;
  } | null>(null);
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const handleToggleDir = useCallback((dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }, []);

  const workspace = useWorkspaceStore((s) => {
    const id = s.selectedWorkspaceId;
    return s.workspaces.find((w) => w.id === id);
  });
  const cwd = workspace?.path ?? null;

  const {
    data: gitData,
    isLoading,
    isGitRepo,
    stage,
    unstage,
    discard,
    commit,
    isCommitting,
    refresh,
  } = useGitStatus(cwd);

  const { data: logEntries, isLoading: logLoading } = useGitLog(
    isGitRepo && activeTab === "history" ? cwd : null,
  );

  const { data: fileDiffData, isLoading: diffLoading } = useFileDiff(
    isGitRepo ? cwd : null,
    selectedFile?.path ?? null,
    selectedFile?.staged ?? false,
  );

  useEffect(() => {
    setActiveTab("changes");
    setCommitMsg("");
    setStagedOpen(true);
    setUnstagedOpen(true);
    setUntrackedOpen(true);
    setSelectedFile(null);
    setViewingFile(null);
    setExpandedDirs(new Set());
  }, [cwd]);

  useEffect(() => {
    if (!isGitRepo) {
      setSelectedFile(null);
    }
  }, [isGitRepo]);

  const handleFilePress = useCallback(
    (path: string, staged: boolean) => {
      if (selectedFile?.path === path && selectedFile?.staged === staged) {
        setSelectedFile(null);
      } else {
        setSelectedFile({ path, staged });
      }
    },
    [selectedFile],
  );

  const staged = gitData?.staged ?? [];
  const unstaged = gitData?.unstaged ?? [];
  const untracked = gitData?.untracked ?? [];
  const totalChanges = staged.length + unstaged.length + untracked.length;
  const tabs: Tab[] = isGitRepo
    ? ["changes", "files", "history"]
    : ["files"];
  const currentTab: Tab = isGitRepo ? activeTab : "files";

  const handleStageAll = useCallback(() => {
    const paths = [...unstaged.map((f) => f.path), ...untracked];
    if (paths.length > 0) stage(paths);
  }, [unstaged, untracked, stage]);

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim() || staged.length === 0 || isCommitting) return;
    await commit(commitMsg.trim());
    setCommitMsg("");
  }, [commitMsg, staged.length, isCommitting, commit]);

  return (
    <View style={[styles.container, { backgroundColor: surfaceBg }]}>
      <TabBar
        activeTab={currentTab}
        onTabChange={setActiveTab}
        totalChanges={totalChanges}
        tabs={tabs}
      />

      {isGitRepo && gitData && (
        <BranchBar
          branch={gitData.branch}
          ahead={gitData.ahead}
          behind={gitData.behind}
          onRefresh={refresh}
        />
      )}

      <View style={styles.tabPanels}>
        <View
          {...(Platform.OS !== "web"
            ? { pointerEvents: currentTab === "files" ? ("auto" as const) : ("none" as const) }
            : {})}
          style={[
            styles.tabPanel,
            currentTab !== "files" && styles.tabPanelHidden,
            Platform.OS === "web" &&
              ({ pointerEvents: currentTab === "files" ? "auto" : "none" } as any),
          ]}
        >
          {cwd ? (
            <FileTree
              rootPath={cwd}
              viewingFile={viewingFile}
              onViewFile={setViewingFile}
              expandedDirs={expandedDirs}
              onToggleDir={handleToggleDir}
            />
          ) : (
            <Text style={[styles.emptyText, { color: textMuted }]}>
              No workspace selected
            </Text>
          )}
        </View>

        {isGitRepo && (
          <ScrollView
            {...(Platform.OS !== "web"
              ? { pointerEvents: currentTab !== "files" ? ("auto" as const) : ("none" as const) }
              : {})}
            style={[
              styles.tabPanel,
              currentTab === "files" && styles.tabPanelHidden,
              Platform.OS === "web" &&
                ({ pointerEvents: currentTab !== "files" ? "auto" : "none" } as any),
            ]}
            contentContainerStyle={styles.contentInner}
            showsVerticalScrollIndicator={false}
          >
            {isLoading ? (
              <ActivityIndicator style={{ marginTop: 32 }} />
            ) : currentTab === "changes" ? (
              <ChangesTab
                staged={staged}
                unstaged={unstaged}
                untracked={untracked}
                stagedOpen={stagedOpen}
                unstagedOpen={unstagedOpen}
                untrackedOpen={untrackedOpen}
                onToggleStaged={() => setStagedOpen((p) => !p)}
                onToggleUnstaged={() => setUnstagedOpen((p) => !p)}
                onToggleUntracked={() => setUntrackedOpen((p) => !p)}
                selectedFile={selectedFile}
                diffContent={fileDiffData?.diff}
                diffLoading={diffLoading}
                onFilePress={handleFilePress}
                onStage={stage}
                onUnstage={unstage}
                onDiscard={discard}
              />
            ) : logLoading ? (
              <ActivityIndicator style={{ marginTop: 32 }} />
            ) : (
              <HistoryTab entries={logEntries ?? []} />
            )}
          </ScrollView>
        )}
      </View>

      {currentTab === "changes" && staged.length > 0 && (
        <CommitBar
          stagedCount={staged.length}
          commitMsg={commitMsg}
          onChangeCommitMsg={setCommitMsg}
          onCommit={handleCommit}
          isCommitting={isCommitting}
        />
      )}

      {currentTab === "changes" &&
        staged.length === 0 &&
        (unstaged.length > 0 || untracked.length > 0) && (
          <StageAllBar onStageAll={handleStageAll} />
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabPanels: {
    flex: 1,
    position: "relative",
  },
  tabPanel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  tabPanelHidden: {
    opacity: 0,
    zIndex: 0,
  },
  contentInner: {
    paddingBottom: 12,
  },
  emptyText: {
    fontSize: 13,
    textAlign: "center",
    marginTop: 32,
  },
});
