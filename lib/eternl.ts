import type { LucidEvolution, WalletApi } from "@lucid-evolution/lucid";
import { Buffer } from "buffer";
import {
  cardanoErrorMessage,
  isRetryableCardanoReadError,
  withCardanoReadRetry,
} from "./cardano-errors";
import {
  CARDANO_NETWORK,
  EXPECTED_NETWORK_MAGIC,
  EXPECTED_NETWORK_ID,
  KOIOS_URL,
} from "./config";

const APPROVAL_TIMEOUT_MS = 45_000;
const READ_TIMEOUT_MS = 12_000;
const ADDRESS_DISCOVERY_TIMEOUT_MS = 4_000;
export const MIN_WALLET_APPROVAL_WINDOW_MS = 60_000;
// A single matching out-ref proves the configured chain. Cap the query to
// avoid disclosing an account's complete UTxO set to the public indexer.
const NETWORK_PROOF_UTXO_LIMIT = 5;

export type WalletAvailability = "detecting" | "available" | "missing";
export type WalletIssueKind =
  | "missing"
  | "connection"
  | "network"
  | "account"
  | "refresh";
export type WalletConnectionActivity =
  | "idle"
  | "restoring"
  | "requesting"
  | "checking"
  | "switching";

type Cip30Extension = { cip: number };
type EternlWalletApi = WalletApi & {
  getExtensions?: () => Promise<Cip30Extension[]>;
  cip142?: { getNetworkMagic?: () => Promise<number> };
};
type EternlProvider = Omit<Window["cardano"][string], "enable"> & {
  supportedExtensions?: Cip30Extension[];
  enable(options?: { extensions: Cip30Extension[] }): Promise<EternlWalletApi>;
};
type Cip30Error = { code?: unknown; info?: unknown; message?: unknown };

export type EternlConnection = {
  api: EternlWalletApi;
  lucid: LucidEvolution;
  address: string;
  paymentKeyHash: string;
  paymentKeyHashes: string[];
  networkId: number;
  networkMagic: number | null;
  walletName: string;
  apiVersion: string;
};

export function isExactWalletNetwork(
  connection: Pick<EternlConnection, "networkId" | "networkMagic">,
) {
  return CARDANO_NETWORK === "Mainnet"
    ? connection.networkId === EXPECTED_NETWORK_ID
    : connection.networkMagic === EXPECTED_NETWORK_MAGIC;
}

export function isWalletSessionReady(
  connection: EternlConnection | null,
  revalidating: boolean,
) {
  return connection !== null &&
    !revalidating &&
    isExactWalletNetwork(connection);
}

export function walletIdentityKey(
  connection: Pick<
    EternlConnection,
    "address" | "networkId" | "networkMagic" | "paymentKeyHash" | "paymentKeyHashes"
  >,
) {
  const credentials = connection.paymentKeyHashes ?? [connection.paymentKeyHash];
  return [
    connection.networkId,
    connection.networkMagic ?? "unknown",
    connection.address,
    ...credentials,
  ].join(":");
}

/**
 * Keep wallet-derived state bound to the exact authorized wallet session that
 * produced it. This covers unsigned transactions as well as account assets.
 * Address equality is intentionally insufficient: a user can switch away and
 * later return to the same account after inputs, balances, or validity windows
 * have become stale.
 */
export function reviewForWalletSession<T>(
  review: T | null,
  preparedWith: EternlConnection | null,
  current: EternlConnection | null,
) {
  return preparedWith !== null && preparedWith === current ? review : null;
}

/**
 * Bind read-only results to one exact wallet session. Unlike a transaction
 * review, a disconnected browser is also a valid session because it can show
 * plans saved on that device.
 */
export function resultForWalletSession<T>(
  result: T | null,
  producedWith: EternlConnection | null | undefined,
  current: EternlConnection | null,
) {
  return result !== null && producedWith !== undefined && producedWith === current
    ? result
    : null;
}

