import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { Minus } from "lucide-react-native";

import { useAgentSession } from "@pi-ui/client";

const DOT_COUNT = 3;
const DOT_SIZE = 4;

interface SessionActivityIndicatorProps {
  sessionId: string;
  color: string;
}

export function SessionActivityIndicator({
  sessionId,
  color,
}: SessionActivityIndicatorProps) {
  const { isStreaming: isWorking } = useAgentSession(sessionId);
  const dotAnims = useRef(
    Array.from({ length: DOT_COUNT }, () => new Animated.Value(0.35)),
  ).current;

  useEffect(() => {
    if (!isWorking) {
      dotAnims.forEach((anim) => {
        anim.stopAnimation();
        anim.setValue(0.35);
      });
      return;
    }

    const loops = dotAnims.map((anim, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 140),
          Animated.timing(anim, {
            toValue: 1,
            duration: 280,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.35,
            duration: 280,
            useNativeDriver: true,
          }),
          Animated.delay((DOT_COUNT - index - 1) * 140),
        ]),
      ),
    );

    loops.forEach((loop) => loop.start());

    return () => {
      loops.forEach((loop) => loop.stop());
      dotAnims.forEach((anim) => anim.stopAnimation());
    };
  }, [dotAnims, isWorking]);

  if (!isWorking) {
    return <Minus size={14} color={color} strokeWidth={2} />;
  }

  return (
    <View style={styles.row}>
      {dotAnims.map((anim, index) => (
        <Animated.View
          key={index}
          style={[
            styles.dot,
            {
              backgroundColor: color,
              opacity: anim,
              transform: [
                {
                  scale: anim.interpolate({
                    inputRange: [0.35, 1],
                    outputRange: [0.75, 1],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: 14,
    height: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
});
