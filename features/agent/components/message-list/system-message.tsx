import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { ChatMessage } from "../../types";

function truncate(text: string, max = 2400): string {
  return text.length > max ? `${text.slice(0, max)}\n… truncated` : text;
}

function SystemMessageComponent({ message }: { message: ChatMessage }) {
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const isDark = colorScheme === "dark";
  const [expanded, setExpanded] = useState(false);

  const isBashExecution = message.systemKind === "bashExecution";
  const hasBody =
    !!message.text || !!message.fullOutputPath || typeof message.exitCode === "number";

  const title = isBashExecution ? "Shell" : "Session";
  const subtitle = isBashExecution
    ? message.command ?? "Command output"
    : message.text;

  const footerBits: string[] = [];
  if (isBashExecution && typeof message.exitCode === "number") {
    footerBits.push(`exit ${message.exitCode}`);
  }
  if (isBashExecution && message.cancelled) {
    footerBits.push("cancelled");
  }
  if (isBashExecution && message.truncated) {
    footerBits.push("truncated");
  }

  if (!isBashExecution) {
    return (
      <View style={styles.eventWrap}>
        <View
          style={[
            styles.eventPill,
            { backgroundColor: isDark ? "#1E1E1E" : "#F3F3F3" },
          ]}
        >
          <Text style={[styles.eventText, { color: colors.textTertiary }]}>
            {subtitle}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        disabled={!hasBody}
        onPress={() => hasBody && setExpanded((value) => !value)}
        style={styles.shellRow}
      >
        <Text style={[styles.title, { color: colors.textTertiary }]}>
          {title}
        </Text>
        <Text
          style={[styles.subtitle, { color: colors.textSecondary }]}
          numberOfLines={expanded ? undefined : 1}
        >
          {subtitle}
        </Text>
        {footerBits.length > 0 && (
          <Text style={[styles.footer, { color: colors.textTertiary }]}>
            {footerBits.join(" · ")}
          </Text>
        )}
        {expanded && isBashExecution && message.text ? (
          <View style={styles.outputWrap}>
            <Text
              style={[
                styles.output,
                { color: isDark ? "#8B8B8B" : "#77706A" },
              ]}
              selectable
            >
              {truncate(message.text)}
            </Text>
          </View>
        ) : null}
        {expanded && isBashExecution && message.fullOutputPath ? (
          <View style={styles.outputWrap}>
            <Text style={[styles.path, { color: colors.textTertiary }]}>
              Full output: {message.fullOutputPath}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

export const SystemMessage = memo(
  SystemMessageComponent,
  (prev, next) => prev.message === next.message,
);

const styles = StyleSheet.create({
  eventWrap: {
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  eventPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    maxWidth: "88%",
  },
  eventText: {
    fontSize: 11,
    fontFamily: Fonts.sans,
    textAlign: "center",
  },
  wrap: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  shellRow: {
    gap: 4,
  },
  title: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: Fonts.sans,
  },
  footer: {
    fontSize: 11,
    fontFamily: Fonts.sans,
  },
  outputWrap: {
    paddingTop: 6,
  },
  output: {
    fontSize: 11.5,
    lineHeight: 17,
    fontFamily: Fonts.mono,
  },
  path: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Fonts.mono,
  },
});
