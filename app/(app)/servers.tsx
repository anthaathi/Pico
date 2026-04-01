import { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Eye,
  EyeOff,
  QrCode,
} from "lucide-react-native";
import { PiLogo } from "@/components/pi-logo";

import { useRouter } from "expo-router";

import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useResponsiveLayout } from "@/features/navigation/hooks/use-responsive-layout";
import { useServersStore, Server } from "@/features/servers/store";
import { useAuthStore } from "@/features/auth/store";
import { useWorkspaceStore } from "@/features/workspace/store";
import { QrScanner } from "@/features/servers/components/qr-scanner";
import { NewWorkspaceDialog } from "@/features/workspace/components/new-workspace-dialog";

const SHEET_HEIGHT = 520;
const TIMING_CONFIG = { duration: 280, easing: Easing.out(Easing.cubic) };

function ServerFormFields({
  name,
  setName,
  address,
  setAddress,
  username,
  setUsername,
  password,
  setPassword,
  showPassword,
  setShowPassword,
  isDark,
  autoFocus,
}: {
  name: string;
  setName: (v: string) => void;
  address: string;
  setAddress: (v: string) => void;
  username: string;
  setUsername: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  isDark: boolean;
  autoFocus?: boolean;
}) {
  const textMuted = isDark ? "#cdc8c5" : "#888";
  const textPrimary = isDark ? "#fefdfd" : "#1a1a1a";
  const inputBg = isDark ? "#2a2a2a" : "#F6F6F6";
  const borderColor = isDark ? "#3b3a39" : "rgba(0,0,0,0.08)";

  return (
    <View style={formStyles.fields}>
      <View style={formStyles.field}>
        <Text style={[formStyles.label, { color: textMuted }]}>Name</Text>
        <TextInput
          style={[
            formStyles.input,
            { backgroundColor: inputBg, color: textPrimary, borderColor },
          ]}
          value={name}
          onChangeText={setName}
          placeholder="My Server"
          placeholderTextColor={isDark ? "#666" : "#bbb"}
          autoFocus={autoFocus}
        />
      </View>
      <View style={formStyles.field}>
        <Text style={[formStyles.label, { color: textMuted }]}>Address</Text>
        <TextInput
          style={[
            formStyles.input,
            { backgroundColor: inputBg, color: textPrimary, borderColor },
          ]}
          value={address}
          onChangeText={setAddress}
          placeholder="http://192.168.1.100:5454"
          placeholderTextColor={isDark ? "#666" : "#bbb"}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
      </View>
      <View style={formStyles.field}>
        <Text style={[formStyles.label, { color: textMuted }]}>Username</Text>
        <TextInput
          style={[
            formStyles.input,
            { backgroundColor: inputBg, color: textPrimary, borderColor },
          ]}
          value={username}
          onChangeText={setUsername}
          placeholder="admin"
          placeholderTextColor={isDark ? "#666" : "#bbb"}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <View style={formStyles.field}>
        <Text style={[formStyles.label, { color: textMuted }]}>Password</Text>
        <View style={formStyles.passwordRow}>
          <TextInput
            style={[
              formStyles.input,
              formStyles.passwordInput,
              { backgroundColor: inputBg, color: textPrimary, borderColor },
            ]}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={isDark ? "#666" : "#bbb"}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            onPress={() => setShowPassword(!showPassword)}
            style={formStyles.eyeBtn}
          >
            {showPassword ? (
              <EyeOff size={16} color={textMuted} strokeWidth={1.8} />
            ) : (
              <Eye size={16} color={textMuted} strokeWidth={1.8} />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

type ServerFormData = Omit<Server, "id"> & { username: string; password: string };

function ServerFormDesktopModal({
  visible,
  onClose,
  onSave,
  initial,
  isDark,
  loading,
  error,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (data: ServerFormData) => void;
  initial?: Server;
  isDark: boolean;
  loading?: boolean;
  error?: string | null;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(initial?.name ?? "");
      setAddress(initial?.address ?? "");
      setUsername("");
      setPassword("");
      setShowPassword(false);
    }
  }, [visible, initial]);

  const textPrimary = isDark ? "#fefdfd" : "#1a1a1a";
  const textMuted = isDark ? "#cdc8c5" : "#888";
  const cardBg = isDark ? "#1e1e1e" : "#FFFFFF";
  const borderColor = isDark ? "#3b3a39" : "rgba(0,0,0,0.08)";
  const overlayBg = isDark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.3)";
  const canSave = name.trim() && address.trim() && !loading;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      address: address.trim(),
      username: username.trim(),
      password,
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[formStyles.overlay, { backgroundColor: overlayBg }]}
        onPress={loading ? undefined : onClose}
      >
        <Pressable
          style={[formStyles.card, { backgroundColor: cardBg, borderColor }]}
          onPress={() => {}}
        >
          <View style={formStyles.header}>
            <Text style={[formStyles.title, { color: textPrimary }]}>
              {initial ? "Edit Server" : "Add Server"}
            </Text>
            <Pressable onPress={onClose} style={formStyles.closeBtn} disabled={loading}>
              <X size={18} color={textMuted} strokeWidth={1.8} />
            </Pressable>
          </View>
          <ServerFormFields
            {...{
              name,
              setName,
              address,
              setAddress,
              username,
              setUsername,
              password,
              setPassword,
              showPassword,
              setShowPassword,
              isDark,
            }}
            autoFocus
          />
          {error && (
            <Text style={[formStyles.errorText, { color: isDark ? "#FF453A" : "#FF3B30" }]}>
              {error}
            </Text>
          )}
          <View style={formStyles.actions}>
            <Pressable
              onPress={onClose}
              style={[formStyles.btn, { borderColor }]}
              disabled={loading}
            >
              <Text style={[formStyles.btnText, { color: textMuted }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              style={[
                formStyles.btn,
                formStyles.btnPrimary,
                !canSave && { opacity: 0.4 },
              ]}
              disabled={!canSave}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={[formStyles.btnText, { color: "#fff" }]}>
                  {initial ? "Save" : "Add & Connect"}
                </Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ServerFormSheet({
  visible,
  onClose,
  onSave,
  initial,
  isDark,
  loading,
  error,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (data: ServerFormData) => void;
  initial?: Server;
  isDark: boolean;
  loading?: boolean;
  error?: string | null;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const translateY = useSharedValue(SHEET_HEIGHT);
  const overlayOpacity = useSharedValue(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const textPrimary = isDark ? "#fefdfd" : "#1a1a1a";
  const sheetBg = isDark ? "#1e1e1e" : "#FFFFFF";
  const sheetBottomPadding = Math.max(insets.bottom, 12);
  const keyboardInset = Math.max(0, keyboardHeight - insets.bottom);
  const maxVisibleSheetHeight = Math.max(
    280,
    windowHeight - keyboardInset - insets.top - 12,
  );
  const canSave = name.trim() && address.trim() && !loading;

  useEffect(() => {
    if (visible) {
      setName(initial?.name ?? "");
      setAddress(initial?.address ?? "");
      setUsername("");
      setPassword("");
      setShowPassword(false);
      translateY.value = withTiming(0, TIMING_CONFIG);
      overlayOpacity.value = withTiming(1, TIMING_CONFIG);
    } else {
      translateY.value = withTiming(SHEET_HEIGHT, TIMING_CONFIG);
      overlayOpacity.value = withTiming(0, TIMING_CONFIG);
      setKeyboardHeight(0);
    }
  }, [visible, initial, translateY, overlayOpacity]);

  useEffect(() => {
    if (Platform.OS === "web" || Platform.OS === "android") {
      setKeyboardHeight(0);
      return;
    }

    const showEvent = "keyboardWillShow";
    const hideEvent = "keyboardWillHide";

    const showSub = Keyboard.addListener(showEvent, (event) => {
      if (!visible) return;
      setKeyboardHeight(event.endCoordinates.height);
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [visible]);

  const dismiss = useCallback(() => {
    translateY.value = withTiming(SHEET_HEIGHT, TIMING_CONFIG);
    overlayOpacity.value = withTiming(0, TIMING_CONFIG, () => {
      runOnJS(onClose)();
    });
  }, [translateY, overlayOpacity, onClose]);

  const panGesture = Gesture.Pan()
    .enabled(!loading)
    .onUpdate((e) => {
      if (e.translationY > 0) {
        translateY.value = e.translationY;
      }
    })
    .onEnd((e) => {
      if (e.translationY > 100 || e.velocityY > 500) {
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
    pointerEvents:
      overlayOpacity.value > 0 ? ("auto" as const) : ("none" as const),
  }));

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      address: address.trim(),
      username: username.trim(),
      password,
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={() => {
        if (!loading) dismiss();
      }}
    >
      <View style={sheetStyles.root}>
        <Animated.View
          style={[
            sheetStyles.overlay,
            { backgroundColor: colors.overlay },
            overlayStyle,
          ]}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={loading ? undefined : dismiss}
          />
        </Animated.View>

        <View
          style={[
            sheetStyles.keyboardAvoider,
            { paddingBottom: keyboardInset },
          ]}
        >
          <GestureDetector gesture={panGesture}>
            <Animated.View
              style={[
                sheetStyles.sheet,
                {
                  backgroundColor: sheetBg,
                  paddingBottom: keyboardHeight > 0 ? 12 : sheetBottomPadding,
                  maxHeight: Math.min(SHEET_HEIGHT, maxVisibleSheetHeight),
                },
                sheetStyle,
              ]}
            >
              <View style={sheetStyles.handleBar}>
                <View
                  style={[
                    sheetStyles.handle,
                    { backgroundColor: colors.sheetHandle },
                  ]}
                />
              </View>

              <View style={sheetStyles.sheetHeader}>
                <Text style={[sheetStyles.sheetTitle, { color: textPrimary }]}>
                  {initial ? "Edit Server" : "Add Server"}
                </Text>
              </View>

              <ScrollView
                contentContainerStyle={sheetStyles.sheetContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <ServerFormFields
                  {...{
                    name,
                    setName,
                    address,
                    setAddress,
                    username,
                    setUsername,
                    password,
                    setPassword,
                    showPassword,
                    setShowPassword,
                    isDark,
                  }}
                />

                {error && (
                  <Text
                    style={[
                      formStyles.errorText,
                      { color: isDark ? "#FF453A" : "#FF3B30" },
                    ]}
                  >
                    {error}
                  </Text>
                )}

                <Pressable
                  onPress={handleSave}
                  style={[
                    sheetStyles.sheetSaveBtn,
                    { backgroundColor: isDark ? "#fefdfd" : "#1a1a1a" },
                    !canSave && { opacity: 0.4 },
                  ]}
                  disabled={!canSave}
                >
                  {loading ? (
                    <ActivityIndicator
                      size="small"
                      color={isDark ? "#1a1a1a" : "#fff"}
                    />
                  ) : (
                    <Text
                      style={[
                        sheetStyles.sheetSaveBtnText,
                        { color: isDark ? "#1a1a1a" : "#fff" },
                      ]}
                    >
                      {initial ? "Save & Connect" : "Add & Connect"}
                    </Text>
                  )}
                </Pressable>
              </ScrollView>
            </Animated.View>
          </GestureDetector>
        </View>
      </View>
    </Modal>
  );
}

function ServerFormModal(props: {
  visible: boolean;
  onClose: () => void;
  onSave: (data: ServerFormData) => void;
  initial?: Server;
  isDark: boolean;
  loading?: boolean;
  error?: string | null;
}) {
  const { isWideScreen } = useResponsiveLayout();
  if (!props.visible) return null;
  if (isWideScreen) {
    return <ServerFormDesktopModal {...props} />;
  }
  return <ServerFormSheet {...props} />;
}

export default function ServersScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const isDark = colorScheme === "dark";

  const textPrimary = isDark ? "#fefdfd" : colors.text;
  const textMuted = isDark ? "#cdc8c5" : colors.textTertiary;
  const bg = isDark ? "#121212" : colors.background;
  const cardBg = isDark ? "#1a1a1a" : "#FFFFFF";
  const borderColor = isDark ? "#2a2a2a" : "rgba(0,0,0,0.08)";

  const { servers, loaded, load, addServer, updateServer, removeServer } =
    useServersStore();
  const loginToServer = useAuthStore((s) => s.loginToServer);
  const logoutFromServer = useAuthStore((s) => s.logoutFromServer);
  const router = useRouter();

  const [formVisible, setFormVisible] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | undefined>();
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [newWsVisible, setNewWsVisible] = useState(false);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  const handleAdd = useCallback(() => {
    setEditingServer(undefined);
    setLoginError(null);
    setFormVisible(true);
  }, []);

  const handleEdit = useCallback((server: Server) => {
    setEditingServer(server);
    setLoginError(null);
    setFormVisible(true);
  }, []);

  const handleDelete = useCallback(
    (server: Server) => {
      const doDelete = () => {
        removeServer(server.id);
        logoutFromServer(server.id);
      };
      if (Platform.OS === "web") {
        if (window.confirm(`Remove "${server.name}"?`)) doDelete();
      } else {
        Alert.alert("Remove Server", `Remove "${server.name}"?`, [
          { text: "Cancel", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: doDelete },
        ]);
      }
    },
    [removeServer, logoutFromServer],
  );

  const activeServerId = useAuthStore((s) => s.activeServerId);
  const [connecting, setConnecting] = useState<string | null>(null);

  const navigateAfterConnect = useCallback(async () => {
    const ws = useWorkspaceStore.getState();
    const serverId = useAuthStore.getState().activeServerId;
    await ws.switchServer(serverId);
    await ws.fetchWorkspaces(serverId);
    const { workspaces, selectedWorkspaceId } = useWorkspaceStore.getState();
    const targetId = selectedWorkspaceId ?? workspaces[0]?.id;
    if (targetId) {
      router.replace('/');
    } else {
      setNewWsVisible(true);
    }
  }, [router]);

  const handleConnect = async (server: Server) => {
    try {
      const auth = useAuthStore.getState();
      setConnecting(server.id);

      let connected = false;

      if (auth.hasToken(server.id)) {
        connected = await auth.activateServer(server);
      }

      if (connected) {
        router.replace('/');
      } else {
        setConnecting(null);
        setEditingServer(server);
        setLoginError("Session expired. Enter credentials to reconnect.");
        setFormVisible(true);
      }
    } catch (e) {
      console.error("handleConnect error:", e);
    } finally {
      setConnecting(null);
    }
  };

  const handleSave = useCallback(
    async (data: Omit<Server, "id"> & { username: string; password: string }) => {
      setLoginLoading(true);
      setLoginError(null);

      const { username, password, ...serverData } = data;
      let server: Server;
      if (editingServer) {
        await updateServer(editingServer.id, serverData);
        server = { ...editingServer, ...serverData };
      } else {
        await addServer(serverData);
        const servers = useServersStore.getState().servers;
        server = servers[servers.length - 1];
      }

      const result = await loginToServer(server, { username, password });
      setLoginLoading(false);

      if (result.success) {
        setFormVisible(false);
        await navigateAfterConnect();
      } else {
        setLoginError(result.error ?? "Failed to connect");
      }
    },
    [editingServer, addServer, updateServer, loginToServer, navigateAfterConnect],
  );

  const handleNewWsClose = useCallback(() => {
    setNewWsVisible(false);
    router.replace('/');
  }, [router]);

  const formModal = (
    <>
      <ServerFormModal
        visible={formVisible}
        onClose={() => { if (!loginLoading) setFormVisible(false); }}
        onSave={handleSave}
        initial={editingServer}
        isDark={isDark}
        loading={loginLoading}
        error={loginError}
      />
      <QrScanner
        visible={qrVisible}
        onClose={() => setQrVisible(false)}
        onNeedNewWorkspace={() => setNewWsVisible(true)}
      />
      <NewWorkspaceDialog
        visible={newWsVisible}
        onClose={handleNewWsClose}
      />
    </>
  );

  if (servers.length === 0) {
    return (
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: bg }]}
        edges={["top", "left", "right"]}
      >
        <View style={[styles.emptyContainer, { backgroundColor: bg }]}>
          <View style={styles.emptyContent}>
            <View
              style={[
                styles.emptyIconWrap,
                {
                  backgroundColor: isDark ? "#fefdfd" : "#1a1a1a",
                },
              ]}
            >
              <PiLogo size={36} color={isDark ? "#1a1a1a" : "#fff"} />
            </View>
            <Text style={[styles.emptyTitle, { color: textPrimary }]}>
              Welcome to Pi
            </Text>
            <Text style={[styles.emptyDesc, { color: textMuted }]}>
              Connect to a server to get started with your{"\n"}
              workspaces and infrastructure.
            </Text>
            <View style={styles.emptyBtnRow}>
              <Pressable
                onPress={() => setQrVisible(true)}
                style={({ pressed }) => [
                  styles.emptyBtn,
                  {
                    borderWidth: 0.633,
                    borderColor,
                  },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <QrCode size={16} color={textPrimary} strokeWidth={2} />
                <Text style={[styles.emptyBtnText, { color: textPrimary }]}>
                  Scan QR
                </Text>
              </Pressable>
              <Pressable
                onPress={handleAdd}
                style={({ pressed }) => [
                  styles.emptyBtn,
                  { backgroundColor: isDark ? "#fefdfd" : "#1a1a1a" },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Plus
                  size={16}
                  color={isDark ? "#1a1a1a" : "#fff"}
                  strokeWidth={2}
                />
                <Text
                  style={[
                    styles.emptyBtnText,
                    { color: isDark ? "#1a1a1a" : "#fff" },
                  ]}
                >
                  Add Server
                </Text>
              </Pressable>
            </View>
          </View>
          {formModal}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: bg }]}
      edges={["top", "left", "right"]}
    >
      <View style={[styles.outerContainer, { backgroundColor: bg }]}>
        <ScrollView
          style={styles.container}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + 24 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: textPrimary }]}>
                  Servers
                </Text>
                <Text style={[styles.description, { color: textMuted }]}>
                  Manage your server connections.
                </Text>
              </View>
              <View style={styles.headerBtns}>
                <Pressable
                  onPress={() => setQrVisible(true)}
                  style={({ pressed }) => [
                    styles.addBtn,
                    { borderWidth: 0.633, borderColor },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <QrCode size={16} color={textPrimary} strokeWidth={2} />
                </Pressable>
                <Pressable
                  onPress={handleAdd}
                  style={({ pressed }) => [
                    styles.addBtn,
                    { backgroundColor: isDark ? "#fefdfd" : "#1a1a1a" },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Plus
                    size={16}
                    color={isDark ? "#1a1a1a" : "#fff"}
                    strokeWidth={2}
                  />
                  <Text
                    style={[
                      styles.addBtnText,
                      { color: isDark ? "#1a1a1a" : "#fff" },
                    ]}
                  >
                    Add
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
          <View
            style={[
              styles.listCard,
              { backgroundColor: cardBg, borderColor },
            ]}
          >
            {servers.map((server, idx) => {
              const isActive = activeServerId === server.id;
              const isConnecting = connecting === server.id;

              return (
                <Pressable
                  key={server.id}
                  onPress={() => handleConnect(server)}
                  style={({ pressed }) => [
                    styles.serverRow,
                    idx < servers.length - 1 && {
                      borderBottomWidth: 0.633,
                      borderBottomColor: borderColor,
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View
                    style={[
                      styles.serverIcon,
                      {
                        backgroundColor: isDark ? "#fefdfd" : "#1a1a1a",
                      },
                    ]}
                  >
                    {isConnecting ? (
                      <ActivityIndicator
                        size="small"
                        color={isDark ? "#1a1a1a" : "#fff"}
                      />
                    ) : (
                      <PiLogo
                        size={18}
                        color={isDark ? "#1a1a1a" : "#fff"}
                      />
                    )}
                  </View>
                  <View style={styles.serverInfo}>
                    <View style={styles.serverNameRow}>
                      <Text
                        style={[styles.serverName, { color: textPrimary }]}
                      >
                        {server.name}
                      </Text>
                      {isActive && (
                        <View style={styles.connectedBadge}>
                          <View style={styles.connectedDot} />
                          <Text style={styles.connectedText}>Connected</Text>
                        </View>
                      )}
                    </View>
                    <Text
                      style={[styles.serverAddress, { color: textMuted }]}
                      numberOfLines={1}
                    >
                      {server.address}
                    </Text>
                  </View>
                  <View style={styles.serverActions}>
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        handleEdit(server);
                      }}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        pressed && { opacity: 0.5 },
                      ]}
                    >
                      <Pencil size={15} color={textMuted} strokeWidth={1.8} />
                    </Pressable>
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        handleDelete(server);
                      }}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        pressed && { opacity: 0.5 },
                      ]}
                    >
                      <Trash2
                        size={15}
                        color={colors.destructive}
                        strokeWidth={1.8}
                      />
                    </Pressable>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {formModal}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  outerContainer: {
    flex: 1,
    alignItems: "center",
  },
  container: {
    flex: 1,
    width: "100%",
    maxWidth: 600,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 20,
  },
  header: {
    gap: 4,
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerBtns: {
    flexDirection: "row",
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontFamily: Fonts.sansBold,
  },
  description: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    marginTop: 2,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  addBtnText: {
    fontSize: 13,
    fontFamily: Fonts.sansSemiBold,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  emptyContent: {
    alignItems: "center",
    maxWidth: 360,
    gap: 12,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: Fonts.sansBold,
    textAlign: "center",
  },
  emptyDesc: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    textAlign: "center",
    lineHeight: 20,
  },
  emptyBtnRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  emptyBtnText: {
    fontSize: 14,
    fontFamily: Fonts.sansSemiBold,
  },
  listCard: {
    borderRadius: 12,
    borderWidth: 0.633,
    overflow: "hidden",
  },
  serverRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  serverIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  serverInfo: {
    flex: 1,
  },
  serverNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  serverName: {
    fontSize: 14,
    fontFamily: Fonts.sansMedium,
  },
  serverAddress: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    marginTop: 2,
  },
  connectedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: "rgba(52, 199, 89, 0.12)",
  },
  connectedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#34C759",
  },
  connectedText: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
    color: "#34C759",
  },
  serverActions: {
    flexDirection: "row",
    gap: 4,
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
});

const sheetStyles = StyleSheet.create({
  root: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  keyboardAvoider: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    width: "100%",
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    maxHeight: SHEET_HEIGHT,
  },
  handleBar: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 6,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  sheetHeader: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  sheetTitle: {
    fontSize: 15,
    fontFamily: Fonts.sansSemiBold,
  },
  sheetContent: {
    paddingHorizontal: 20,
    gap: 20,
    paddingBottom: 8,
  },
  sheetSaveBtn: {
    alignItems: "center",
    justifyContent: "center",
    height: 44,
    borderRadius: 8,
  },
  sheetSaveBtnText: {
    fontSize: 15,
    fontFamily: Fonts.sansSemiBold,
  },
});

const formStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 12,
    borderWidth: 0.633,
    padding: 24,
    gap: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 17,
    fontFamily: Fonts.sansSemiBold,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  fields: {
    gap: 14,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    height: 40,
    borderRadius: 6,
    borderWidth: 0.633,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  passwordInput: {
    flex: 1,
  },
  eyeBtn: {
    position: "absolute",
    right: 10,
    height: 40,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  btn: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 6,
    borderWidth: 0.633,
  },
  btnPrimary: {
    backgroundColor: "#1a1a1a",
    borderColor: "#1a1a1a",
  },
  btnText: {
    fontSize: 13,
    fontFamily: Fonts.sansSemiBold,
  },
  errorText: {
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
});
