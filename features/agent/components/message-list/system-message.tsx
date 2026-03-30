import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Colors, Fonts } from "@/constants/theme";
import type { ChatMessage } from "../../types";

interface SystemMessageProps {
  message: ChatMessage;
  isDark: boolean;
}

export const SystemMessage = memo(function SystemMessage({
  message,
  isDark,
}: SystemMessageProps) {
  const colors = isDark ? Colors.dark : Colors.light;

  const label =
    message.systemKind === "bashExecution"
      ? `$ ${message.command || "command"}`
      : message.text || "System event";

  return (
    <View style={styles.container}>
      <View style={[styles.pill, { backgroundColor: colors.surfaceRaised }]}>
        <Text style={[styles.text, { color: colors.textTertiary }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  pill: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    maxWidth: "80%",
  },
  text: {
    fontSize: 11,
    fontFamily: Fonts.mono,
  },
});
