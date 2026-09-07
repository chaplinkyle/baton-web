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
  refreshEternlConnection,
  walletErrorMessage,
  wasEternlAuthorized,
} from "@/lib/eternl";

export type WalletAvailability = "detecting" | "available" | "missing";
export type WalletConnectionActivity = "idle" | "restoring" | "requesting";

const DETECTION_GRACE_MS = 800;
const LATE_INJECTION_WINDOW_MS = 5_000;
const RECONNECT_SUPPRESSION_KEY = "baton:wallet-reconnect-suppressed:v1";

function reconnectSuppressed() {
  try {
    return window.localStorage.getItem(RECONNECT_SUPPRESSION_KEY) === "true";
  } catch {
    return false;
  }
}

function setReconnectSuppressed(suppressed: boolean) {
  try {
    if (suppressed) {
      window.localStorage.setItem(RECONNECT_SUPPRESSION_KEY, "true");
    } else {
      window.localStorage.removeItem(RECONNECT_SUPPRESSION_KEY);
    }
  } catch {
    // Storage can be unavailable in hardened or private browser contexts. The
    // in-memory flag still preserves the choice for the current page session.
  }
}

type WalletContextValue = {
  connection: EternlConnection | null;
  connecting: boolean;
  connectionActivity: WalletConnectionActivity;
  error: string | null;
  available: boolean;
  availability: WalletAvailability;
  connect: () => Promise<void>;
  disconnect: () => void;
  clearError: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function Providers({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<EternlConnection | null>(null);
  const [connectionActivity, setConnectionActivity] =
    useState<WalletConnectionActivity>("idle");
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] =
    useState<WalletAvailability>("detecting");
  const connectingRef = useRef(false);
  const connectedRef = useRef(false);
  const reconnectSuppressedRef = useRef(false);
  const reconnectPreferenceLoadedRef = useRef(false);

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
    setConnectionActivity(silent ? "restoring" : "requesting");
    setAvailability("available");
    if (!silent) setError(null);
    try {
      const nextConnection = await connectEternl();
      connectedRef.current = true;
      setConnection(nextConnection);
      setError(null);
      reconnectSuppressedRef.current = false;
      setReconnectSuppressed(false);
    } catch (cause) {
      const connectionWasActive = connectedRef.current;
      connectedRef.current = false;
      setConnection(null);
      if (!silent || connectionWasActive) {
        setError(walletErrorMessage(cause, "Eternl connection failed."));
      }
    } finally {
      connectingRef.current = false;
      setConnectionActivity("idle");
    }
  }, []);

  const connect = useCallback(
    async () => establishConnection(false),
    [establishConnection],
  );

  const refreshConnection = useCallback(async (current: EternlConnection) => {
    if (connectingRef.current) return;
    if (!isEternlAvailable()) {
      setAvailability("missing");
      connectedRef.current = false;
      setConnection(null);
      setError(
        "Eternl is no longer available in this browser. Reopen or enable Eternl, then reconnect Baton.",
      );
      return;
    }

    connectingRef.current = true;
    setAvailability("available");
    try {
      const nextConnection = await refreshEternlConnection(current);
      connectedRef.current = true;
      setError(null);
      if (
        nextConnection.address !== current.address ||
        nextConnection.networkId !== current.networkId ||
        nextConnection.paymentKeyHash !== current.paymentKeyHash
      ) {
        setConnection(nextConnection);
      }
    } catch (cause) {
      // The connection -> null transition reruns the discovery effect. Keep it
      // from immediately calling enable() again after a failed background
      // refresh; the visible Try again action is the next authority boundary.
      reconnectSuppressedRef.current = true;
      connectedRef.current = false;
      setConnection(null);
      setError(
        walletErrorMessage(
          cause,
          "Baton could not refresh the selected Eternl account.",
        ),
      );
    } finally {
      connectingRef.current = false;
    }
  }, []);

  const disconnect = useCallback(() => {
    reconnectSuppressedRef.current = true;
    connectedRef.current = false;
    setConnection(null);
    setError(null);
    setReconnectSuppressed(true);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    if (!reconnectPreferenceLoadedRef.current) {
      reconnectSuppressedRef.current = reconnectSuppressed();
      reconnectPreferenceLoadedRef.current = true;
    }

    const discover = async () => {
      if (cancelled) return;
      if (isEternlAvailable()) {
        setAvailability("available");
        if (
          !reconnectSuppressedRef.current &&
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
      if (connection && !reconnectSuppressedRef.current) {
        void refreshConnection(connection);
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
  }, [connection, establishConnection, refreshConnection]);

  const value = useMemo<WalletContextValue>(
    () => ({
      connection,
      connecting: connectionActivity !== "idle",
      connectionActivity,
      error,
      available: availability === "available",
      availability,
      connect,
      disconnect,
      clearError,
    }),
    [
      availability,
      clearError,
      connect,
      connection,
      connectionActivity,
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
