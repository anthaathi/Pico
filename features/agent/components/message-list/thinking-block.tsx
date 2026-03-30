import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Colors, Fonts } from "@/constants/theme";
import { AnimatedCollapse } from "./animated-collapse";

interface ThinkingBlockProps {
  text: string;
  isStreaming?: boolean;
  isDark: boolean;
}

const THINKING_WINDOW_HEIGHT = 72;

export const ThinkingBlock = memo(function ThinkingBlock({
  text,
  isStreaming,
  isDark,
}: ThinkingBlockProps) {
  const colors = isDark ? Colors.dark : Colors.light;
  const [expanded, setExpanded] = useState(false);
  const [dotCount, setDotCount] = useState(3);
  const scrollRef = useRef<ScrollView>(null);

  const toggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!isStreaming) {
      setDotCount(3);
      return;
    }
    const id = setInterval(() => {
      setDotCount((prev) => (prev % 3) + 1);
    }, 350);
    return () => clearInterval(id);
  }, [isStreaming]);

  useEffect(() => {
    if (!expanded) return;
    const id = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 0);
    return () => clearTimeout(id);
  }, [expanded, text]);

  if (!text && !isStreaming) return null;

  const thinkingLabel = `Thinking${".".repeat(dotCount)}`;

  return (
    <View style={styles.container}>
      <Pressable onPress={toggle} style={styles.header}>
        <Text style={[styles.label, { color: colors.textSecondary }]}> 
          {isStreaming ? thinkingLabel : "Thinking"}
        </Text>
      </Pressable>
      <AnimatedCollapse expanded={expanded} maxHeight={THINKING_WINDOW_HEIGHT + 16}>
        <View style={styles.body}>
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            <Text style={[styles.text, { color: colors.textSecondary }]} selectable>
              {text}
            </Text>
          </ScrollView>
        </View>
      </AnimatedCollapse>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: 6,
  },
  header: {
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  label: {
    fontSize: 13,
    fontFamily: Fonts.sansSemiBold,
    fontWeight: "600",
  },
  body: {
    paddingBottom: 8,
  },
  scroll: {
    maxHeight: THINKING_WINDOW_HEIGHT,
  },
  text: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Fonts.sans,
  },
});
