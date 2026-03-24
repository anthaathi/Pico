import { useEffect } from "react";

import { usePiClient } from "@pi-ui/client";
import { applyPreviewEvent, parsePreviewEvent } from "@/features/preview/store";

export const GLOBAL_PREVIEW_KEY = "__global__";

export function PreviewEventSubscriber() {
  const client = usePiClient();

  useEffect(() => {
    const sub = client.events$.subscribe((event) => {
      const sessionId = event.session_id || GLOBAL_PREVIEW_KEY;
      const previewEvent = parsePreviewEvent(event.type, sessionId, event.data);
      if (!previewEvent) return;
      applyPreviewEvent(previewEvent);
    });
    return () => sub.unsubscribe();
  }, [client]);

  return null;
}
