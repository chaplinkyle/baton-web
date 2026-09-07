"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { EternlConnection } from "@/lib/eternl";
import {
  connectEternl,
  isEternlAvailable,
  walletErrorMessage,
  wasEternlAuthorized,
} from "@/lib/eternl";

export type WalletAvailability = "detecting" | "available" | "missing";

const DETECTION_GRACE_MS = 800;
const LATE_INJECTION_WINDOW_MS = 5_000;

type WalletContextValue = {
  connection: EternlConnection | null;
  connecting: boolean;
  error: string | null;
  available: boolean;
  availability: WalletAvailability;
  connect: () => Promise<void>;
  disconnect: () => void;
  clearError: () => void;
  detect: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function Providers({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<EternlConnection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] =
    useState<WalletAvailability>("detecting");
  const connectingRef = useRef(false);
  const connectedRef = useRef(false);
  const manuallyDisconnectedRef = useRef(false);

  const detect = useCallback(() => {
    setAvailability(isEternlAvailable() ? "available" : "missing");
  }, []);

  const establishConnection = useCallback(async (silent = false) => {
    if (connectingRef.current) return;
    if (!isEternlAvailable()) {
      setAvailability("missing");
      if (connectedRef.current) {
        connectedRef.current = false;
        setConnection(null);
        setError(
          "Eternl is no longer available in this browser. Reopen or enable Eternl, then reconnect Baton.",
        );
      } else if (!silent) {
        setError(
          "Eternl was not detected. Install the extension or open Baton in Eternl's dApp browser, then try again.",
        );
      }
      return;
    }

    connectingRef.current = true;
    setConnecting(true);
    setAvailability("available");
    if (!silent) setError(null);
    try {
      const nextConnection = await connectEternl();
      connectedRef.current = true;
      setConnection(nextConnection);
      setError(null);
      manuallyDisconnectedRef.current = false;
    } catch (cause) {
      const connectionWasActive = connectedRef.current;
      connectedRef.current = false;
      setConnection(null);
      if (!silent || connectionWasActive) {
        setError(walletErrorMessage(cause, "Eternl connection failed."));
      }
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  }, []);

  const connect = useCallback(
    async () => establishConnection(false),
    [establishConnection],
  );

  const disconnect = useCallback(() => {
    manuallyDisconnectedRef.current = true;
    connectedRef.current = false;
    setConnection(null);
    setError(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const discover = async () => {
      if (cancelled) return;
      if (isEternlAvailable()) {
        setAvailability("available");
        if (
          !manuallyDisconnectedRef.current &&
          !connection &&
          await wasEternlAuthorized()
        ) {
          await establishConnection(true);
        }
        return;
      }

      setAvailability(
        Date.now() - startedAt < DETECTION_GRACE_MS
          ? "detecting"
          : "missing",
      );
      if (Date.now() - startedAt < LATE_INJECTION_WINDOW_MS) {
        timer = setTimeout(() => void discover(), 250);
      }
    };

    const rediscover = () => {
      if (cancelled) return;
      if (connection && !manuallyDisconnectedRef.current) {
        void establishConnection(true);
        return;
      }
      void discover();
    };

    void discover();
    window.addEventListener("focus", rediscover);
    window.addEventListener("cardano#initialized", rediscover);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", rediscover);
      window.removeEventListener("cardano#initialized", rediscover);
    };
  }, [connection, establishConnection]);

  const value = useMemo<WalletContextValue>(
    () => ({
      connection,
      connecting,
      error,
      available: availability === "available",
      availability,
      connect,
      disconnect,
      clearError,
      detect,
    }),
    [
      availability,
      clearError,
      connect,
      connecting,
      connection,
      detect,
      disconnect,
      error,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside Providers");
  return value;
}
