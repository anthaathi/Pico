import { ReactNode, useCallback, useEffect } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

const SHEET_HEIGHT = 360;
const TIMING_CONFIG = { duration: 280, easing: Easing.out(Easing.cubic) };

export interface MobileHeaderActionItem {
  key: string;
  label: string;
  icon: ReactNode;
  onPress: () => void;
}

interface MobileHeaderActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  items: MobileHeaderActionItem[];
}

export function MobileHeaderActionsSheet({
  visible,
  onClose,
  items,
}: MobileHeaderActionsSheetProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const isDark = colorScheme === "dark";
  const textPrimary = isDark ? "#fefdfd" : colors.text;
  const textSecondary = isDark ? "#a9a29f" : "#6f6a66";
  const rowBorder = isDark ? "#2f2d2c" : "rgba(0,0,0,0.07)";

  const translateY = useSharedValue(SHEET_HEIGHT);
  const overlayOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = withTiming(0, TIMING_CONFIG);
      overlayOpacity.value = withTiming(1, TIMING_CONFIG);
    } else {
      translateY.value = withTiming(SHEET_HEIGHT, TIMING_CONFIG);
      overlayOpacity.value = withTiming(0, TIMING_CONFIG);
    }
  }, [overlayOpacity, translateY, visible]);

  const dismiss = useCallback(() => {
    translateY.value = withTiming(SHEET_HEIGHT, TIMING_CONFIG);
    overlayOpacity.value = withTiming(0, TIMING_CONFIG, () => {
      runOnJS(onClose)();
    });
  }, [onClose, overlayOpacity, translateY]);

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      if (event.translationY > 0) {
        translateY.value = event.translationY;
      }
    })
    .onEnd((event) => {
      if (event.translationY > 100 || event.velocityY > 500) {
        runOnJS(dismiss)();
      } else {
        translateY.value = withTiming(0, TIMING_CONFIG);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
    pointerEvents: overlayOpacity.value > 0 ? ("auto" as const) : ("none" as const),
  }));

  return (
    <View
      {...(Platform.OS !== "web"
        ? { pointerEvents: visible ? ("auto" as const) : ("none" as const) }
        : {})}
      style={[
        styles.root,
        Platform.OS === "web" && ({ pointerEvents: visible ? "auto" : "none" } as any),
      ]}
    >
      <Animated.View style={[styles.overlay, { backgroundColor: colors.overlay }, overlayStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
      </Animated.View>

      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: isDark ? "#1e1e1e" : "#FFFFFF",
            paddingBottom: insets.bottom + 12,
          },
          sheetStyle,
        ]}
      >
        <GestureDetector gesture={panGesture}>
          <View style={styles.handleBar}>
            <View style={[styles.handle, { backgroundColor: colors.sheetHandle }]} />
          </View>
        </GestureDetector>

        <View style={styles.header}>
          <Text style={[styles.title, { color: textPrimary }]}>More</Text>
          <Text style={[styles.subtitle, { color: textSecondary }]}>Quick actions for this screen</Text>
        </View>

        <View style={styles.list}>
          {items.map((item, index) => (
            <Pressable
              key={item.key}
              onPress={item.onPress}
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: rowBorder },
                index === items.length - 1 && styles.lastRow,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              <View style={styles.rowIcon}>{item.icon}</View>
              <Text style={[styles.rowLabel, { color: textPrimary }]} numberOfLines={1}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: SHEET_HEIGHT,
  },
  handleBar: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: {
    fontSize: 17,
    fontFamily: Fonts.sansSemiBold,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
  list: {
    paddingHorizontal: 12,
  },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  rowIcon: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: Fonts.sansMedium,
  },
});
