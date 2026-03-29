import { type ReactNode, useCallback, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

interface ExpandableContentProps {
  shouldRender: boolean;
  containerStyle: any;
  onMeasure: (height: number) => void;
  children: ReactNode;
}

export function ExpandableContent({
  shouldRender,
  containerStyle,
  onMeasure,
  children,
}: ExpandableContentProps) {
  const lastHeight = useRef(0);

  const handleLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      const h = e.nativeEvent.layout.height;
      if (h > 0 && h !== lastHeight.current) {
        lastHeight.current = h;
        onMeasure(h);
      }
    },
    [onMeasure],
  );

  if (!shouldRender) return null;

  return (
    <View>
      <View style={measureStyles.hidden} pointerEvents="none">
        <View onLayout={handleLayout}>{children}</View>
      </View>
      <Animated.View style={containerStyle}>{children}</Animated.View>
    </View>
  );
}

const measureStyles = StyleSheet.create({
  hidden: {
    position: "absolute",
    opacity: 0,
    zIndex: -1,
    alignSelf: "stretch",
    width: "100%",
  },
});
