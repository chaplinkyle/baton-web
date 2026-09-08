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
import type {
  EternlConnection,
  WalletAvailability,
  WalletConnectionActivity,
  WalletIssueKind,
} from "@/lib/eternl";
import {
  connectEternl,
  isWalletAccountChangeError,
  isWalletNetworkError,
  isEternlAvailable,
  refreshEternlConnection,
  walletConnectionActionLabel,
  walletErrorMessage,
  wasEternlAuthorized,
} from "@/lib/eternl";

const DETECTION_GRACE_MS = 800;
const LATE_INJECTION_WINDOW_MS = 5_000;
const RECONNECT_SUPPRESSION_KEY = "baton:wallet-reconnect-suppressed:v1";
type ConnectionMode = "manual" | "restore" | "account-change";

type WalletIssue = {
  kind: WalletIssueKind;
  message: string;
};

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
  revalidating: boolean;
  connectionActivity: WalletConnectionActivity;
  error: string | null;
  issueKind: WalletIssueKind | null;
  available: boolean;
  availability: WalletAvailability;
  connectionActionLabel: string;
  connect: () => Promise<void>;
  cancelConnection: () => void;
  changeAccount: () => void;
  disconnect: () => void;
  clearError: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function Providers({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<EternlConnection | null>(null);
  const [connectionActivity, setConnectionActivity] =
    useState<WalletConnectionActivity>("idle");
  const [issue, setIssue] = useState<WalletIssue | null>(null);
  const [availability, setAvailability] =
    useState<WalletAvailability>("detecting");
  const [revalidating, setRevalidating] = useState(false);
  const connectingRef = useRef(false);
  const connectedRef = useRef(false);
  const operationVersionRef = useRef(0);
  const reconnectSuppressedRef = useRef(false);
  const reconnectPreferenceLoadedRef = useRef(false);

  const establishConnection = useCallback(
    async (mode: ConnectionMode = "manual") => {
      const silent = mode !== "manual";
      if (connectingRef.current) return;
      if (!isEternlAvailable()) {
        setAvailability("missing");
        if (connectedRef.current) {
          connectedRef.current = false;
          setConnection(null);
          setIssue({
            kind: "missing",
            message:
              "Eternl is no longer available in this browser. Reopen or enable Eternl, then reconnect Baton.",
          });
        } else if (!silent) {
          setIssue({
            kind: "missing",
            message:
              "Eternl was not detected. Install the extension or open Baton in Eternl's dApp browser, then try again.",
          });
        }
        return;
      }

      const operationVersion = ++operationVersionRef.current;
      connectingRef.current = true;
      setConnectionActivity(
        mode === "manual"
          ? "requesting"
          : mode === "account-change"
            ? "switching"
            : "restoring",
      );
      setAvailability("available");
      if (!silent) setIssue(null);
      try {
        const nextConnection = await connectEternl(() => {
          if (operationVersionRef.current === operationVersion) {
            setConnectionActivity("checking");
          }
        });
        if (operationVersionRef.current === operationVersion) {
          connectedRef.current = true;
          setConnection(nextConnection);
          setIssue(null);
          reconnectSuppressedRef.current = false;
          setReconnectSuppressed(false);
        }
      } catch (cause) {
        if (operationVersionRef.current !== operationVersion) return;
        const connectionWasActive = connectedRef.current;
        connectedRef.current = false;
        setConnection(null);
        if (!silent || connectionWasActive || mode === "account-change") {
          setIssue({
            kind: isWalletNetworkError(cause) ? "network" : "connection",
            message: walletErrorMessage(cause, "Eternl connection failed."),
          });
        }
      } finally {
        if (operationVersionRef.current === operationVersion) {
          connectingRef.current = false;
          setConnectionActivity("idle");
        }
      }
    },
    [],
  );

  const connect = useCallback(
    async () => establishConnection("manual"),
    [establishConnection],
  );

  const refreshConnection = useCallback(async (current: EternlConnection) => {
    if (connectingRef.current) return;
    if (!isEternlAvailable()) {
      operationVersionRef.current += 1;
      connectingRef.current = false;
      setRevalidating(false);
      setAvailability("missing");
      connectedRef.current = false;
      setConnection(null);
      setIssue({
        kind: "missing",
        message:
          "Eternl is no longer available in this browser. Reopen or enable Eternl, then reconnect Baton.",
      });
      return;
    }

    const operationVersion = ++operationVersionRef.current;
    let accountChanged = false;
    connectingRef.current = true;
    setRevalidating(true);
    setAvailability("available");
    try {
      const nextConnection = await refreshEternlConnection(current);
      if (operationVersionRef.current !== operationVersion) return;
      connectedRef.current = true;
      setIssue(null);
      // A successful refresh starts a new wallet session even when the
      // account identity is unchanged. UTxOs, balances, and transaction
      // validity can change while Baton is in the background; replacing the
      // object invalidates every review and asset selection bound to the old
      // session by reference.
      setConnection(nextConnection);
    } catch (cause) {
      if (operationVersionRef.current !== operationVersion) return;
      if (isWalletAccountChangeError(cause)) {
        connectedRef.current = false;
        setConnection(null);
        setIssue(null);
        accountChanged = true;
      } else {
        // The connection -> null transition reruns the discovery effect. Keep
        // it from immediately calling enable() again after a failed background
        // refresh; the visible Try again action is the next authority boundary.
        reconnectSuppressedRef.current = true;
        connectedRef.current = false;
        setConnection(null);
        setIssue({
          kind: isWalletNetworkError(cause) ? "network" : "refresh",
          message: walletErrorMessage(
            cause,
            "Baton could not refresh the selected Eternl account.",
          ),
        });
      }
    } finally {
      if (operationVersionRef.current === operationVersion) {
        connectingRef.current = false;
        setRevalidating(false);
      }
    }
    if (accountChanged && operationVersionRef.current === operationVersion) {
      await establishConnection("account-change");
    }
  }, [establishConnection]);

  const disconnect = useCallback(() => {
    operationVersionRef.current += 1;
    connectingRef.current = false;
    setRevalidating(false);
    reconnectSuppressedRef.current = true;
    connectedRef.current = false;
    setConnectionActivity("idle");
    setConnection(null);
    setIssue(null);
    setReconnectSuppressed(true);
  }, []);

  const cancelConnection = useCallback(() => {
    operationVersionRef.current += 1;
    connectingRef.current = false;
    setRevalidating(false);
    reconnectSuppressedRef.current = true;
    connectedRef.current = false;
    setConnectionActivity("idle");
    setConnection(null);
    setIssue(null);
    setReconnectSuppressed(true);
  }, []);

  const changeAccount = useCallback(() => {
    operationVersionRef.current += 1;
    connectingRef.current = false;
    setRevalidating(false);
    reconnectSuppressedRef.current = true;
    connectedRef.current = false;
    setConnectionActivity("idle");
    setConnection(null);
    setIssue({
      kind: "account",
      message:
        "Open Eternl, select the account you want Baton to use, then return here and reconnect. If Eternl keeps restoring the previous account, disable Forced DApp Account for Baton in Eternl first.",
    });
    setReconnectSuppressed(true);
  }, []);

  const clearError = useCallback(() => setIssue(null), []);

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
        setIssue((current) => current?.kind === "missing" ? null : current);
        const authorized =
          !reconnectSuppressedRef.current &&
          !connection &&
          await wasEternlAuthorized();
        if (
          !cancelled &&
          !reconnectSuppressedRef.current &&
          !connectedRef.current &&
          authorized
        ) {
          await establishConnection("restore");
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
    const rediscoverWhenVisible = () => {
      if (document.visibilityState === "visible") rediscover();
    };

    void discover();
    window.addEventListener("focus", rediscover);
    window.addEventListener("pageshow", rediscover);
    document.addEventListener("visibilitychange", rediscoverWhenVisible);
    window.addEventListener("cardano#initialized", rediscover);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", rediscover);
      window.removeEventListener("pageshow", rediscover);
      document.removeEventListener("visibilitychange", rediscoverWhenVisible);
      window.removeEventListener("cardano#initialized", rediscover);
    };
  }, [connection, establishConnection, refreshConnection]);

  const value = useMemo<WalletContextValue>(
    () => ({
      connection,
      connecting: connectionActivity !== "idle" || revalidating,
      revalidating,
      connectionActivity,
      error: issue?.message ?? null,
      issueKind: issue?.kind ?? null,
      available: availability === "available",
      availability,
      connectionActionLabel: walletConnectionActionLabel(
        connectionActivity,
        availability,
      ),
      connect,
      cancelConnection,
      changeAccount,
      disconnect,
      clearError,
    }),
    [
      availability,
      clearError,
      cancelConnection,
      changeAccount,
      connect,
      connection,
      connectionActivity,
      disconnect,
      issue,
      revalidating,
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
