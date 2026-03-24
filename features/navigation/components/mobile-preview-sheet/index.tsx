import { useCallback, useEffect } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { PreviewPanel } from "@/features/preview/components/preview-panel";

const SHEET_HEIGHT = 520;
const TIMING_CONFIG = { duration: 280, easing: Easing.out(Easing.cubic) };

interface MobilePreviewSheetProps {
  visible: boolean;
  onClose: () => void;
  sessionId: string | null;
}

export function MobilePreviewSheet({ visible, onClose, sessionId }: MobilePreviewSheetProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const isDark = colorScheme === "dark";

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
            paddingBottom: insets.bottom,
          },
          sheetStyle,
        ]}
      >
        <GestureDetector gesture={panGesture}>
          <View style={styles.handleBar}>
            <View style={[styles.handle, { backgroundColor: colors.sheetHandle }]} />
          </View>
        </GestureDetector>

        <View style={styles.content}>
          <PreviewPanel sessionId={sessionId} />
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
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    maxHeight: SHEET_HEIGHT,
    height: SHEET_HEIGHT,
  },
  handleBar: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  content: {
    flex: 1,
    overflow: "hidden",
  },
});
