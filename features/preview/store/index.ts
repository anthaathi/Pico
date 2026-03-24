import { create } from "zustand";

export interface PreviewTarget {
  id: string;
  port: number;
  hostname: string;
  label: string;
  path?: string;
  url?: string;
}

export interface PreviewEventPayload {
  sessionId: string;
  mode: "set" | "upsert" | "remove" | "clear";
  targets?: PreviewTarget[];
  target?: PreviewTarget;
  targetId?: string;
  selectedTargetId?: string | null;
}

interface PreviewState {
  targetsBySession: Record<string, PreviewTarget[]>;
  selectedTargetIdBySession: Record<string, string | null>;
  paneOpenBySession: Record<string, boolean>;

  setTargets: (sessionId: string, targets: PreviewTarget[], selectedTargetId?: string | null) => void;
  upsertTarget: (sessionId: string, target: PreviewTarget, selectedTargetId?: string | null) => void;
  removeTarget: (sessionId: string, targetId: string) => void;
  clearSession: (sessionId: string) => void;
  selectTarget: (sessionId: string, targetId: string | null) => void;
  setPaneOpen: (sessionId: string, open: boolean) => void;
  togglePane: (sessionId: string) => void;
}

function normalizeLabel(target: Partial<PreviewTarget> & { port: number; hostname: string }) {
  const raw = typeof target.label === "string" && target.label.trim() ? target.label.trim() : "";
  if (raw) return raw;
  const host = target.hostname.trim() || "localhost";
  return `${host}:${target.port}`;
}

function normalizeTarget(input: unknown): PreviewTarget | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const rawPort = value.port ?? value.previewPort ?? value.proxyPort;
  const port = typeof rawPort === "number"
    ? rawPort
    : typeof rawPort === "string"
      ? Number(rawPort)
      : NaN;
  if (!Number.isFinite(port) || port <= 0) return null;

  const hostnameValue = value.hostname ?? value.host ?? value.proxyHostname ?? value.name ?? "localhost";
  const hostname = typeof hostnameValue === "string" && hostnameValue.trim()
    ? hostnameValue.trim()
    : "localhost";

  const rawPath = value.path;
  const path = typeof rawPath === "string" && rawPath.trim() ? rawPath.trim() : undefined;
  const rawUrl = value.url;
  const url = typeof rawUrl === "string" && rawUrl.trim() ? rawUrl.trim() : undefined;
  const rawLabel = value.label ?? value.title;
  const label = typeof rawLabel === "string" ? rawLabel : "";
  const rawId = value.id ?? value.targetId;
  const id = typeof rawId === "string" && rawId.trim() ? rawId.trim() : `${hostname}:${port}`;

  return {
    id,
    port,
    hostname,
    label: normalizeLabel({ hostname, port, label }),
    path,
    url,
  };
}

function dedupeTargets(targets: PreviewTarget[]) {
  const byId = new Map<string, PreviewTarget>();
  for (const target of targets) {
    byId.set(target.id, target);
  }
  return Array.from(byId.values()).sort((a, b) => a.port - b.port);
}

function nextSelectedTargetId(
  targets: PreviewTarget[],
  currentSelected: string | null | undefined,
  requestedSelected?: string | null,
) {
  if (requestedSelected && targets.some((target) => target.id === requestedSelected)) {
    return requestedSelected;
  }
  if (currentSelected && targets.some((target) => target.id === currentSelected)) {
    return currentSelected;
  }
  return targets[0]?.id ?? null;
}

export const usePreviewStore = create<PreviewState>((set, get) => ({
  targetsBySession: {},
  selectedTargetIdBySession: {},
  paneOpenBySession: {},

  setTargets: (sessionId, targets, selectedTargetId) =>
    set((state) => {
      const normalizedTargets = dedupeTargets(targets);
      const nextSelected = nextSelectedTargetId(
        normalizedTargets,
        state.selectedTargetIdBySession[sessionId],
        selectedTargetId,
      );
      return {
        targetsBySession: {
          ...state.targetsBySession,
          [sessionId]: normalizedTargets,
        },
        selectedTargetIdBySession: {
          ...state.selectedTargetIdBySession,
          [sessionId]: nextSelected,
        },
        paneOpenBySession: {
          ...state.paneOpenBySession,
          [sessionId]: normalizedTargets.length > 0 && (state.paneOpenBySession[sessionId] ?? false),
        },
      };
    }),

  upsertTarget: (sessionId, target, selectedTargetId) =>
    set((state) => {
      const currentTargets = state.targetsBySession[sessionId] ?? [];
      const nextTargets = dedupeTargets([
        ...currentTargets.filter((entry) => entry.id !== target.id),
        target,
      ]);
      const nextSelected = nextSelectedTargetId(
        nextTargets,
        state.selectedTargetIdBySession[sessionId],
        selectedTargetId,
      );
      return {
        targetsBySession: {
          ...state.targetsBySession,
          [sessionId]: nextTargets,
        },
        selectedTargetIdBySession: {
          ...state.selectedTargetIdBySession,
          [sessionId]: nextSelected,
        },
      };
    }),

  removeTarget: (sessionId, targetId) =>
    set((state) => {
      const currentTargets = state.targetsBySession[sessionId] ?? [];
      const nextTargets = currentTargets.filter((target) => target.id !== targetId);
      const nextSelected = nextSelectedTargetId(
        nextTargets,
        state.selectedTargetIdBySession[sessionId],
      );
      return {
        targetsBySession: {
          ...state.targetsBySession,
          [sessionId]: nextTargets,
        },
        selectedTargetIdBySession: {
          ...state.selectedTargetIdBySession,
          [sessionId]: nextSelected,
        },
        paneOpenBySession: {
          ...state.paneOpenBySession,
          [sessionId]: nextTargets.length > 0 ? (state.paneOpenBySession[sessionId] ?? false) : false,
        },
      };
    }),

  clearSession: (sessionId) =>
    set((state) => {
      const { [sessionId]: _targets, ...targetsBySession } = state.targetsBySession;
      const { [sessionId]: _selected, ...selectedTargetIdBySession } = state.selectedTargetIdBySession;
      const { [sessionId]: _paneOpen, ...paneOpenBySession } = state.paneOpenBySession;
      return {
        targetsBySession,
        selectedTargetIdBySession,
        paneOpenBySession,
      };
    }),

  selectTarget: (sessionId, targetId) =>
    set((state) => ({
      selectedTargetIdBySession: {
        ...state.selectedTargetIdBySession,
        [sessionId]: targetId,
      },
    })),

  setPaneOpen: (sessionId, open) =>
    set((state) => ({
      paneOpenBySession: {
        ...state.paneOpenBySession,
        [sessionId]: open,
      },
    })),

  togglePane: (sessionId) =>
    set((state) => ({
      paneOpenBySession: {
        ...state.paneOpenBySession,
        [sessionId]: !(state.paneOpenBySession[sessionId] ?? false),
      },
    })),
}));

