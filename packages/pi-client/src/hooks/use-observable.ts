import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Observable } from "rxjs";

export function useObservable<T>(observable: Observable<T> | null | undefined, initialValue: T): T {
  const stateRef = useRef<T>(initialValue);
  const subscribersRef = useRef(new Set<() => void>());
  const subRef = useRef<{ unsubscribe(): void } | null>(null);

  useEffect(() => {
    if (!observable) {
      stateRef.current = initialValue;
      return;
    }
    subRef.current = observable.subscribe((value) => {
      stateRef.current = value;
      for (const notify of subscribersRef.current) {
        notify();
      }
    });
    return () => {
      subRef.current?.unsubscribe();
      subRef.current = null;
    };
  }, [observable]);

  return useSyncExternalStore(
    (onStoreChange) => {
      subscribersRef.current.add(onStoreChange);
      return () => {
        subscribersRef.current.delete(onStoreChange);
      };
    },
    () => stateRef.current,
    () => initialValue,
  );
}