export function walletReviewNeedsRefresh(
  validTo: number,
  now = Date.now(),
  minimumRemainingMs = MIN_WALLET_APPROVAL_WINDOW_MS,
) {
  return !Number.isSafeInteger(validTo) ||
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(minimumRemainingMs) ||
    minimumRemainingMs < 0 ||
    validTo - now <= minimumRemainingMs;
}

export class WalletRequestTimeoutError extends Error {
  constructor(operation: string) {
    super(`${operation} timed out.`);
    this.name = "WalletRequestTimeoutError";
  }
}

export function walletConnectionActionLabel(
  activity: WalletConnectionActivity,
  availability: WalletAvailability,
) {
  if (activity === "requesting") return "Approve in Eternl";
  if (activity === "restoring") return "Restoring Eternl…";
  if (activity === "checking") return "Checking wallet…";
  if (activity === "switching") return "Updating account…";
  if (availability === "detecting") return "Finding Eternl…";
  if (availability === "available") return "Connect Eternl";
  return "Set up Eternl";
}

export function walletIssuePresentation(kind: WalletIssueKind | null) {
  if (kind === "account") {
    return {
      label: "Choose another account",
      title: "Switch accounts in Eternl",
      action: "Connect selected account",
    };
  }

  if (kind === "network") {
    return {
      label: "Wrong Cardano network",
      title: "Switch Eternl to Preprod",
      action: "Try Preprod again",
    };
  }

  if (kind === "refresh") {
    return {
      label: "Wallet session changed",
      title: "Reconnect to continue",
      action: "Reconnect Eternl",
    };
  }

  return {
    label: "Connection needs attention",
    title: "Eternl did not connect",
    action: "Try again",
  };
}

export function isWalletNetworkError(cause: unknown) {
  const { detail } = errorDetails(cause);
  return /network (?:id|magic|mismatch)|requires preprod|switch networks?/i.test(
    detail ?? "",
  );
}

export function shouldOfferWalletAppHandoff(environment: {
  userAgent: string;
  maxTouchPoints?: number;
}) {
  const userAgent = environment.userAgent.toLowerCase();
  return /android|iphone|ipad|ipod|mobile/.test(userAgent) ||
    (userAgent.includes("macintosh") && (environment.maxTouchPoints ?? 0) > 1);
}

export function walletSetupPresentation(mobile: boolean) {
  return mobile
    ? {
        title: "Open Baton inside Eternl",
        message:
          "This Baton release connects through Eternl. Open its built-in dApp browser, choose Eternl if your device asks, then select Cardano Preprod.",
        primaryAction: "Open Baton in Eternl",
        secondaryAction: "Get Eternl",
      }
    : {
        title: "Enable the Eternl extension",
        message:
          "Install or enable Eternl in this browser, select Cardano Preprod, then reload Baton.",
        primaryAction: "Install Eternl",
        secondaryAction: "Reload Baton",
      };
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

export function isWalletAccountChangeError(cause: unknown) {
  const { code, detail } = errorDetails(cause);
  return code === -4 || /account(?: has)? changed?/i.test(detail ?? "");
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

  if (isRetryableCardanoReadError(cause)) {
    return cardanoErrorMessage(cause, fallback);
  }

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
      : "Connection was not approved in Eternl. Open Eternl, select your Preprod account, and approve Baton. If no approval window appears, remove Baton from Eternl's DApp Allowlist, reload this page, and try again.";
  }

  if (isWalletAccountChangeError(cause)) {
    return "The Eternl account changed. Baton stopped using the previous account. Reopen Eternl and try again. If it keeps selecting another account, disable Forced DApp Account for Baton in Eternl.";
  }

  if (normalized.includes("network")) {
    return detail ?? fallback;
  }

  if (
    /cannot read propert(?:y|ies)|undefined is not|null is not|is not a function|reading ['"]/i.test(
      detail ?? "",
    )
  ) {
    return fallback;
  }

  return detail?.trim() || fallback;
}