const SET_EVENT_TYPES = new Set([
  "session_preview_state",
  "preview_state",
  "preview_ports",
  "open_ports",
]);
const UPSERT_EVENT_TYPES = new Set([
  "session_preview_opened",
  "preview_opened",
  "preview_port_opened",
  "port_opened",
]);
const REMOVE_EVENT_TYPES = new Set([
  "session_preview_closed",
  "preview_closed",
  "preview_port_closed",
  "port_closed",
]);
const CLEAR_EVENT_TYPES = new Set(["session_preview_cleared", "preview_cleared"]);

function normalizeTargetsFromPayload(payload: Record<string, unknown>) {
  const rawTargets = payload.targets ?? payload.previews ?? payload.ports;
  if (!Array.isArray(rawTargets)) return [];
  return rawTargets
    .map(normalizeTarget)
    .filter((value): value is PreviewTarget => value !== null);
}

function normalizeSelectedTargetId(payload: Record<string, unknown>) {
  const value = payload.selectedTargetId ?? payload.selected_preview_id ?? payload.activeTargetId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePreviewEventPayload(eventType: string, sessionId: string, data: unknown): PreviewEventPayload | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;

  if (SET_EVENT_TYPES.has(eventType)) {
    return {
      sessionId,
      mode: "set",
      targets: normalizeTargetsFromPayload(payload),
      selectedTargetId: normalizeSelectedTargetId(payload),
    };
  }

  if (UPSERT_EVENT_TYPES.has(eventType)) {
    const target = normalizeTarget(payload.target ?? payload.preview ?? payload);
    if (!target) return null;
    return {
      sessionId,
      mode: "upsert",
      target,
      selectedTargetId: normalizeSelectedTargetId(payload),
    };
  }

  if (REMOVE_EVENT_TYPES.has(eventType)) {
    const targetIdValue = payload.targetId ?? payload.target_id ?? payload.id;
    const normalizedTarget = normalizeTarget(payload.target ?? payload.preview ?? payload);
    const targetId = typeof targetIdValue === "string" && targetIdValue.trim()
      ? targetIdValue.trim()
      : normalizedTarget?.id;
    if (!targetId) return null;
    return {
      sessionId,
      mode: "remove",
      targetId,
    };
  }

  if (CLEAR_EVENT_TYPES.has(eventType)) {
    return {
      sessionId,
      mode: "clear",
    };
  }

  return null;
}

export function applyPreviewEvent(event: PreviewEventPayload) {
  const store = usePreviewStore.getState();
  if (event.mode === "set") {
    store.setTargets(event.sessionId, event.targets ?? [], event.selectedTargetId ?? null);
    return;
  }
  if (event.mode === "upsert" && event.target) {
    store.upsertTarget(event.sessionId, event.target, event.selectedTargetId ?? null);
    return;
  }
  if (event.mode === "remove" && event.targetId) {
    store.removeTarget(event.sessionId, event.targetId);
    return;
  }
  if (event.mode === "clear") {
    store.clearSession(event.sessionId);
  }
}

export function parsePreviewEvent(eventType: string, sessionId: string, data: unknown) {
  return normalizePreviewEventPayload(eventType, sessionId, data);
}

export function getSelectedPreviewTarget(sessionId: string | null) {
  if (!sessionId) return null;
  const state = usePreviewStore.getState();
  const targets = state.targetsBySession[sessionId] ?? [];
  const selectedTargetId = state.selectedTargetIdBySession[sessionId];
  return targets.find((target) => target.id === selectedTargetId) ?? targets[0] ?? null;
}
