import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle as SvgCircle } from "react-native-svg";

import { Fonts } from "@/constants/theme";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function ContextUsageRing({
  used,
  total,
  isDark,
}: {
  used: number;
  total: number;
  isDark: boolean;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const ratio = Math.min(used / total, 1);
  const size = 20;
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * ratio;
  const trackColor = isDark ? "#2A2A2A" : "#E5E5E5";
  const fillColor = isDark ? "#555" : "#AAA";
  const free = Math.max(total - used, 0);
  const pct = Math.round(ratio * 100);

  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => setShowTooltip((v) => !v)}>
        <Svg width={size} height={size}>
          <SvgCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={trackColor}
            strokeWidth={stroke}
            fill="none"
          />
          {ratio > 0 && (
            <SvgCircle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={fillColor}
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={`${filled} ${circumference - filled}`}
              strokeDashoffset={circumference * 0.25}
              strokeLinecap="round"
            />
          )}
        </Svg>
      </Pressable>
      {showTooltip && (
        <Pressable
          style={[
            styles.tooltip,
            { backgroundColor: isDark ? "#2A2A2A" : "#FFFFFF", borderColor: isDark ? "#3A3A3A" : "#E0E0E0" },
          ]}
          onPress={() => setShowTooltip(false)}
        >
          <Text style={[styles.tooltipTitle, { color: isDark ? "#CCC" : "#333" }]}>
            Context · {pct}%
          </Text>
          <Text style={[styles.tooltipRow, { color: isDark ? "#999" : "#666" }]}>
            Used {formatTokens(used)} of {formatTokens(total)}
          </Text>
          <Text style={[styles.tooltipRow, { color: isDark ? "#999" : "#666" }]}>
            Free {formatTokens(free)}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    justifyContent: "center",
    alignSelf: "center",
    marginRight: 6,
    height: 36,
    alignItems: "center",
  },
  tooltip: {
    position: "absolute",
    bottom: 40,
    right: -8,
    borderRadius: 8,
    borderWidth: 0.633,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 150,
    gap: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  tooltipTitle: {
    fontSize: 12,
    fontFamily: Fonts.sansSemiBold,
    fontWeight: "600",
    marginBottom: 2,
  },
  tooltipRow: {
    fontSize: 11,
    fontFamily: Fonts.sans,
  },
});
