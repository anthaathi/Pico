import { useMemo } from "react";
import { map, distinctUntilChanged } from "rxjs";
import { usePiClient } from "./context";
import { useObservable } from "./use-observable";

export function useIsSessionActive(sessionId: string | null): boolean {
  const client = usePiClient();

  const active$ = useMemo(() => {
    if (!sessionId) return null;
    const sid = sessionId;
    return client.activeSessions$.pipe(
      map((set) => set.has(sid)),
      distinctUntilChanged(),
    );
  }, [client, sessionId]);

  return useObservable(active$!, false);
}
