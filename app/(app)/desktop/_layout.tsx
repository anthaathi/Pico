import { Stack } from 'expo-router';

export default function DesktopLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'none' }} />;
}
