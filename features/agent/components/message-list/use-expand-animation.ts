import { useCallback, useRef, useState } from "react";
import {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  runOnJS,
} from "react-native-reanimated";

const EXPAND_DURATION = 280;
const EXPAND_EASING = Easing.out(Easing.cubic);

interface UseExpandAnimationOptions {
  initialExpanded?: boolean;
}

export function useExpandAnimation(options?: UseExpandAnimationOptions) {
  const initialExpanded = options?.initialExpanded ?? false;
  const [expanded, setExpanded] = useState(initialExpanded);
  const [shouldRender, setShouldRender] = useState(initialExpanded);
  const measuredHeight = useSharedValue(0);
  const progress = useSharedValue(initialExpanded ? 1 : 0);
  const chevronRotation = useSharedValue(initialExpanded ? 1 : 0);
  const pendingExpand = useRef(false);

  const startExpandAnimation = useCallback(() => {
    progress.value = withTiming(1, {
      duration: EXPAND_DURATION,
      easing: EXPAND_EASING,
    });
  }, [progress]);

  const onMeasure = useCallback(
    (height: number) => {
      measuredHeight.value = height;
      if (pendingExpand.current && height > 0) {
        pendingExpand.current = false;
        startExpandAnimation();
      }
    },
    [measuredHeight, startExpandAnimation],
  );

  const expand = useCallback(() => {
    setShouldRender(true);
    setExpanded(true);
    chevronRotation.value = withTiming(1, {
      duration: 200,
      easing: EXPAND_EASING,
    });
    if (measuredHeight.value > 0) {
      startExpandAnimation();
    } else {
      pendingExpand.current = true;
    }
  }, [chevronRotation, measuredHeight, startExpandAnimation]);

  const collapse = useCallback(() => {
    setExpanded(false);
    pendingExpand.current = false;
    progress.value = withTiming(
      0,
      { duration: EXPAND_DURATION, easing: EXPAND_EASING },
      (finished) => {
        if (finished) {
          runOnJS(setShouldRender)(false);
        }
      },
    );
    chevronRotation.value = withTiming(0, {
      duration: 200,
      easing: EXPAND_EASING,
    });
  }, [progress, chevronRotation]);

  const toggle = useCallback(() => {
    if (expanded) collapse();
    else expand();
  }, [expanded, expand, collapse]);

  const containerStyle = useAnimatedStyle(() => {
    const h = measuredHeight.value;
    const p = progress.value;
    if (p >= 0.99) {
      return { opacity: 1 };
    }
    return {
      height: h > 0 ? h * p : 0,
      opacity: p,
      overflow: "hidden" as const,
    };
  });

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value * 90}deg` }],
  }));

  return {
    expanded,
    shouldRender,
    expand,
    collapse,
    toggle,
    onMeasure,
    containerStyle,
    chevronStyle,
  };
}
