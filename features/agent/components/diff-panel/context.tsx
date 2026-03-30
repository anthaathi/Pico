import { createContext, useContext, type ReactNode } from "react";

export interface DiffTab {
  id: string;
  toolName: "edit" | "write";
  path: string;
  fileName: string;
}

interface DiffPanelContextValue {
  isOpen: boolean;
  tabs: DiffTab[];
  activeTabId: string | null;
  userPinned: boolean;
  selectTab: (tab: DiffTab) => void;
  autoAddTab: (tab: DiffTab) => void;
  closeTab: (id: string) => void;
  close: () => void;
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
};

const DiffPanelContext = createContext<DiffPanelContextValue>(NOOP_CTX);

export function useDiffPanel(): DiffPanelContextValue {
  return useContext(DiffPanelContext);
}

export function useDiffPanelOpen(): boolean {
  return useContext(DiffPanelContext).isOpen;
}

export function DiffPanelProvider({
  children,
}: {
  messages?: unknown[];
  children: ReactNode;
}) {
  return (
    <DiffPanelContext.Provider value={NOOP_CTX}>
      {children}
    </DiffPanelContext.Provider>
  );
}

export function useAutoOpenDiffTab(
  _tab: DiffTab | null,
  _isRunning: boolean,
) {}
