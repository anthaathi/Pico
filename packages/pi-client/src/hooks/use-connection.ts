import { usePiClient } from "./context";
import { useObservable } from "./use-observable";
import type { ConnectionState } from "../types";

const INITIAL: ConnectionState = {
  status: "idle",
  retryAttempt: 0,
  nextRetryAt: null,
  lastDisconnectReason: null,
  disconnectedAt: null,
};

export function useConnection(): ConnectionState & { reconnect: () => void } {
  const client = usePiClient();
  const state = useObservable(client.connection$, INITIAL);
  return {
    ...state,
    reconnect: () => client.reconnect(),
  };
}
