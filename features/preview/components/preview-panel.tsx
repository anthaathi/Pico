import { memo, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Plus } from "lucide-react-native";

import { Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { BrowserPreview } from "@/features/preview/components/browser-preview";
import { usePreviewStore, type PreviewTarget } from "@/features/preview/store";
import { GLOBAL_PREVIEW_KEY } from "@/features/preview/components/preview-event-subscriber";
import { useAuthStore } from "@/features/auth/store";
import { usePiClient } from "@pi-ui/client";

const EMPTY_TARGETS: PreviewTarget[] = [];

interface PreviewPanelProps {
  sessionId: string | null;
}

function PreviewPanelComponent({ sessionId }: PreviewPanelProps) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const client = usePiClient();
  const activeServerId = useAuthStore((state) => state.activeServerId);
  const accessToken = useAuthStore((state) =>
    activeServerId ? state.tokens[activeServerId]?.accessToken : undefined,
  );
  const targets = usePreviewStore((state) =>
    sessionId ? state.targetsBySession[sessionId] ?? EMPTY_TARGETS : EMPTY_TARGETS,
  );
  const detectedPorts = usePreviewStore((state) =>
    state.targetsBySession[GLOBAL_PREVIEW_KEY] ?? EMPTY_TARGETS,
  );
  const selectedTargetId = usePreviewStore((state) =>
    sessionId ? state.selectedTargetIdBySession[sessionId] ?? "" : "",
  );
  const selectTarget = usePreviewStore((state) => state.selectTarget);
  const upsertTarget = usePreviewStore((state) => state.upsertTarget);

  const [portInput, setPortInput] = useState("");
  const [showPortInput, setShowPortInput] = useState(false);

  const suggestions = useMemo(() => {
    return detectedPorts.filter((dp) => !targets.some((t) => t.id === dp.id));
  }, [detectedPorts, targets]);

  const addPort = useCallback(
    (port: number, hostname = "localhost") => {
      if (!sessionId) return;
      const target: PreviewTarget = {
        id: `${hostname}:${port}`,
        port,
        hostname,
        label: `${hostname}:${port}`,
      };
      upsertTarget(sessionId, target);
      selectTarget(sessionId, target.id);
    },
    [sessionId, upsertTarget, selectTarget],
  );

  const handleAddPort = useCallback(() => {
    const port = parseInt(portInput.trim(), 10);
    if (!port || port < 1 || port > 65535) return;
    addPort(port);
    setPortInput("");
    setShowPortInput(false);
  }, [portInput, addPort]);

  const handleAddSuggestion = useCallback(
    (target: PreviewTarget) => addPort(target.port, target.hostname),
    [addPort],
  );

  const selectedTarget = useMemo(
    () => targets.find((t) => t.id === selectedTargetId) ?? targets[0] ?? null,
    [selectedTargetId, targets],
  );

  if (!sessionId) {
    return (
      <View style={[styles.emptyState, { backgroundColor: isDark ? "#151515" : "#FAFAFA" }]}>
        <Text style={[styles.emptyTitle, { color: isDark ? "#F5F5F5" : "#1A1A1A" }]}>Preview</Text>
        <Text style={[styles.emptyBody, { color: isDark ? "#8B8685" : "#6B6B6B" }]}>
          Open a session to preview running apps.
        </Text>
      </View>
    );
  }

  if (targets.length === 0) {
    return (
      <View style={[styles.emptyState, { backgroundColor: isDark ? "#151515" : "#FAFAFA" }]}>
        <Text style={[styles.emptyTitle, { color: isDark ? "#F5F5F5" : "#1A1A1A" }]}>Preview</Text>
        <Text style={[styles.emptyBody, { color: isDark ? "#8B8685" : "#6B6B6B" }]}>
          Add a port to preview a running app.
        </Text>
        <View style={styles.addPortRow}>
          <TextInput
            style={[
              styles.portInput,
              {
                color: isDark ? "#F5F5F5" : "#1A1A1A",
                backgroundColor: isDark ? "#1E1E1E" : "#FFFFFF",
                borderColor: isDark ? "#3A3A3A" : "#D5D5D5",
              },
            ]}
            placeholder="Port (e.g. 3000)"
            placeholderTextColor={isDark ? "#6B6B6B" : "#999"}
            value={portInput}
            onChangeText={setPortInput}
            keyboardType="number-pad"
            onSubmitEditing={handleAddPort}
          />
          <Pressable
            onPress={handleAddPort}
            disabled={!portInput.trim()}
            style={({ pressed }) => [
              styles.addPortBtn,
              {
                backgroundColor: isDark ? "#2B2A2A" : "#EDEDED",
                opacity: !portInput.trim() ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.addPortBtnText, { color: isDark ? "#F5F5F5" : "#1A1A1A" }]}>
              Add
            </Text>
          </Pressable>
        </View>
        {suggestions.length > 0 && (
          <View style={styles.suggestionsWrap}>
            <Text style={[styles.suggestionsLabel, { color: isDark ? "#8B8685" : "#6B6B6B" }]}>
              Detected ports
            </Text>
            <View style={styles.suggestionsRow}>
              {suggestions.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => handleAddSuggestion(s)}
                  style={({ pressed }) => [
                    styles.suggestionChip,
                    {
                      backgroundColor: isDark ? "#1E1E1E" : "#F2F2F2",
                      borderColor: isDark ? "#3A3A3A" : "#E3E3E3",
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[styles.suggestionChipText, { color: isDark ? "#B9B4B1" : "#555" }]}
                  >
                    {s.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: isDark ? "#151515" : "#FAFAFA" }]}>
      <View
        style={[styles.toolbar, { borderBottomColor: isDark ? "#323131" : "rgba(0,0,0,0.08)" }]}
      >
        <Text style={[styles.title, { color: isDark ? "#F5F5F5" : "#1A1A1A" }]}>Preview</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.targetList}>
          {targets.map((target) => {
            const active = selectedTarget?.id === target.id;
            return (
              <Pressable
                key={target.id}
                onPress={() => selectTarget(sessionId, target.id)}
                style={({ pressed }) => [
                  styles.targetChip,
                  {
                    backgroundColor: active
                      ? isDark ? "#2B2A2A" : "#EDEDED"
                      : isDark ? "#1B1B1B" : "#F2F2F2",
                    borderColor: active
                      ? isDark ? "#4A4848" : "#D5D5D5"
                      : isDark ? "#2E2E2E" : "#E3E3E3",
                  },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.targetChipLabel,
                    {
                      color: active
                        ? isDark ? "#F5F5F5" : "#1A1A1A"
                        : isDark ? "#B9B4B1" : "#555555",
                    },
                  ]}
                >
                  {target.label}
                </Text>
              </Pressable>
            );
          })}
          {showPortInput ? (
            <View style={styles.inlinePortRow}>
              <TextInput
                autoFocus
                style={[
                  styles.inlinePortInput,
                  {
                    color: isDark ? "#F5F5F5" : "#1A1A1A",
                    backgroundColor: isDark ? "#1E1E1E" : "#FFFFFF",
                    borderColor: isDark ? "#3A3A3A" : "#D5D5D5",
                  },
                ]}
                placeholder="Port"
                placeholderTextColor={isDark ? "#6B6B6B" : "#999"}
                value={portInput}
                onChangeText={setPortInput}
                keyboardType="number-pad"
                onSubmitEditing={handleAddPort}
                onBlur={() => {
                  if (!portInput.trim()) setShowPortInput(false);
                }}
              />
            </View>
          ) : (
            <Pressable
              onPress={() => setShowPortInput(true)}
              style={({ pressed }) => [
                styles.addChipBtn,
                { borderColor: isDark ? "#2E2E2E" : "#E3E3E3" },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Plus size={14} color={isDark ? "#8B8685" : "#999"} strokeWidth={1.8} />
            </Pressable>
          )}
        </ScrollView>
      </View>
      <View style={styles.content}>
        {selectedTarget ? (
          <BrowserPreview
            serverUrl={client.api.serverUrl}
            accessToken={accessToken}
            sessionId={sessionId}
            target={selectedTarget}
          />
        ) : (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" />
          </View>
        )}
      </View>
    </View>
  );
}

export const PreviewPanel = memo(PreviewPanelComponent);

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 0.633,
    gap: 8,
  },
  title: {
    fontSize: 12,
    fontFamily: Fonts.sansSemiBold,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  targetList: { gap: 8, alignItems: "center" },
  targetChip: {
    minHeight: 30,
    maxWidth: 180,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  targetChipLabel: { fontSize: 12, fontFamily: Fonts.sansMedium },
  content: { flex: 1 },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontFamily: Fonts.sansSemiBold },
  emptyBody: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    fontFamily: Fonts.sans,
  },
  loadingState: { flex: 1, alignItems: "center", justifyContent: "center" },
  addPortRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  portInput: {
    width: 140,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
  addPortBtn: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  addPortBtnText: { fontSize: 13, fontFamily: Fonts.sansMedium },
  suggestionsWrap: { marginTop: 16, alignItems: "center", gap: 8 },
  suggestionsLabel: { fontSize: 11, fontFamily: Fonts.sansMedium, textTransform: "uppercase", letterSpacing: 0.4 },
  suggestionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  suggestionChip: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  suggestionChipText: { fontSize: 12, fontFamily: Fonts.sansMedium },
  inlinePortRow: { flexDirection: "row", alignItems: "center" },
  inlinePortInput: {
    width: 72,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    fontSize: 12,
    fontFamily: Fonts.mono,
  },
  addChipBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed" as const,
    alignItems: "center",
    justifyContent: "center",
  },
});
