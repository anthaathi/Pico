import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Download, CheckCircle2, AlertCircle } from "lucide-react-native";

import { Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { usePiClient } from "@pi-ui/client";
import { downloadFile } from "@/features/files/utils/file-transfer";
import type { ToolCallInfo } from "../../types";
import { parseToolArguments, getToolStatusLabel } from "./tool-call-utils";
import { basename, sharedStyles as styles } from "./tool-call-shared";

export function DownloadToolCall({ tc }: { tc: ToolCallInfo }) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const { api } = usePiClient();
  const [downloading, setDownloading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseToolArguments(tc.arguments);
  const filePath = parsed.filePath ?? "";
  const fileName = parsed.fileName ?? basename(filePath);
  const statusLabel = getToolStatusLabel(tc);
  const isComplete = tc.status === "complete" && !tc.isError;

  const handleDownload = useCallback(async () => {
    if (downloading || !filePath) return;
    setDownloading(true);
    setError(null);
    try {
      await downloadFile(api, filePath, fileName);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }, [api, filePath, fileName, downloading]);

  const textColor = isDark ? "#CCCCCC" : "#1A1A1A";
  const mutedColor = isDark ? "#888" : "#888";
  const btnBg = isDark ? "#1e1e1c" : "#F5F5F3";
  const btnBorder = isDark ? "#333" : "#E0E0E0";
  const btnActiveBg = isDark ? "#2a2a28" : "#EAEAE8";
  const successColor = "#34C759";
  const errorColor = isDark ? "#F85149" : "#CF222E";

  return (
    <View style={localStyles.container}>
      <View style={styles.row}>
        <Text style={styles.singleLine} numberOfLines={1}>
          <Text style={[styles.verb, { color: textColor }]}>Download</Text>
          <Text style={[styles.detail, { color: mutedColor }]}> {fileName}</Text>
          {statusLabel ? (
            <Text style={[styles.status, { color: mutedColor }]}> {statusLabel}</Text>
          ) : null}
        </Text>
      </View>

      {isComplete && (
        <Pressable
          onPress={handleDownload}
          disabled={downloading}
          style={({ pressed }) => [
            localStyles.downloadBtn,
            {
              backgroundColor: pressed ? btnActiveBg : btnBg,
              borderColor: btnBorder,
            },
            downloading && { opacity: 0.6 },
          ]}
        >
          {downloading ? (
            <ActivityIndicator size={14} color={mutedColor} />
          ) : done ? (
            <CheckCircle2 size={14} color={successColor} strokeWidth={1.8} />
          ) : (
            <Download size={14} color={textColor} strokeWidth={1.8} />
          )}
          <Text style={[localStyles.downloadBtnText, { color: textColor }]}>
            {downloading ? "Downloading…" : done ? "Downloaded" : fileName}
          </Text>
        </Pressable>
      )}

      {error && (
        <View style={localStyles.errorRow}>
          <AlertCircle size={12} color={errorColor} strokeWidth={1.8} />
          <Text style={[localStyles.errorText, { color: errorColor }]}>{error}</Text>
        </View>
      )}
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: {
    gap: 4,
  },
  downloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 0.633,
  },
  downloadBtnText: {
    fontSize: 13,
    fontFamily: Fonts.sansMedium,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 2,
  },
  errorText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
});