export function getEternlProvider(): EternlProvider | null {
  if (typeof window === "undefined") return null;
  return selectEternlProvider(window.cardano);
}

function isCip30Provider(value: unknown): value is EternlProvider {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EternlProvider>;
  return typeof candidate.enable === "function" &&
    typeof candidate.isEnabled === "function";
}

/**
 * Prefer Eternl's current CIP-30 namespace, while retaining compatibility
 * with installations that expose only the wallet's historical `ccvault`
 * alias. Validate the bridge before treating either injected value as a
 * wallet so another extension cannot leave Baton stuck on a malformed entry.
 */
export function selectEternlProvider(cardano: unknown): EternlProvider | null {
  if (!cardano || typeof cardano !== "object") return null;
  const registry = cardano as Record<string, unknown>;
  if (isCip30Provider(registry.eternl)) return registry.eternl;
  if (isCip30Provider(registry.ccvault)) return registry.ccvault;
  return null;
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

function hasExtension(extensions: Cip30Extension[] | undefined, cip: number) {
  return Boolean(extensions?.some((extension) => extension.cip === cip));
}

async function readNetworkMagic(api: EternlWalletApi) {
  if (!api.cip142?.getNetworkMagic) return null;

  if (api.getExtensions) {
    const enabled = await withWalletTimeout(
      api.getExtensions(),
      "Reading Eternl extensions",
      READ_TIMEOUT_MS,
    );
    if (!hasExtension(enabled, 142)) return null;
  }

  return withWalletTimeout(
    api.cip142.getNetworkMagic(),
    "Reading the Eternl network",
    READ_TIMEOUT_MS,
  );
}

async function proveConfiguredNetworkFromWalletUtxo(lucid: LucidEvolution) {
  const walletUtxos = await withWalletTimeout(
    lucid.wallet().getUtxos(),
    "Reading Eternl UTxOs for network confirmation",
    READ_TIMEOUT_MS,
  );
  const candidates = walletUtxos.slice(0, NETWORK_PROOF_UTXO_LIMIT);
  // Older CIP-30 bridges expose only the shared testnet network ID. An empty
  // account therefore cannot prove Preprod versus Preview yet. Keep the
  // account connected in a read-only, unverified state so Baton can show its
  // address and faucet guidance; isWalletSessionReady continues to block all
  // transaction preparation until a confirmed Preprod UTxO supplies proof.
  if (candidates.length === 0) return null;

  const provider = lucid.config().provider;
  if (!provider) {
    throw new Error(
      `Baton could not prove that this account is on ${CARDANO_NETWORK}. This release requires ${CARDANO_NETWORK}; update Eternl, then reconnect.`,
    );
  }

  const confirmed = await withCardanoReadRetry(
    () => provider.getUtxosByOutRef(candidates.map(({ txHash, outputIndex }) => ({
      txHash,
      outputIndex,
    }))),
    3,
  );
  const confirmedReferences = new Set(
    confirmed.map(({ txHash, outputIndex }) => `${txHash}#${outputIndex}`),
  );
  if (!candidates.some(
    ({ txHash, outputIndex }) => confirmedReferences.has(`${txHash}#${outputIndex}`),
  )) {
    throw new Error(
      `Baton could not match this account to a confirmed UTxO on ${CARDANO_NETWORK}. This release requires ${CARDANO_NETWORK}; wait for test funds to confirm or switch Eternl to that network, then reconnect.`,
    );
  }
  return EXPECTED_NETWORK_MAGIC;
}

async function readWalletIdentity(api: EternlWalletApi, lucid: LucidEvolution) {
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

  let networkMagic = await readNetworkMagic(api);
  if (networkMagic !== null && networkMagic !== EXPECTED_NETWORK_MAGIC) {
    throw new Error(
      `Eternl is connected to network magic ${networkMagic}; this release requires ${CARDANO_NETWORK} (network magic ${EXPECTED_NETWORK_MAGIC}). Switch networks in Eternl and reconnect.`,
    );
  }
  if (networkMagic === null && CARDANO_NETWORK !== "Mainnet") {
    networkMagic = await proveConfiguredNetworkFromWalletUtxo(lucid);
  }

  const address = await withWalletTimeout(
    lucid.wallet().address(),
    "Reading the Eternl account",
    READ_TIMEOUT_MS,
  );
  const { CML, getAddressDetails } = await import("@lucid-evolution/lucid");
  const paymentCredential = getAddressDetails(address).paymentCredential;
  if (!paymentCredential || paymentCredential.type !== "Key") {
    throw new Error(
      "The selected Eternl account does not use a supported key payment credential.",
    );
  }

  // One CIP-30 account can expose several HD payment addresses. Plans made
  // with an older address still belong to the selected Eternl account, so
  // discovery and role checks must not stop at the current change address.
  // The confirmed current address remains the fallback for wallet versions
  // that omit or fail these optional reads.
  const addressRequests = [
    typeof api.getUsedAddresses === "function"
      ? withWalletTimeout(
          api.getUsedAddresses(),
          "Reading used Eternl addresses",
          ADDRESS_DISCOVERY_TIMEOUT_MS,
        )
      : Promise.resolve([]),
    typeof api.getUnusedAddresses === "function"
      ? withWalletTimeout(
          api.getUnusedAddresses(),
          "Reading unused Eternl addresses",
          ADDRESS_DISCOVERY_TIMEOUT_MS,
        )
      : Promise.resolve([]),
  ];
  const addressResults = await Promise.allSettled(addressRequests);
  const paymentKeyHashes = new Set([paymentCredential.hash]);
  for (const result of addressResults) {
    if (result.status !== "fulfilled" || !Array.isArray(result.value)) continue;
    for (const encodedAddress of result.value.slice(0, 500)) {
      if (typeof encodedAddress !== "string") continue;
      let decodedAddress: ReturnType<typeof CML.Address.from_hex> | null = null;
      try {
        decodedAddress = CML.Address.from_hex(encodedAddress);
        const details = getAddressDetails(decodedAddress.to_bech32());
        if (details.networkId !== EXPECTED_NETWORK_ID) continue;
        const credential = details.paymentCredential;
        if (credential?.type === "Key") paymentKeyHashes.add(credential.hash);
      } catch {
        // Ignore malformed or unsupported provider entries. The primary
        // address above has already passed full network and key validation.
      } finally {
        decodedAddress?.free();
      }
    }
  }

  return {
    address,
    networkId,
    networkMagic,
    paymentKeyHash: paymentCredential.hash,
    paymentKeyHashes: [...paymentKeyHashes].sort(),
  };
}

/** Re-read the authorized CIP-30 session without opening another approval. */
export async function refreshEternlConnection(
  connection: EternlConnection,
): Promise<EternlConnection> {
  return {
    ...connection,
    ...await readWalletIdentity(connection.api, connection.lucid),
  };
}

export async function connectEternl(onApproved?: () => void): Promise<EternlConnection> {
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

  const supportsExactNetwork = hasExtension(provider.supportedExtensions, 142);
  const api = await withWalletTimeout(
    supportsExactNetwork
      ? provider.enable({ extensions: [{ cip: 142 }] })
      : provider.enable(),
    "Eternl approval",
    APPROVAL_TIMEOUT_MS,
  );
  onApproved?.();

  const { Koios, Lucid } = await import(
    "@lucid-evolution/lucid"
  );
  const lucid = await withCardanoReadRetry(
    () => Lucid(new Koios(KOIOS_URL), CARDANO_NETWORK),
  );
  lucid.selectWallet.fromAPI(api);
  const identity = await readWalletIdentity(api, lucid);

  return {
    api,
    lucid,
    ...identity,
    walletName: provider.name || "Eternl",
    apiVersion: provider.apiVersion || "CIP-30",
  };
}
