import { createContext, useContext } from "react";

const EMPTY_SET = new Set<string>();

export const VisibleMessagesContext = createContext<Set<string>>(EMPTY_SET);

export function useVisibleMessages(): Set<string> {
  return useContext(VisibleMessagesContext);
}

export const MessageIdContext = createContext<string | null>(null);

export function useIsMessageVisible(): boolean {
  const visibleIds = useVisibleMessages();
  const messageId = useContext(MessageIdContext);
  if (!messageId || visibleIds.size === 0) return true;
  return visibleIds.has(messageId);
}

interface MobileDiffSheetContextValue {
  open(tabId?: string): void;
}

const NOOP_MOBILE_SHEET: MobileDiffSheetContextValue = { open: () => {} };

export const MobileDiffSheetContext =
  createContext<MobileDiffSheetContextValue>(NOOP_MOBILE_SHEET);

export function useMobileDiffSheet(): MobileDiffSheetContextValue {
  return useContext(MobileDiffSheetContext);
}
