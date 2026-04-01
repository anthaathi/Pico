import { useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";
import { X, Wifi, Check, AlertCircle } from "lucide-react-native";

import { Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  parseConnectUrl,
  buildServerAddress,
  type ConnectParams,
} from "../../utils/parse-connect-url";
import { useAuthStore } from "@/features/auth/store";
import { useServersStore } from "@/features/servers/store";
import { useWorkspaceStore } from "@/features/workspace/store";
import { useRouter } from "expo-router";
import { QrScannerScanPanel } from "./scan-panel";

type Step = "scan" | "pick-ip" | "pairing" | "done" | "error";

interface QrScannerProps {
  visible: boolean;
  onClose: () => void;
  onNeedNewWorkspace?: () => void;
}

export function QrScanner({ visible, onClose, onNeedNewWorkspace }: QrScannerProps) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const router = useRouter();

  const [scanned, setScanned] = useState(false);
  const [connectParams, setConnectParams] = useState<ConnectParams | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("scan");

  const textPrimary = isDark ? "#fefdfd" : "#1a1a1a";
  const textMuted = isDark ? "#cdc8c5" : "#888";
  const cardBg = isDark ? "#1e1e1e" : "#FFFFFF";
  const borderColor = isDark ? "#3b3a39" : "rgba(0,0,0,0.08)";
  const inputBg = isDark ? "#2a2a2a" : "#F6F6F6";

  const reset = () => {
    setScanned(false);
    setConnectParams(null);
    setError(null);
    setManualUrl("");
    setStep("scan");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const doPair = async (params: ConnectParams, ip: string) => {
    const address = buildServerAddress(ip, params.port);
    const serverId =
      params.serverId ??
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const existingServer = useServersStore
      .getState()
      .servers.find((server) => server.id === serverId);

    setStep("pairing");
    setError(null);

    const result = await useAuthStore.getState().pairWithServer(address, params.qrId, serverId);

    if (result.success) {
      setStep("done");
      setTimeout(async () => {
        await useServersStore.getState().addServer({
          id: serverId,
          name: existingServer?.name || params.hostname || ip,
          address,
        });
        reset();
        onClose();
      }, 800);
    } else {
      setStep("error");
      setError(result.error ?? "Pairing failed");
    }
  };

  const handleScanned = (data: string) => {
    const params = parseConnectUrl(data);
    if (!params) {
      setError("Invalid QR code. Expected a pi://connect URL.");
      setScanned(false);
      return;
    }

    setConnectParams(params);
    if (params.ips.length === 1) {
      doPair(params, params.ips[0]);
    } else {
      setStep("pick-ip");
    }
  };

  const handleBarCodeScanned = (data: string) => {
    if (scanned) return;
    setScanned(true);
    setError(null);
    handleScanned(data);
  };

  const handleManualSubmit = () => {
    const trimmed = manualUrl.trim();
    if (!trimmed) return;
    setScanned(true);
    handleScanned(trimmed);
  };

  const handleSelectIp = (ip: string) => {
    if (!connectParams) return;
    doPair(connectParams, ip);
  };

  // Pairing in progress
  if (step === "pairing") {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
        <View style={[styles.overlay, { backgroundColor: isDark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.3)" }]}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
            <View style={styles.statusCenter}>
              <ActivityIndicator size="large" color={textPrimary} />
              <Text style={[styles.statusTitle, { color: textPrimary }]}>
                Waiting for approval
              </Text>
              <Text style={[styles.statusDesc, { color: textMuted }]}>
                Check the server terminal and accept the pairing request.
              </Text>
            </View>
            <Pressable onPress={handleClose} style={[styles.cancelBtn, { borderColor }]}>
              <Text style={[styles.cancelBtnText, { color: textMuted }]}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  // Pairing success
  if (step === "done") {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={[styles.overlay, { backgroundColor: isDark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.3)" }]}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
            <View style={styles.statusCenter}>
              <View style={[styles.successCircle, { backgroundColor: isDark ? "#30D158" : "#34C759" }]}>
                <Check size={28} color="#fff" strokeWidth={2.5} />
              </View>
              <Text style={[styles.statusTitle, { color: textPrimary }]}>
                Connected
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // Pairing error
  if (step === "error") {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
        <View style={[styles.overlay, { backgroundColor: isDark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.3)" }]}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
            <View style={styles.statusCenter}>
              <View style={[styles.errorCircle, { backgroundColor: isDark ? "#FF453A" : "#FF3B30" }]}>
                <AlertCircle size={28} color="#fff" strokeWidth={2} />
              </View>
              <Text style={[styles.statusTitle, { color: textPrimary }]}>
                Pairing Failed
              </Text>
              <Text style={[styles.statusDesc, { color: textMuted }]}>
                {error}
              </Text>
            </View>
            <View style={styles.errorActions}>
              <Pressable onPress={reset} style={[styles.retryBtn, { backgroundColor: isDark ? "#fefdfd" : "#1a1a1a" }]}>
                <Text style={[styles.retryBtnText, { color: isDark ? "#1a1a1a" : "#fff" }]}>
                  Try Again
                </Text>
              </Pressable>
              <Pressable onPress={handleClose} style={[styles.cancelBtn, { borderColor }]}>
                <Text style={[styles.cancelBtnText, { color: textMuted }]}>
                  Cancel
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // IP selection screen
  if (step === "pick-ip" && connectParams) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
        <View style={[styles.overlay, { backgroundColor: isDark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.3)" }]}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: textPrimary }]}>
                Select Network
              </Text>
              <Pressable onPress={handleClose} style={styles.closeBtn}>
                <X size={18} color={textMuted} strokeWidth={1.8} />
              </Pressable>
            </View>
            <Text style={[styles.cardSubtitle, { color: textMuted }]}>
              {connectParams.hostname
                ? `"${connectParams.hostname}" is available on multiple addresses:`
                : "Multiple addresses found:"}
            </Text>
            <View style={styles.ipList}>
              {connectParams.ips.map((ip) => (
                <Pressable
                  key={ip}
                  onPress={() => handleSelectIp(ip)}
                  style={({ pressed }) => [
                    styles.ipRow,
                    { borderColor, backgroundColor: pressed ? (isDark ? "#2a2a2a" : "#F6F6F6") : "transparent" },
                  ]}
                >
                  <Wifi size={16} color={textMuted} strokeWidth={1.8} />
                  <View style={styles.ipInfo}>
                    <Text style={[styles.ipText, { color: textPrimary }]}>{ip}</Text>
                    <Text style={[styles.ipPort, { color: textMuted }]}>
                      Port {connectParams.port}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // Scan screen
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={[styles.overlay, { backgroundColor: isDark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.3)" }]}>
        <View style={[styles.card, styles.scannerCard, { backgroundColor: cardBg, borderColor }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: textPrimary }]}>
              Scan QR Code
            </Text>
            <Pressable onPress={handleClose} style={styles.closeBtn}>
              <X size={18} color={textMuted} strokeWidth={1.8} />
            </Pressable>
          </View>

          <QrScannerScanPanel
            visible={visible}
            scanned={scanned}
            isDark={isDark}
            textMuted={textMuted}
            onBarcodeData={handleBarCodeScanned}
          />

          {/* Manual URL entry (always shown, primary on web) */}
          <View style={styles.manualSection}>
            <Text style={[styles.manualLabel, { color: textMuted }]}>
              {Platform.OS === "web" ? "Paste connect URL" : "Or paste URL manually"}
            </Text>
            <View style={styles.manualRow}>
              <TextInput
                style={[styles.manualInput, { backgroundColor: inputBg, color: textPrimary, borderColor }]}
                value={manualUrl}
                onChangeText={(t) => { setManualUrl(t); setError(null); }}
                placeholder="pi://connect?..."
                placeholderTextColor={isDark ? "#666" : "#bbb"}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable
                onPress={handleManualSubmit}
                style={[styles.manualBtn, { backgroundColor: isDark ? "#fefdfd" : "#1a1a1a" }, !manualUrl.trim() && { opacity: 0.4 }]}
                disabled={!manualUrl.trim()}
              >
                <Text style={[styles.manualBtnText, { color: isDark ? "#1a1a1a" : "#fff" }]}>
                  Connect
                </Text>
              </Pressable>
            </View>
          </View>

          {error && (
            <Text style={[styles.errorText, { color: isDark ? "#FF453A" : "#FF3B30" }]}>
              {error}
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    gap: 16,
  },
  scannerCard: {
    maxWidth: 440,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTitle: {
    fontSize: 17,
    fontFamily: Fonts.sansSemiBold,
  },
  cardSubtitle: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    lineHeight: 20,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  manualSection: {
    gap: 8,
  },
  manualLabel: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  manualRow: {
    flexDirection: "row",
    gap: 8,
  },
  manualInput: {
    flex: 1,
    height: 40,
    borderRadius: 6,
    borderWidth: 0.633,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
  manualBtn: {
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  manualBtnText: {
    fontSize: 13,
    fontFamily: Fonts.sansSemiBold,
  },
  errorText: {
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
  statusCenter: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 12,
  },
  statusTitle: {
    fontSize: 17,
    fontFamily: Fonts.sansSemiBold,
    marginTop: 4,
  },
  statusDesc: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    textAlign: "center",
    lineHeight: 20,
  },
  successCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  errorCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  errorActions: {
    gap: 8,
  },
  retryBtn: {
    height: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  retryBtnText: {
    fontSize: 15,
    fontFamily: Fonts.sansSemiBold,
  },
  cancelBtn: {
    height: 44,
    borderRadius: 8,
    borderWidth: 0.633,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: {
    fontSize: 15,
    fontFamily: Fonts.sansSemiBold,
  },
  ipList: {
    gap: 4,
  },
  ipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 0.633,
  },
  ipInfo: {
    flex: 1,
  },
  ipText: {
    fontSize: 14,
    fontFamily: Fonts.sansMedium,
  },
  ipPort: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    marginTop: 1,
  },
});
