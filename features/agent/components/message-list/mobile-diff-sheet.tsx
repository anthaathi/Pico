import { createContext, useContext, type ReactNode } from "react";

const MobileDiffSheetContext = createContext<null>(null);

export function MobileDiffSheetProvider({ children }: { children: ReactNode }) {
  return (
    <MobileDiffSheetContext.Provider value={null}>
      {children}
    </MobileDiffSheetContext.Provider>
  );
}

export function useMobileDiffSheet() {
  return useContext(MobileDiffSheetContext);
}
