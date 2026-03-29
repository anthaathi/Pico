import { type ReactNode, useCallback, useRef } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from "react-native-reanimated";

const DURATION = 280;
const EASING = Easing.out(Easing.cubic);

interface AnimatedEntryProps {
  children: ReactNode;
  enabled?: boolean;
}

export function AnimatedEntry({ children, enabled = true }: AnimatedEntryProps) {
  const measuredHeight = useSharedValue(0);
  const progress = useSharedValue(enabled ? 0 : 1);
  const hasStarted = useRef(!enabled);

  const containerStyle = useAnimatedStyle(() => {
    const p = progress.value;
    if (p >= 0.99) {
      return { opacity: 1 };
    }
    const h = measuredHeight.value;
    return {
      height: h > 0 ? h * p : 0,
      opacity: p,
      overflow: "hidden" as const,
    };
  });

  const handleLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      const h = e.nativeEvent.layout.height;
      if (h > 0) {
        measuredHeight.value = h;
        if (!hasStarted.current) {
          hasStarted.current = true;
          progress.value = withTiming(1, { duration: DURATION, easing: EASING });
        }
      }
    },
    [measuredHeight, progress],
  );

  if (!enabled) return <>{children}</>;

  return (
    <Animated.View style={containerStyle}>
      <View onLayout={handleLayout}>{children}</View>
    </Animated.View>
  );
}
