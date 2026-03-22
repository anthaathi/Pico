import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

import {
  TOOLBAR_ANDROID_MARGIN_TOP,
  TOOLBAR_BORDER_WIDTH,
  TOOLBAR_CONTROL_HEIGHT,
  TOOLBAR_CORNER_RADIUS,
  TOOLBAR_HORIZONTAL_MARGIN,
  TOOLBAR_VERTICAL_PADDING,
  TOOLBAR_WRAP_OFFSET,
} from "./toolbar";

export function ToolbarSkeleton({ isDark }: { isDark: boolean }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  const fill = isDark ? "#2A2A28" : "#E2E2DF";
  const bg = isDark ? "#1a1a1a" : "#F6F6F6";
  const border = isDark ? "#3b3a39" : "rgba(0,0,0,0.12)";

  return (
    <View style={styles.wrap}>
      <View style={[styles.toolbar, { backgroundColor: bg, borderColor: border }]}>
        <Animated.View style={[styles.track, { opacity }]}>
          <View style={[styles.pill, styles.pillWide, { backgroundColor: fill }]} />
          <View style={[styles.pill, styles.pillNarrow, { backgroundColor: fill }]} />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: -TOOLBAR_WRAP_OFFSET,
    paddingTop: TOOLBAR_WRAP_OFFSET,
    marginHorizontal: TOOLBAR_HORIZONTAL_MARGIN,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingVertical: TOOLBAR_VERTICAL_PADDING,
    borderWidth: TOOLBAR_BORDER_WIDTH,
    borderTopWidth: 0,
    borderBottomLeftRadius: TOOLBAR_CORNER_RADIUS,
    borderBottomRightRadius: TOOLBAR_CORNER_RADIUS,
    marginTop: TOOLBAR_ANDROID_MARGIN_TOP,
  },
  track: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  pill: {
    height: TOOLBAR_CONTROL_HEIGHT,
    borderRadius: 6,
  },
  pillWide: {
    width: 148,
  },
  pillNarrow: {
    width: 92,
  },
});
