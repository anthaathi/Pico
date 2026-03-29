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
      if (h !== lastHeight.current) {
        lastHeight.current = h;
        onMeasure(h);
      }
    },
    [onMeasure],
  );

  if (!shouldRender) return null;

  return (
    <Animated.View style={containerStyle}>
      <View onLayout={handleLayout}>
        {children}
      </View>
    </Animated.View>
  );
}
