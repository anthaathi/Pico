import { create } from 'zustand';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import {
  client,
  sdk,
  unwrapApiData,
  type AuthTokensResponse,
} from '@pi-ui/client';
import { useServersStore, type Server } from '@/features/servers/store';

const {
  checkSession,
  login: apiLogin,
  logout: apiLogout,
  pair: apiPair,
  refresh: apiRefresh,
} = sdk;

const TOKENS_KEY = 'auth_tokens';
const ACTIVE_SERVER_KEY = 'auth_active_server';
const DEBUG_ROUTES = [
  '/api/auth/pair',
  '/api/auth/refresh',
  '/api/auth/session',
  '/api/workspaces',
];
const RETRY_EXCLUDED_ROUTES = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/pair',
  '/api/auth/refresh',
];
const REFRESH_SKEW_MS = 15_000;
const REFRESH_RETRY_DELAY_MS = 5_000;

let clientAuthInitialized = false;
let configuredServerId: string | null = null;
let scheduledRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let scheduledRefreshServerId: string | null = null;
const refreshInFlight = new Map<string, Promise<AuthSessionBundle | null>>();

export interface AuthSessionBundle {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

interface StoredAuthState {
  tokens: Record<string, AuthSessionBundle>;
  activeServerId: string | null;
  migrated: boolean;
}

interface AuthState {
  tokens: Record<string, AuthSessionBundle>;
  activeServerId: string | null;
  loaded: boolean;
  /** Whether the active server has desktop/remote mode enabled (Linux only). */
  remote: boolean;

