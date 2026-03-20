import { useEffect } from "react";
import { usePiClient } from "./context";
import type { StreamEventEnvelope } from "../types/stream-events";

interface UseAgentEventOptions {
  sessionId?: string;
  types?: string[];
}

export function useAgentEvent(
  handler: (event: StreamEventEnvelope) => void,
  options?: UseAgentEventOptions,
): void {
  const client = usePiClient();

  useEffect(() => {
    const subscription = client.events$.subscribe((event) => {
      if (options?.sessionId && event.session_id !== options.sessionId) return;
      if (options?.types && !options.types.includes(event.type)) return;
      handler(event);
    });
    return () => subscription.unsubscribe();
  }, [client, handler, options?.sessionId, options?.types]);
}
