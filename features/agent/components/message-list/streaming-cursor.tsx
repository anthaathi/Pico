import { memo, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
} from "react-native-reanimated";

interface StreamingCursorProps {
  color?: string;
}

const DOT_COUNT = 3;
const DURATION = 400;
const DELAY_STEP = 120;
const SIZE = 4;

function Dot({ index, color }: { index: number; color: string }) {
  const opacity = useSharedValue(0.3);
  const translateY = useSharedValue(0);

  useEffect(() => {
    const delay = index * DELAY_STEP;
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: DURATION, easing: Easing.out(Easing.ease) }),
          withTiming(0.3, { duration: DURATION, easing: Easing.in(Easing.ease) }),
        ),
        -1,
      ),
    );
    translateY.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(-2, { duration: DURATION, easing: Easing.out(Easing.ease) }),
          withTiming(0, { duration: DURATION, easing: Easing.in(Easing.ease) }),
        ),
        -1,
      ),
    );
  }, [index, opacity, translateY]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          width: SIZE,
          height: SIZE,
          borderRadius: SIZE / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

export const StreamingCursor = memo(function StreamingCursor({
  color = "#888",
}: StreamingCursorProps) {
  return (
    <View style={styles.container}>
      {Array.from({ length: DOT_COUNT }, (_, i) => (
        <Dot key={i} index={i} color={color} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
});
