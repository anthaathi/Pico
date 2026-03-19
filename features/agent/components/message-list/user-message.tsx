import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { ChatMessage } from "../../types";

function UserMessageComponent({ message }: { message: ChatMessage }) {
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const isDark = colorScheme === "dark";

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: isDark ? "#2A2A2A" : "#F0F0F0",
          },
        ]}
      >
        <Text
          style={[
            styles.text,
            { color: isDark ? "#E8E8E8" : colors.text },
          ]}
          selectable
        >
          {message.text}
        </Text>
      </View>
    </View>
  );
}

export const UserMessage = memo(
  UserMessageComponent,
  (prev, next) => prev.message === next.message,
);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  bubble: {
    maxWidth: "80%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderTopRightRadius: 4,
  },
  text: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    lineHeight: 21,
  },
});
