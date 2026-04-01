import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAuthStore } from "@/features/auth/store";
import { useServersStore } from "@/features/servers/store";
import { useWorkspaceStore } from "@/features/workspace/store";
import {
  buildServerAddress,
  parseConnectUrl,
  type ConnectParams,
} from "@/features/servers/utils/parse-connect-url";

type ConnectStatus = "loading" | "pairing" | "done" | "error";

function resolveBaseUrl(params: ConnectParams) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const { hostname, origin, port, protocol } = window.location;
    if (port === params.port) {
      return origin;
    }

    const host =
      hostname.includes(":") && !hostname.startsWith("[")
        ? `[${hostname}]`
        : hostname;

    return `${protocol}//${host}:${params.port}`;
  }

  const preferredHost = params.ips.find((entry) => entry === "localhost") ?? params.ips[0];
  return buildServerAddress(preferredHost, params.port);
}

export default function DirectConnectScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const isDark = colorScheme === "dark";

  const authLoaded = useAuthStore((state) => state.loaded);
  const serversLoaded = useServersStore((state) => state.loaded);
  const pairWithServer = useAuthStore((state) => state.pairWithServer);
  const addServer = useServersStore((state) => state.addServer);
  const fetchWorkspaces = useWorkspaceStore((state) => state.fetchWorkspaces);

  const [status, setStatus] = useState<ConnectStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const attemptedRef = useRef(false);
  const connectParamsRef = useRef<ConnectParams | null>(
    Platform.OS === "web" && typeof window !== "undefined"
      ? parseConnectUrl(window.location.href)
      : null,
  );

  const connectParams = connectParamsRef.current;

  useEffect(() => {
    if (!authLoaded || !serversLoaded) return;
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    if (!connectParams) {
      setStatus("error");
      setError("Invalid direct login URL.");
      return;
    }

    let cancelled = false;

    const run = async () => {
      const serverId =
        connectParams.serverId ??
        Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const baseUrl = resolveBaseUrl(connectParams);
      const currentServers = useServersStore.getState().servers;
      const existingServer = currentServers.find((server) => server.id === serverId);

      setStatus("pairing");
      setError(null);

      const result = await pairWithServer(baseUrl, connectParams.qrId, serverId);
      if (cancelled) return;

      if (!result.success) {
        setStatus("error");
        setError(result.error ?? "Direct login failed");
        return;
      }

      await addServer({
        id: serverId,
        name: existingServer?.name || connectParams.hostname || "Pico Server",
        address: baseUrl,
      });

      await fetchWorkspaces();
      if (cancelled) return;

      setStatus("done");
      const { workspaces, selectedWorkspaceId } = useWorkspaceStore.getState();
      const targetId = selectedWorkspaceId ?? workspaces[0]?.id;
      setTimeout(() => {
        if (targetId) {
          router.replace(`/workspace/${targetId}`);
          return;
        }
        router.replace("/settings");
      }, 400);
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [
    addServer,
    authLoaded,
    connectParams,
    fetchWorkspaces,
    pairWithServer,
    router,
    serversLoaded,
  ]);

  const titleByStatus: Record<ConnectStatus, string> = {
    loading: "Preparing direct login",
    pairing: "Waiting for CLI approval",
    done: "Connected",
    error: "Direct login failed",
  };

  const descriptionByStatus: Record<ConnectStatus, string> = {
    loading: "Loading the connection details.",
    pairing: "In the pi-server terminal, answer the pairing prompt with y or n.",
    done: "Redirecting to your workspace.",
    error: error ?? "Unable to complete the direct login flow.",
  };

  return (
    <View style={[styles.screen, { backgroundColor: isDark ? "#121212" : colors.background }]}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: isDark ? "#1a1a1a" : "#FFFFFF",
            borderColor: isDark ? "#2a2a2a" : "rgba(0,0,0,0.08)",
          },
        ]}
      >
        {status === "error" ? (
          <View
            style={[
              styles.badge,
              { backgroundColor: isDark ? "rgba(255,69,58,0.16)" : "rgba(255,59,48,0.12)" },
            ]}
          />
        ) : (
          <ActivityIndicator
            size="large"
            color={status === "done" ? colors.success : colors.text}
          />
        )}
        <Text style={[styles.title, { color: isDark ? "#fefdfd" : colors.text }]}>
          {titleByStatus[status]}
        </Text>
        <Text style={[styles.description, { color: isDark ? "#cdc8c5" : colors.textSecondary }]}>
          {descriptionByStatus[status]}
        </Text>
        {status === "error" && (
          <Pressable
            onPress={() => router.replace("/servers")}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: isDark ? "#fefdfd" : "#1a1a1a" },
              pressed && { opacity: 0.75 },
            ]}
          >
            <Text
              style={[
                styles.buttonText,
                { color: isDark ? "#1a1a1a" : "#FFFFFF" },
              ]}
            >
              Go to Servers
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingVertical: 32,
    alignItems: "center",
  },
  badge: {
    width: 18,
    height: 18,
    borderRadius: 999,
  },
  title: {
    marginTop: 20,
    fontSize: 26,
    lineHeight: 32,
    fontFamily: Fonts.sansSemiBold,
    textAlign: "center",
  },
  description: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: Fonts.sans,
    textAlign: "center",
  },
  button: {
    marginTop: 24,
    minWidth: 180,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: {
    fontSize: 15,
    lineHeight: 18,
    fontFamily: Fonts.sansSemiBold,
  },
});
