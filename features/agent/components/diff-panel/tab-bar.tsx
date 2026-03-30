import { View } from "react-native";
import type { DiffTab } from "./context";

interface DiffTabBarProps {
  tabs: DiffTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  isDark: boolean;
}

export function DiffTabBar(_props: DiffTabBarProps) {
  return <View />;
}
