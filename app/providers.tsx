"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { EternlConnection } from "@/lib/eternl";
import { connectEternl, isEternlAvailable } from "@/lib/eternl";

type WalletContextValue = {
  connection: EternlConnection | null;
  connecting: boolean;
  error: string | null;
  available: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function Providers({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<EternlConnection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = useMemo<WalletContextValue>(
    () => ({
      connection,
      connecting,
      error,
      available: isEternlAvailable(),
      connect: async () => {
        setConnecting(true);
        setError(null);
        try {
          setConnection(await connectEternl());
        } catch (cause) {
          setConnection(null);
          setError(
            cause instanceof Error ? cause.message : "Eternl connection failed.",
          );
        } finally {
          setConnecting(false);
        }
      },
      disconnect: () => {
        setConnection(null);
        setError(null);
      },
    }),
    [connection, connecting, error],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside Providers");
  return value;
}
