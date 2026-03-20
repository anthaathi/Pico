import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { PiClient } from "../core/pi-client";
import type { PiClientConfig } from "../types";

const PiClientContext = createContext<PiClient | null>(null);

export interface PiClientProviderProps {
  config: PiClientConfig;
  children: ReactNode;
}

export function PiClientProvider({ config, children }: PiClientProviderProps) {
  const clientRef = useRef<PiClient | null>(null);

  if (!clientRef.current) {
    clientRef.current = new PiClient(config);
  }

  const client = clientRef.current;

  useEffect(() => {
    client.connect();
    return () => client.disconnect();
  }, [client]);

  useEffect(() => {
    client.updateToken(config.accessToken);
  }, [client, config.accessToken]);

  return (
    <PiClientContext.Provider value={client}>
      {children}
    </PiClientContext.Provider>
  );
}

export function usePiClient(): PiClient {
  const client = useContext(PiClientContext);
  if (!client) {
    throw new Error("usePiClient must be used within a <PiClientProvider>");
  }
  return client;
}
