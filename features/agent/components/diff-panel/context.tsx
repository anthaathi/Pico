import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ChatMessage, ToolCallInfo } from "../../types";
import { useAppSettingsStore } from "@/features/settings/store";

export interface DiffTab {
  id: string;
  toolName: "edit" | "write";
  path: string;
  fileName: string;
}

interface DiffPanelState {
  isOpen: boolean;
  tabs: DiffTab[];
  activeTabId: string | null;
  userPinned: boolean;
}

interface DiffPanelContextValue extends DiffPanelState {
  selectTab: (tab: DiffTab) => void;
  autoAddTab: (tab: DiffTab) => void;
  closeTab: (id: string) => void;
  close: () => void;
  findToolCall: (id: string) => ToolCallInfo | undefined;
}

const NOOP_CTX: DiffPanelContextValue = {
  isOpen: false,
  tabs: [],
  activeTabId: null,
  userPinned: false,
  selectTab: () => {},
  autoAddTab: () => {},
  closeTab: () => {},
  close: () => {},
  findToolCall: () => undefined,
};

const DiffPanelContext = createContext<DiffPanelContextValue>(NOOP_CTX);

export function useDiffPanel(): DiffPanelContextValue {
  return useContext(DiffPanelContext);
}

export function useDiffPanelOpen(): boolean {
  return useContext(DiffPanelContext).isOpen;
}

export function DiffPanelProvider({
  messages,
  children,
}: {
  messages: ChatMessage[];
  children: ReactNode;
}) {
  const [state, setState] = useState<DiffPanelState>({
    isOpen: false,
    tabs: [],
    activeTabId: null,
    userPinned: false,
  });

  const lastUserMsgIdRef = useRef<string | null>(null);

  const latestUserMsg = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i];
    }
    return null;
  }, [messages]);

  if (latestUserMsg && latestUserMsg.id !== lastUserMsgIdRef.current) {
    lastUserMsgIdRef.current = latestUserMsg.id;
    if (state.userPinned) {
      setState((prev) => ({ ...prev, userPinned: false }));
    }
  }

  const selectTab = useCallback((tab: DiffTab) => {
    setState((prev) => {
      const exists = prev.tabs.find((t) => t.id === tab.id);
      if (exists) {
        return { ...prev, isOpen: true, activeTabId: tab.id, userPinned: true };
      }
      return {
        ...prev,
        isOpen: true,
        tabs: [...prev.tabs, tab],
        activeTabId: tab.id,
        userPinned: true,
      };
    });
  }, []);

  const autoAddTab = useCallback((tab: DiffTab) => {
    setState((prev) => {
      const exists = prev.tabs.find((t) => t.id === tab.id);
      if (exists) return prev;
      const nextTabs = [...prev.tabs, tab];
      if (prev.userPinned) {
        return { ...prev, tabs: nextTabs };
      }
      return {
        ...prev,
        isOpen: true,
        tabs: nextTabs,
        activeTabId: tab.id,
      };
    });
  }, []);

  const closeTab = useCallback((id: string) => {
    setState((prev) => {
      const next = prev.tabs.filter((t) => t.id !== id);
      if (next.length === 0) {
        return { isOpen: false, tabs: [], activeTabId: null, userPinned: false };
      }
      const activeStillExists = next.some((t) => t.id === prev.activeTabId);
      return {
        ...prev,
        tabs: next,
        activeTabId: activeStillExists
          ? prev.activeTabId
          : next[next.length - 1].id,
      };
    });
  }, []);

  const close = useCallback(() => {
    setState({ isOpen: false, tabs: [], activeTabId: null, userPinned: false });
  }, []);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const findToolCall = useCallback((id: string): ToolCallInfo | undefined => {
    const msgs = messagesRef.current;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const tcs = msgs[i].toolCalls;
      if (!tcs) continue;
      const tc = tcs.find((t) => t.id === id || t.previousId === id);
      if (tc) return tc;
    }
    return undefined;
  }, []);

  const value = useMemo<DiffPanelContextValue>(
    () => ({
      ...state,
      selectTab,
      autoAddTab,
      closeTab,
      close,
      findToolCall,
    }),
    [state, selectTab, autoAddTab, closeTab, close, findToolCall],
  );

  return (
    <DiffPanelContext.Provider value={value}>
      {children}
    </DiffPanelContext.Provider>
  );
}

export function useAutoOpenDiffTab(
  tab: DiffTab | null,
  isRunning: boolean,
) {
  const autoOpen = useAppSettingsStore((s) => s.diffPanelAutoOpen);
  const { autoAddTab } = useDiffPanel();
  const registeredRef = useRef<string | null>(null);

  useEffect(() => {
    if (!autoOpen) return;
    if (!tab || !isRunning) return;
    if (registeredRef.current === tab.id) return;
    registeredRef.current = tab.id;
    autoAddTab(tab);
  }, [autoOpen, tab, isRunning, autoAddTab]);
}