  load: () => Promise<void>;
  loginToServer: (server: Server, credentials: { username: string; password: string }) => Promise<{ success: boolean; error?: string }>;
  pairWithServer: (
    baseUrl: string,
    qrId: string,
    serverId: string,
  ) => Promise<{ success: boolean; error?: string }>;
  logoutFromServer: (serverId: string) => Promise<void>;
  activateServer: (server: Server) => Promise<boolean>;
  hasToken: (serverId: string) => boolean;
  refreshServerSession: (serverId: string) => Promise<AuthSessionBundle | null>;
  ensureActiveServerSession: () => Promise<boolean>;
  refreshActiveServerSession: () => Promise<boolean>;
  clearServerSession: (serverId: string) => Promise<void>;
}

function formatTokenDebug(token: string | null | undefined) {
  if (!token) return 'none';
  return `${token.slice(0, 8)}... len=${token.length}`;
}

function formatSessionDebug(session: AuthSessionBundle | null | undefined) {
  if (!session) return 'none';
  return `access=${formatTokenDebug(session.accessToken)} refresh=${formatTokenDebug(session.refreshToken)} accessExp=${session.accessExpiresAt} refreshExp=${session.refreshExpiresAt}`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAuthSessionBundle(value: unknown): value is AuthSessionBundle {
  if (!isObjectRecord(value)) return false;
  return (
    typeof value.accessToken === 'string' &&
    typeof value.refreshToken === 'string' &&
    typeof value.accessExpiresAt === 'string' &&
    typeof value.refreshExpiresAt === 'string'
  );
}

function normalizeStoredSessions(raw: unknown): {
  tokens: Record<string, AuthSessionBundle>;
  migrated: boolean;
} {
  if (!isObjectRecord(raw)) {
    return { tokens: {}, migrated: raw !== null && raw !== undefined };
  }

  const tokens: Record<string, AuthSessionBundle> = {};
  let migrated = false;

  for (const [serverId, value] of Object.entries(raw)) {
    if (isAuthSessionBundle(value)) {
      tokens[serverId] = value;
      continue;
    }
    migrated = true;
  }

  return { tokens, migrated };
}

function toAuthSessionBundle(value: unknown): AuthSessionBundle | null {
  const data = unwrapApiData<AuthTokensResponse>(
    value as AuthTokensResponse | null | undefined,
  );
  if (
    !data?.access_token ||
    !data.refresh_token ||
    !data.access_expires_at ||
    !data.refresh_expires_at
  ) {
    return null;
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessExpiresAt: data.access_expires_at,
    refreshExpiresAt: data.refresh_expires_at,
  };
}

function parseExpiresAt(value: string) {
  const expiresAt = Date.parse(value);
  return Number.isFinite(expiresAt) ? expiresAt : 0;
}

function msUntilExpiry(value: string) {
  return parseExpiresAt(value) - Date.now();
}

function isAccessTokenNearExpiry(
  session: AuthSessionBundle,
  skewMs = REFRESH_SKEW_MS,
) {
  return msUntilExpiry(session.accessExpiresAt) <= skewMs;
}

function isRefreshTokenExpired(session: AuthSessionBundle) {
  return parseExpiresAt(session.refreshExpiresAt) <= Date.now();
}

function clearScheduledRefresh() {
  if (scheduledRefreshTimer) {
    clearTimeout(scheduledRefreshTimer);
    scheduledRefreshTimer = null;
  }
  scheduledRefreshServerId = null;
}

function extractErrorMessage(error: unknown, fallback: string) {
  if (
    error &&
    typeof error === 'object' &&
    'error' in error &&
    typeof (error as { error?: unknown }).error === 'string'
  ) {
    return (error as { error: string }).error;
  }
  return fallback;
}

async function readStore(): Promise<StoredAuthState> {
  try {
    if (Platform.OS === 'web') {
      const rawTokens = localStorage.getItem(TOKENS_KEY);
      const activeServerId = localStorage.getItem(ACTIVE_SERVER_KEY);
      const normalized = normalizeStoredSessions(
        rawTokens ? JSON.parse(rawTokens) : {},
      );
      return {
        tokens: normalized.tokens,
        activeServerId:
          activeServerId && normalized.tokens[activeServerId]
            ? activeServerId
            : null,
        migrated: normalized.migrated || (!!activeServerId && !normalized.tokens[activeServerId]),
      };
    }

    const rawTokens = await SecureStore.getItemAsync(TOKENS_KEY);
    const activeServerId = await SecureStore.getItemAsync(ACTIVE_SERVER_KEY);
    const normalized = normalizeStoredSessions(rawTokens ? JSON.parse(rawTokens) : {});
    return {
      tokens: normalized.tokens,
      activeServerId:
        activeServerId && normalized.tokens[activeServerId]
          ? activeServerId
          : null,
      migrated: normalized.migrated || (!!activeServerId && !normalized.tokens[activeServerId]),
    };
  } catch {
    return { tokens: {}, activeServerId: null, migrated: true };
  }
}

async function writeTokens(tokens: Record<string, AuthSessionBundle>) {
  try {
    const json = JSON.stringify(tokens);
    if (Platform.OS === 'web') {
      localStorage.setItem(TOKENS_KEY, json);
    } else {
      await SecureStore.setItemAsync(TOKENS_KEY, json);
    }
  } catch {}
}

async function writeActiveServerId(serverId: string | null) {
  try {
    if (Platform.OS === 'web') {
      if (serverId) localStorage.setItem(ACTIVE_SERVER_KEY, serverId);
      else localStorage.removeItem(ACTIVE_SERVER_KEY);
    } else {
      if (serverId) await SecureStore.setItemAsync(ACTIVE_SERVER_KEY, serverId);
      else await SecureStore.deleteItemAsync(ACTIVE_SERVER_KEY);
    }
  } catch {}
}

function findServer(serverId: string) {
  return useServersStore
    .getState()
    .servers.find((server) => server.id === serverId);
}

function currentConfiguredAccessToken() {
  if (!configuredServerId) {
    return undefined;
  }
  return useAuthStore.getState().tokens[configuredServerId]?.accessToken;
}

function configureClient(serverId: string | null, baseUrl?: string) {
  configuredServerId = serverId;
  console.log(
    `[auth] configureClient serverId=${serverId ?? 'none'} baseUrl=${baseUrl ?? 'none'} token=${formatTokenDebug(
      currentConfiguredAccessToken(),
    )}`,
  );
  client.setConfig({ baseUrl, auth: async () => currentConfiguredAccessToken() });
}

function currentRequestPath(requestUrl: string, path?: string) {
  if (path) {
    return path;
  }

  try {
    return new URL(requestUrl).pathname;
  } catch {
    return requestUrl;
  }
}

export const useAuthStore = create<AuthState>((set, get) => {
  async function persistAuthState(
    tokens: Record<string, AuthSessionBundle>,
    activeServerId: string | null,
  ) {
    await writeTokens(tokens);
    await writeActiveServerId(activeServerId);
  }

  function scheduleRefreshAttempt(serverId: string, delayMs: number) {
    clearScheduledRefresh();
    scheduledRefreshServerId = serverId;
    scheduledRefreshTimer = setTimeout(async () => {
      if (scheduledRefreshServerId !== serverId) {
        return;
      }

      const currentSession = get().tokens[serverId];
      if (!currentSession || get().activeServerId !== serverId) {
        clearScheduledRefresh();
        return;
      }

      const refreshed = await get().refreshServerSession(serverId);
      if (refreshed) {
        return;
      }

      const retrySession = get().tokens[serverId];
      if (
        !retrySession ||
        get().activeServerId !== serverId ||
        isRefreshTokenExpired(retrySession)
      ) {
        clearScheduledRefresh();
        return;
      }

      scheduleRefreshAttempt(serverId, REFRESH_RETRY_DELAY_MS);
    }, Math.max(0, delayMs));
  }

  function syncRefreshSchedule(activeServerId = get().activeServerId) {
    if (!activeServerId) {
      clearScheduledRefresh();
      return;
    }

    const session = get().tokens[activeServerId];
    if (!session) {
      clearScheduledRefresh();
      return;
    }

    if (isRefreshTokenExpired(session)) {
      clearScheduledRefresh();
      void removeServerSession(activeServerId, null);
      return;
    }

    scheduleRefreshAttempt(
      activeServerId,
      Math.max(0, msUntilExpiry(session.accessExpiresAt) - REFRESH_SKEW_MS),
    );
  }

  async function ensureServerSession(
    serverId: string,
    options: { force?: boolean } = {},
  ) {
    const session = get().tokens[serverId];
    if (!session) {
      return null;
    }

    if (isRefreshTokenExpired(session)) {
      await removeServerSession(serverId);
      return null;
    }

    if (!options.force && !isAccessTokenNearExpiry(session)) {
      if (get().activeServerId === serverId) {
        syncRefreshSchedule(serverId);
      }
      return session;
    }

    return get().refreshServerSession(serverId);
  }

  async function applySessionBundle(
    serverId: string,
    session: AuthSessionBundle,
    options: { activeServerId?: string | null; baseUrl?: string } = {},
  ) {
    const tokens = { ...get().tokens, [serverId]: session };
    const activeServerId =
      options.activeServerId !== undefined
        ? options.activeServerId
        : get().activeServerId;

    set({ tokens, activeServerId });
    await persistAuthState(tokens, activeServerId);

    if (options.baseUrl) {
      configureClient(serverId, options.baseUrl);
    }

    syncRefreshSchedule(activeServerId);
  }

  async function removeServerSession(
    serverId: string,
    nextActiveServerId: string | null = get().activeServerId === serverId
      ? null
      : get().activeServerId,
  ) {
    const { [serverId]: _removed, ...tokens } = get().tokens;
    set({ tokens, activeServerId: nextActiveServerId });
    await persistAuthState(tokens, nextActiveServerId);

    if (configuredServerId === serverId) {
      if (nextActiveServerId) {
        const nextServer = findServer(nextActiveServerId);
        configureClient(nextActiveServerId, nextServer?.address);
      } else {
        configureClient(null, undefined);
      }
    }

    syncRefreshSchedule(nextActiveServerId);
  }

  return {
    tokens: {},
    activeServerId: null,
    loaded: false,
    remote: false,

    load: async () => {
      const { tokens, activeServerId, migrated } = await readStore();
      set({ tokens, activeServerId, loaded: true });

      if (migrated) {
        await persistAuthState(tokens, activeServerId);
      }
    },

    loginToServer: async (server: Server, credentials: { username: string; password: string }) => {
      const result = await apiLogin({
        baseUrl: server.address,
        body: {
          username: credentials.username,
          password: credentials.password,
        },
      });

      if (result.error) {
        return {
          success: false,
          error: extractErrorMessage(result.error, 'Login failed'),
        };
      }

      const session = toAuthSessionBundle(result.data);
      console.log(`[loginToServer] response session=${formatSessionDebug(session)}`);
      if (!session) {
        return { success: false, error: 'Login tokens missing from response' };
      }

      await applySessionBundle(server.id, session, {
        activeServerId: server.id,
        baseUrl: server.address,
      });

      return { success: true };
    },

    pairWithServer: async (baseUrl: string, qrId: string, serverId: string) => {
      const result = await apiPair({
        baseUrl,
        body: { qr_id: qrId },
      });

      if (result.error) {
        return {
          success: false,
          error: extractErrorMessage(result.error, 'Pairing failed'),
        };
      }

      const session = toAuthSessionBundle(result.data);
      console.log(`[pairWithServer] response session=${formatSessionDebug(session)}`);
      if (!session) {
        return { success: false, error: 'Pairing tokens missing from response' };
      }

      await applySessionBundle(serverId, session, {
        activeServerId: serverId,
        baseUrl,
      });

      return { success: true };
    },

    logoutFromServer: async (serverId: string) => {
      const session = get().tokens[serverId];
      const server = findServer(serverId);

      if (session && server) {
        try {
          await apiLogout({
            baseUrl: server.address,
            body: { refresh_token: session.refreshToken },
            headers: session.accessToken
              ? { Authorization: `Bearer ${session.accessToken}` }
              : undefined,
          });
        } catch {
          // Best-effort logout. Local session is always cleared below.
        }
      }

      await removeServerSession(serverId);
    },

    activateServer: async (server: Server) => {
      const session = get().tokens[server.id];
      if (!session) return false;

      const previousConfiguredServerId = configuredServerId;
      const previousConfiguredServer = previousConfiguredServerId
        ? findServer(previousConfiguredServerId)
        : null;

      configureClient(server.id, server.address);

      const ensuredSession = await ensureServerSession(server.id);
      if (!ensuredSession) {
        if (previousConfiguredServerId && previousConfiguredServerId !== server.id) {
          configureClient(previousConfiguredServerId, previousConfiguredServer?.address);
        } else if (previousConfiguredServerId !== server.id) {
          configureClient(null, undefined);
        }
        return false;
      }

      const result = await checkSession();
      if (result.error) {
        const status = result.response?.status ?? 0;
        if (status === 401 || status === 403) {
          await removeServerSession(
            server.id,
            get().activeServerId === server.id ? null : get().activeServerId,
          );
        } else if (previousConfiguredServerId && previousConfiguredServerId !== server.id) {
          configureClient(previousConfiguredServerId, previousConfiguredServer?.address);
        } else if (previousConfiguredServerId !== server.id) {
          configureClient(null, undefined);
        }
        return false;
      }

      // Fetch server capabilities (remote flag) from /version
      let remote = false;
      try {
        const versionRes = await sdk.version();
        const versionData = versionRes.data as any;
        remote = !!versionData?.remote;
      } catch {
        // Non-fatal — default to false
      }

      set({ activeServerId: server.id, remote });
      await writeActiveServerId(server.id);
      syncRefreshSchedule(server.id);
      return true;
    },

    hasToken: (serverId: string) => {
      return !!get().tokens[serverId];
    },

    refreshServerSession: async (serverId: string) => {
      const existing = refreshInFlight.get(serverId);
      if (existing) {
        return existing;
      }

      const task = (async () => {
        const session = get().tokens[serverId];
        if (!session) {
          return null;
        }

        if (isRefreshTokenExpired(session)) {
          await removeServerSession(serverId);
          return null;
        }

        const server = findServer(serverId);
        if (!server) {
          if (useServersStore.getState().loaded) {
            await removeServerSession(serverId);
          }
          return null;
        }

        console.log(
          `[auth] refreshServerSession serverId=${serverId} session=${formatSessionDebug(
            session,
          )}`,
        );

        const result = await apiRefresh({
          baseUrl: server.address,
          body: { refresh_token: session.refreshToken },
        });

        if (result.error) {
          const status = result.response?.status ?? 0;
          if (status === 401 || status === 403) {
            await removeServerSession(serverId);
          }
          return null;
        }

        const nextSession = toAuthSessionBundle(result.data);
        if (!nextSession) {
          return null;
        }

        await applySessionBundle(serverId, nextSession, {
          baseUrl: configuredServerId === serverId ? server.address : undefined,
        });

        return nextSession;
      })();

      refreshInFlight.set(serverId, task);
      try {
        return await task;
      } finally {
        refreshInFlight.delete(serverId);
      }
    },

    ensureActiveServerSession: async () => {
      if (!configuredServerId) {
        return false;
      }
      return !!(await ensureServerSession(configuredServerId));
    },

    refreshActiveServerSession: async () => {
      if (!configuredServerId) {
        return false;
      }
      return !!(await ensureServerSession(configuredServerId, { force: true }));
    },

    clearServerSession: async (serverId: string) => {
      await removeServerSession(serverId);
    },
  };
});

function initializeClientAuth() {
  if (clientAuthInitialized) {
    return;
  }
  clientAuthInitialized = true;

  (client.setConfig as (cfg: Record<string, unknown>) => void)({
    auth: async () => currentConfiguredAccessToken(),
    requestValidator: async (value: unknown) => {
      const request = value as {
        method?: string;
        url?: string;
        baseUrl?: string;
        auth?: unknown;
        headers?: Headers;
      };
      const fullUrl = `${request.baseUrl ?? ''}${request.url ?? ''}`;
      if (!DEBUG_ROUTES.some((route) => fullUrl.includes(route))) {
        return;
      }

      const authHeader = request.headers?.get('Authorization');
      const authConfig =
        typeof request.auth === 'string'
          ? formatTokenDebug(request.auth.replace(/^Bearer\s+/i, ''))
          : request.auth
            ? '[auth-callback]'
            : 'none';

      console.log(
        `[req] ${request.method ?? 'GET'} ${fullUrl} authHeader=${formatTokenDebug(
          authHeader?.replace(/^Bearer\s+/i, ''),
        )} configAuth=${authConfig} configuredServerId=${configuredServerId ?? 'none'}`,
      );
    },
  });

  client.interceptors.request.use(async (request, opts) => {
    const path = currentRequestPath(request.url, opts.url);
    if (!RETRY_EXCLUDED_ROUTES.some((route) => path.includes(route))) {
      await useAuthStore.getState().ensureActiveServerSession();
    }

    const token = currentConfiguredAccessToken();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    } else {
      request.headers.delete('Authorization');
      request.headers.delete('authorization');
    }

    try {
      (opts as { _authRetryRequest?: Request })._authRetryRequest = request.clone();
    } catch {
      (opts as { _authRetryRequest?: Request })._authRetryRequest = undefined;
    }

    return request;
  });

  client.interceptors.response.use(async (response, request, opts) => {
    if (response.status !== 401 || (opts as { _authRetry?: boolean })._authRetry) {
      return response;
    }

    const path = currentRequestPath(request.url, opts.url);
    if (RETRY_EXCLUDED_ROUTES.some((route) => path.includes(route))) {
      return response;
    }

    const serverId = configuredServerId;
    if (!serverId) {
      return response;
    }

    const refreshed = await useAuthStore.getState().refreshServerSession(serverId);
    if (!refreshed) {
      return response;
    }

    const retrySource = (opts as { _authRetryRequest?: Request })._authRetryRequest;
    const retryHeaders = new Headers(retrySource?.headers ?? request.headers);
    retryHeaders.delete('Authorization');
    retryHeaders.delete('authorization');
    const newToken = currentConfiguredAccessToken();
    if (newToken) {
      retryHeaders.set('Authorization', `Bearer ${newToken}`);
    }

    const _fetch = (opts as { fetch?: typeof fetch }).fetch ?? globalThis.fetch;
    const retryRequest = retrySource
      ? new Request(retrySource, { headers: retryHeaders, signal: request.signal })
      : new Request(request.url, {
          method: request.method,
          headers: retryHeaders,
          body:
            request.method !== 'GET' && request.method !== 'HEAD'
              ? request.body
              : undefined,
          redirect: 'follow',
          signal: request.signal,
        });

    try {
      return await _fetch(retryRequest);
    } catch {
      return response;
    }
  });
}

initializeClientAuth();
