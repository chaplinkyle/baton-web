import type { LucidEvolution, WalletApi } from "@lucid-evolution/lucid";
import { Buffer } from "buffer";
import {
  CARDANO_NETWORK,
  EXPECTED_NETWORK_ID,
  KOIOS_URL,
} from "./config";

const APPROVAL_TIMEOUT_MS = 45_000;
const READ_TIMEOUT_MS = 12_000;

type EternlProvider = Window["cardano"][string];
type Cip30Error = { code?: unknown; info?: unknown; message?: unknown };

export type EternlConnection = {
  api: WalletApi;
  lucid: LucidEvolution;
  address: string;
  paymentKeyHash: string;
  networkId: number;
  walletName: string;
  apiVersion: string;
};

export class WalletRequestTimeoutError extends Error {
  constructor(operation: string) {
    super(`${operation} timed out.`);
    this.name = "WalletRequestTimeoutError";
  }
}

export function withWalletTimeout<T>(
  request: Promise<T>,
  operation: string,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new WalletRequestTimeoutError(operation)),
      timeoutMs,
    );
    request.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function errorDetails(cause: unknown) {
  if (!cause || typeof cause !== "object") return {};
  const error = cause as Cip30Error;
  const code = typeof error.code === "number" ? error.code : undefined;
  const detail = typeof error.info === "string"
    ? error.info
    : typeof error.message === "string"
      ? error.message
      : "";
  return { code, detail };
}

export function walletErrorMessage(
  cause: unknown,
  fallback = "Eternl could not complete that request.",
  request: "connection" | "transaction" = "connection",
) {
  if (cause instanceof WalletRequestTimeoutError) {
    return "Eternl did not respond. Open the extension, finish or dismiss any pending request, and try again.";
  }

  const { code, detail } = errorDetails(cause);
  const normalized = (detail ?? "").toLowerCase();

  if (
    code === -3 ||
    code === 2 ||
    normalized.includes("cancel") ||
    normalized.includes("declin") ||
    normalized.includes("refus") ||
    normalized.includes("denied")
  ) {
    return request === "transaction"
      ? "The transaction was canceled in Eternl. Nothing was signed or submitted. Try again when you are ready."
      : "Connection was not approved in Eternl. Open Eternl, select your Preprod account, approve this site, and try again.";
  }

  if (code === -4 || normalized.includes("account change")) {
    return "The Eternl account changed. Reconnect Baton to the account you want to use.";
  }

  if (normalized.includes("network")) {
    return detail ?? fallback;
  }

  return detail?.trim() || fallback;
}

export function getEternlProvider(): EternlProvider | null {
  if (typeof window === "undefined") return null;
  return window.cardano?.eternl ?? null;
}

export function isEternlAvailable() {
  return Boolean(getEternlProvider());
}

export function cardanoBrowseUri(url: string) {
  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("A wallet-app link requires an HTTP or HTTPS Baton URL.");
  }
  return `web+cardano://browse/v1?uri=${encodeURIComponent(target.href)}`;
}

export async function wasEternlAuthorized() {
  const provider = getEternlProvider();
  if (!provider) return false;
  try {
    return await withWalletTimeout(
      provider.isEnabled(),
      "Checking Eternl access",
      4_000,
    );
  } catch {
    return false;
  }
}

export async function connectEternl(): Promise<EternlConnection> {
  const browserGlobals = globalThis as typeof globalThis & {
    Buffer?: typeof Buffer;
  };
  browserGlobals.Buffer ??= Buffer;

  const provider = getEternlProvider();
  if (!provider) {
    throw new Error(
      "Eternl was not detected. Install the Eternl extension or open Baton in Eternl's dApp browser.",
    );
  }

  const api = await withWalletTimeout(
    provider.enable(),
    "Eternl approval",
    APPROVAL_TIMEOUT_MS,
  );
  const networkId = await withWalletTimeout(
    api.getNetworkId(),
    "Reading the Eternl network",
    READ_TIMEOUT_MS,
  );
  if (networkId !== EXPECTED_NETWORK_ID) {
    throw new Error(
      `Eternl is connected to network ID ${networkId}; this release requires ${CARDANO_NETWORK}. Switch networks in Eternl and reconnect.`,
    );
  }

  const { getAddressDetails, Koios, Lucid } = await import(
    "@lucid-evolution/lucid"
  );
  const lucid = await Lucid(new Koios(KOIOS_URL), CARDANO_NETWORK);
  lucid.selectWallet.fromAPI(api);
  const address = await withWalletTimeout(
    lucid.wallet().address(),
    "Reading the Eternl account",
    READ_TIMEOUT_MS,
  );
  const paymentCredential = getAddressDetails(address).paymentCredential;
  if (!paymentCredential || paymentCredential.type !== "Key") {
    throw new Error(
      "The selected Eternl account does not use a supported key payment credential.",
    );
  }

  return {
    api,
    lucid,
    address,
    paymentKeyHash: paymentCredential.hash,
    networkId,
    walletName: provider.name || "Eternl",
    apiVersion: provider.apiVersion || "CIP-30",
  };
}
