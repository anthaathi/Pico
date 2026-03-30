import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

interface AnimatedCollapseProps {
  expanded: boolean;
  maxHeight?: number;
  children: ReactNode;
}

export function AnimatedCollapse({
  expanded,
  maxHeight,
  children,
}: AnimatedCollapseProps) {
  const [mounted, setMounted] = useState(expanded);
  const [contentHeight, setContentHeight] = useState(0);
  const [initialRender, setInitialRender] = useState(expanded);
  const height = useSharedValue(0);
  const opacity = useSharedValue(expanded ? 1 : 0);

  const targetHeight = useMemo(() => {
    if (!contentHeight) return 0;
    return maxHeight ? Math.min(contentHeight, maxHeight) : contentHeight;
  }, [contentHeight, maxHeight]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    setContentHeight((prev) => (Math.abs(prev - nextHeight) < 1 ? prev : nextHeight));
  }, []);

  useEffect(() => {
    if (expanded) setMounted(true);
  }, [expanded]);

  useEffect(() => {
    if (initialRender && targetHeight > 0) {
      height.value = targetHeight;
      opacity.value = 1;
      setInitialRender(false);
      return;
    }
    if (initialRender) return;
    if (!mounted) return;

    if (expanded) {
      height.value = withTiming(targetHeight, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      });
      opacity.value = withTiming(1, {
        duration: 180,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }

    height.value = withTiming(0, {
      duration: 220,
      easing: Easing.inOut(Easing.cubic),
    }, (finished) => {
      if (finished) runOnJS(setMounted)(false);
    });
    opacity.value = withTiming(0, {
      duration: 140,
      easing: Easing.in(Easing.cubic),
    });
  }, [expanded, mounted, targetHeight, height, opacity]);

  const style = useAnimatedStyle(() => ({
    height: height.value,
    opacity: opacity.value,
  }));

  if (!mounted) return null;

  return (
    <Animated.View style={[styles.container, initialRender ? undefined : style]}>
      <View onLayout={handleLayout} style={styles.content}>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
  },
  content: {
    width: "100%",
  },
});
