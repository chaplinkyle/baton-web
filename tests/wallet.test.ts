import assert from "node:assert/strict";
import test from "node:test";
import {
  cardanoBrowseUri,
  type EternlConnection,
  isExactWalletNetwork,
  isWalletAccountChangeError,
  isWalletNetworkError,
  isWalletSessionReady,
  MIN_WALLET_APPROVAL_WINDOW_MS,
  refreshEternlConnection,
  resultForWalletSession,
  reviewForWalletSession,
  selectEternlProvider,
  shouldOfferWalletAppHandoff,
  walletAddressSearchDescription,
  WalletInteractionGate,
  WalletRequestTimeoutError,
  walletConnectionActionLabel,
  walletErrorMessage,
  walletIdentityKey,
  walletIssuePresentation,
  walletReviewNeedsRefresh,
  walletReviewSessionChanged,
  walletSetupPresentation,
  withWalletTimeout,
} from "../lib/eternl";
import { CML } from "@lucid-evolution/lucid";

const OWNER_ADDRESS = "addr_test1qztr0p45temrsjcy6z4dpfardnruyftylxj077c6rrket3sjrc6lv8zv5re7krwmg06djl866jl3ygd9zea2cv0aydtq6fqvee";
const CHECK_IN_ADDRESS = "addr_test1vptypkdle25xnm2ntne4vsg8jwpe064wkuj9kafqnqx4zysclztwf";
const NETWORK_PROOF_OUT_REF = {
  txHash: "ab".repeat(32),
  outputIndex: 0,
};

test("wallet discovery prefers Eternl and supports its legacy ccvault alias", () => {
  const current = {
    enable: async () => ({}),
    isEnabled: async () => true,
    name: "Eternl",
  };
  const legacy = {
    enable: async () => ({}),
    isEnabled: async () => true,
    name: "ccvault",
  };

  assert.equal(selectEternlProvider({ eternl: current, ccvault: legacy }), current);
  assert.equal(selectEternlProvider({ ccvault: legacy }), legacy);
  assert.equal(selectEternlProvider({ eternl: {}, ccvault: legacy }), legacy);
  assert.equal(selectEternlProvider({ eternl: {} }), null);
  assert.equal(selectEternlProvider(undefined), null);
});

test("wallet actions describe every discovery and connection state consistently", () => {
  assert.equal(walletConnectionActionLabel("idle", "detecting"), "Finding Eternl…");
  assert.equal(walletConnectionActionLabel("idle", "missing"), "Set up Eternl");
  assert.equal(walletConnectionActionLabel("idle", "available"), "Connect Eternl");
  assert.equal(walletConnectionActionLabel("requesting", "available"), "Approve in Eternl");
  assert.equal(walletConnectionActionLabel("restoring", "available"), "Restoring Eternl…");
  assert.equal(walletConnectionActionLabel("checking", "available"), "Checking wallet…");
  assert.equal(walletConnectionActionLabel("switching", "available"), "Updating account…");
});

test("wallet recovery copy distinguishes a failed connection from a changed session", () => {
  assert.deepEqual(walletIssuePresentation("connection"), {
    label: "Connection needs attention",
    title: "Eternl did not connect",
    action: "Try again",
  });
  assert.deepEqual(walletIssuePresentation("refresh"), {
    label: "Wallet session changed",
    title: "Reconnect to continue",
    action: "Reconnect Eternl",
  });
  assert.deepEqual(walletIssuePresentation("network"), {
    label: "Wrong Cardano network",
    title: "Switch Eternl to Preprod",
    action: "Try Preprod again",
  });
  assert.deepEqual(walletIssuePresentation("account"), {
    label: "Choose another account",
    title: "Switch accounts in Eternl",
    action: "Connect selected account",
  });
});

test("wallet network failures are classified without confusing user cancellations", () => {
  assert.equal(isWalletNetworkError(new Error(
    "Eternl is connected to network magic 2; this release requires Preprod.",
  )), true);
  assert.equal(isWalletNetworkError({ message: "Network mismatch: switch to Preprod" }), true);
  assert.equal(isWalletNetworkError({ info: "User canceled connection" }), false);
});

test("wallet setup guidance matches the browser environment", () => {
  assert.deepEqual(walletSetupPresentation(true), {
    title: "Open Baton inside Eternl",
    message:
      "This Baton release connects through Eternl. Open its built-in dApp browser, choose Eternl if your device asks, then select Cardano Preprod.",
    primaryAction: "Open Baton in Eternl",
    secondaryAction: "Get Eternl",
  });
  assert.deepEqual(walletSetupPresentation(false), {
    title: "Enable the Eternl extension",
    message:
      "Install or enable Eternl in this browser, select Cardano Preprod, then reload Baton.",
    primaryAction: "Install Eternl",
    secondaryAction: "Reload Baton",
  });
});

test("connected-wallet discovery copy is natural for one or many addresses", () => {
  assert.equal(
    walletAddressSearchDescription(1),
    "the address Eternl provided",
  );
  assert.equal(
    walletAddressSearchDescription(4),
    "all 4 addresses Eternl provided",
  );
});

test("wallet-app handoff follows the device rather than the viewport", () => {
  assert.equal(shouldOfferWalletAppHandoff({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro)",
    maxTouchPoints: 5,
  }), true);
  assert.equal(shouldOfferWalletAppHandoff({
    userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
    maxTouchPoints: 5,
  }), true);
  assert.equal(shouldOfferWalletAppHandoff({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    maxTouchPoints: 5,
  }), true);
  assert.equal(shouldOfferWalletAppHandoff({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    maxTouchPoints: 10,
  }), false);
});

test("wallet-app links follow CIP-158 and preserve the complete Baton URL", () => {
  assert.equal(
    cardanoBrowseUri("https://baton-cardano.vercel.app/vault/abc?view=full#status"),
    "web+cardano://browse/v1?uri=https%3A%2F%2Fbaton-cardano.vercel.app%2Fvault%2Fabc%3Fview%3Dfull%23status",
  );
  assert.throws(
    () => cardanoBrowseUri("javascript:alert(1)"),
    /HTTP or HTTPS/i,
  );
});

test("wallet identity changes when Eternl exposes a different address set", () => {
  const base = {
    address: OWNER_ADDRESS,
    paymentKeyHash: "963786b45e76384b04d0aad0a7a36cc7c22564f9a4ff7b1a18ed95c6",
    paymentKeyHashes: [
      "963786b45e76384b04d0aad0a7a36cc7c22564f9a4ff7b1a18ed95c6",
    ],
    networkId: 0,
    networkMagic: 1,
  };
  assert.notEqual(
    walletIdentityKey(base),
    walletIdentityKey({
      ...base,
      paymentKeyHashes: [...base.paymentKeyHashes, "11".repeat(28)],
    }),
  );
});

test("wallet requests return successful results", async () => {
  assert.equal(
    await withWalletTimeout(Promise.resolve("connected"), "Connecting", 25),
    "connected",
  );
});

test("wallet interaction gate covers overlapping requests and always reopens", async () => {
  const gate = new WalletInteractionGate();
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const first = gate.run(() => new Promise<void>((resolve) => {
    releaseFirst = resolve;
  }));
  const second = gate.run(() => new Promise<void>((resolve) => {
    releaseSecond = resolve;
  }));

  assert.equal(gate.active, true);
  releaseFirst();
  await first;
  assert.equal(gate.active, true);
  releaseSecond();
  await second;
  assert.equal(gate.active, false);

  await assert.rejects(gate.run(async () => {
    throw new Error("Eternl request failed");
  }), /request failed/);
  assert.equal(gate.active, false);
});

test("wallet requests fail with an actionable timeout", async () => {
  await assert.rejects(
    withWalletTimeout(new Promise<never>(() => undefined), "Eternl approval", 5),
    WalletRequestTimeoutError,
  );
  assert.match(
    walletErrorMessage(new WalletRequestTimeoutError("Eternl approval")),
    /did not respond/i,
  );
});

test("Cardano provider timeouts never expose runtime internals as wallet errors", () => {
  const message = walletErrorMessage(new Error(
    "TimeoutException: Operation timed out after '10s' at Module.timeoutExceptionFromDuration\n" +
    "at http://localhost:3000/_next/static/chunks/node_modules_effect.js:1496:50",
  ));

  assert.match(message, /Cardano is taking longer than expected/i);
  assert.match(message, /nothing changed/i);
  assert.doesNotMatch(message, /TimeoutException|node_modules|https?:\/\//i);
});

test("an authorized wallet session refreshes its account without enable", async () => {
  let networkReads = 0;
  let addressReads = 0;
  let walletUtxoReads = 0;
  let providerUtxoReads = 0;
  const api = {
    getNetworkId: async () => {
      networkReads += 1;
      return 0;
    },
  };
  const lucid = {
    wallet: () => ({
      address: async () => {
        addressReads += 1;
        return CHECK_IN_ADDRESS;
      },
      getUtxos: async () => {
        walletUtxoReads += 1;
        return [NETWORK_PROOF_OUT_REF];
      },
    }),
    config: () => ({
      provider: {
        getUtxosByOutRef: async () => {
          providerUtxoReads += 1;
          return [NETWORK_PROOF_OUT_REF];
        },
      },
    }),
  };
  const connection = {
    api,
    lucid,
    address: OWNER_ADDRESS,
    paymentKeyHash: "963786b45e76384b04d0aad0a7a36cc7c22564f9a4ff7b1a18ed95c",
    networkId: 0,
    networkMagic: null,
    walletName: "Eternl",
    apiVersion: "1.0.0",
  } as unknown as EternlConnection;

  const refreshed = await refreshEternlConnection(connection);
  assert.equal(refreshed.address, CHECK_IN_ADDRESS);
  assert.equal(
    refreshed.paymentKeyHash,
    "5640d9bfcaa869ed535cf3564107938397eaaeb7245b7520980d5112",
  );
  assert.equal(refreshed.api, connection.api);
  assert.equal(refreshed.lucid, connection.lucid);
  assert.deepEqual(refreshed.paymentKeyHashes, [
    "5640d9bfcaa869ed535cf3564107938397eaaeb7245b7520980d5112",
  ]);
  assert.equal(networkReads, 1);
  assert.equal(addressReads, 1);
  assert.equal(walletUtxoReads, 1);
  assert.equal(providerUtxoReads, 1);
  assert.equal(refreshed.networkMagic, 1);
});

test("an Eternl account exposes every key payment credential for plan discovery", async () => {
  const toHex = (address: string) => {
    const decoded = CML.Address.from_bech32(address);
    try {
      return decoded.to_hex();
    } finally {
      decoded.free();
    }
  };
  const api = {
    getNetworkId: async () => 0,
    getUsedAddresses: async () => [toHex(OWNER_ADDRESS)],
    getUnusedAddresses: async () => [
      toHex(CHECK_IN_ADDRESS),
      "not-an-address",
    ],
  };
  const connection = {
    api,
    lucid: {
      wallet: () => ({
        address: async () => CHECK_IN_ADDRESS,
        getUtxos: async () => [NETWORK_PROOF_OUT_REF],
      }),
      config: () => ({
        provider: {
          getUtxosByOutRef: async () => [NETWORK_PROOF_OUT_REF],
        },
      }),
    },
    address: CHECK_IN_ADDRESS,
    paymentKeyHash: "5640d9bfcaa869ed535cf3564107938397eaaeb7245b7520980d5112",
    paymentKeyHashes: [
      "5640d9bfcaa869ed535cf3564107938397eaaeb7245b7520980d5112",
    ],
    networkId: 0,
    networkMagic: null,
    walletName: "Eternl",
    apiVersion: "1.0.0",
  } as unknown as EternlConnection;

  const refreshed = await refreshEternlConnection(connection);
  assert.deepEqual(refreshed.paymentKeyHashes, [
    "5640d9bfcaa869ed535cf3564107938397eaaeb7245b7520980d5112",
    "963786b45e76384b04d0aad0a7a36cc7c22564f9a4ff7b1a18ed95c6",
  ]);
  assert.equal(refreshed.networkMagic, 1);
});

test("an older testnet-only wallet must match a confirmed Preprod UTxO", async () => {
  const connection = {
    api: { getNetworkId: async () => 0 },
    lucid: {
      wallet: () => ({
        getUtxos: async () => [NETWORK_PROOF_OUT_REF],
        address: async () => OWNER_ADDRESS,
      }),
      config: () => ({
        provider: { getUtxosByOutRef: async () => [] },
      }),
    },
    address: OWNER_ADDRESS,
    paymentKeyHash: "963786b45e76384b04d0aad0a7a36cc7c22564f9a4ff7b1a18ed95c6",
    paymentKeyHashes: [
      "963786b45e76384b04d0aad0a7a36cc7c22564f9a4ff7b1a18ed95c6",
    ],
    networkId: 0,
    networkMagic: null,
    walletName: "Eternl",
    apiVersion: "1.0.0",
  } as unknown as EternlConnection;

  await assert.rejects(
    refreshEternlConnection(connection),
    /could not match.*confirmed UTxO on Preprod/i,
  );
});

test("an empty older testnet wallet connects in a transaction-locked state", async () => {
  const connection = {
    api: { getNetworkId: async () => 0 },
    lucid: {
      wallet: () => ({
        getUtxos: async () => [],
        address: async () => OWNER_ADDRESS,
      }),
      config: () => ({
        provider: { getUtxosByOutRef: async () => [] },
      }),
    },
    address: OWNER_ADDRESS,
    paymentKeyHash: "963786b45e76384b04d0aad0a7a36cc7c22564f9a4ff7b1a18ed95c6",
    paymentKeyHashes: [
      "963786b45e76384b04d0aad0a7a36cc7c22564f9a4ff7b1a18ed95c6",
    ],
    networkId: 0,
    networkMagic: null,
    walletName: "Eternl",
    apiVersion: "1.0.0",
  } as unknown as EternlConnection;

  const refreshed = await refreshEternlConnection(connection);
  assert.equal(refreshed.address, OWNER_ADDRESS);
  assert.equal(refreshed.networkMagic, null);
  assert.equal(isExactWalletNetwork(refreshed), false);
  assert.equal(isWalletSessionReady(refreshed, false), false);
});

test("an authorized wallet refresh still rejects the wrong network", async () => {
  const connection = {
    api: { getNetworkId: async () => 1 },
    lucid: { wallet: () => ({ address: async () => OWNER_ADDRESS }) },
    address: OWNER_ADDRESS,
    paymentKeyHash: "963786b45e76384b04d0aad0a7a36cc7c22564f9a4ff7b1a18ed95c",
    networkId: 0,
    networkMagic: null,
    walletName: "Eternl",
    apiVersion: "1.0.0",
  } as unknown as EternlConnection;

  await assert.rejects(refreshEternlConnection(connection), /requires Preprod/i);
});

test("an exact network-magic mismatch rejects Preview before reading an account", async () => {
  let addressReads = 0;
  const connection = {
    api: {
      getNetworkId: async () => 0,
      getExtensions: async () => [{ cip: 142 }],
      cip142: { getNetworkMagic: async () => 2 },
    },
    lucid: { wallet: () => ({ address: async () => {
      addressReads += 1;
      return OWNER_ADDRESS;
    } }) },
    address: OWNER_ADDRESS,
    paymentKeyHash: "963786b45e76384b04d0aad0a7a36cc7c22564f9a4ff7b1a18ed95c",
    networkId: 0,
    networkMagic: 1,
    walletName: "Eternl",
    apiVersion: "1.0.0",
  } as unknown as EternlConnection;

  await assert.rejects(
    refreshEternlConnection(connection),
    /network magic 2.*requires Preprod/i,
  );
  assert.equal(addressReads, 0);
});

test("a CIP-142 wallet confirms Preprod network magic", async () => {
  const connection = {
    api: {
      getNetworkId: async () => 0,
      getExtensions: async () => [{ cip: 142 }],
      cip142: { getNetworkMagic: async () => 1 },
    },
    lucid: { wallet: () => ({ address: async () => OWNER_ADDRESS }) },
    address: OWNER_ADDRESS,
    paymentKeyHash: "963786b45e76384b04d0aad0a7a36cc7c22564f9a4ff7b1a18ed95c",
    networkId: 0,
    networkMagic: null,
    walletName: "Eternl",
    apiVersion: "1.0.0",
  } as unknown as EternlConnection;

  const refreshed = await refreshEternlConnection(connection);
  assert.equal(refreshed.networkMagic, 1);
  assert.equal(isExactWalletNetwork(refreshed), true);
});

test("a testnet-only connection is not presented as exact Preprod proof", () => {
  assert.equal(isExactWalletNetwork({ networkId: 0, networkMagic: null }), false);
});

test("a wallet session requires exact network proof and no active revalidation", () => {
  const connection = {
    address: OWNER_ADDRESS,
    networkId: 0,
    networkMagic: 1,
  } as EternlConnection;
  assert.equal(isWalletSessionReady(connection, false), true);
  assert.equal(isWalletSessionReady(connection, true), false);
  assert.equal(
    isWalletSessionReady({ ...connection, networkMagic: null }, false),
    false,
  );
  assert.equal(isWalletSessionReady(null, false), false);
});

test("connection refusal uses connection-specific guidance", () => {
  const message = walletErrorMessage({
    code: -3,
    info: "User canceled connection",
  });
  assert.match(message, /did not approve the connection/i);
  assert.match(message, /look for Baton's access request/i);
  assert.match(message, /DApp Allowlist/i);
});

test("transaction refusal confirms that nothing was submitted", () => {
  assert.match(
    walletErrorMessage(
      { code: 2, info: "User declined" },
      undefined,
      "transaction",
    ),
    /nothing was signed or submitted/i,
  );
});

test("wallet setup errors never expose raw JavaScript internals", () => {
  assert.equal(
    walletErrorMessage(
      new TypeError("Cannot read properties of undefined (reading 'length')"),
      "Eternl connection failed.",
    ),
    "Eternl connection failed.",
  );
});

test("CIP-30 transaction decline code is handled without provider text", () => {
  assert.match(
    walletErrorMessage({ code: 2 }, undefined, "transaction"),
    /nothing was signed or submitted/i,
  );
});

test("account changes are detected from CIP-30 codes and provider wording", () => {
  assert.equal(isWalletAccountChangeError({ code: -4 }), true);
  assert.equal(isWalletAccountChangeError({ info: "Account has changed" }), true);
  assert.equal(isWalletAccountChangeError({ info: "Network changed" }), false);
  const message = walletErrorMessage({ code: -4 });
  assert.match(message, /stopped using the previous account/i);
  assert.match(message, /Forced DApp Account/i);
});

test("wallet-derived reviews and asset lists belong to one exact session", () => {
  const firstSession = { address: OWNER_ADDRESS } as EternlConnection;
  const secondSession = { address: OWNER_ADDRESS } as EternlConnection;
  const review = { transactionHash: "prepared" };
  const assets = [{ unit: "policy.asset", quantity: 1n }];

  assert.equal(
    reviewForWalletSession(review, firstSession, firstSession),
    review,
  );
  assert.equal(reviewForWalletSession(review, firstSession, secondSession), null);
  assert.equal(reviewForWalletSession(review, firstSession, null), null);
  assert.equal(
    reviewForWalletSession(assets, firstSession, firstSession),
    assets,
  );
  assert.equal(reviewForWalletSession(assets, firstSession, secondSession), null);
});

test("plan results never cross wallet sessions", () => {
  const firstSession = { address: OWNER_ADDRESS } as EternlConnection;
  const refreshedSession = { address: OWNER_ADDRESS } as EternlConnection;
  const walletPlans = { plans: ["owner-plan"] };
  const localPlans = { plans: ["saved-plan"] };

  assert.equal(
    resultForWalletSession(walletPlans, firstSession, firstSession),
    walletPlans,
  );
  assert.equal(
    resultForWalletSession(walletPlans, firstSession, refreshedSession),
    null,
  );
  assert.equal(resultForWalletSession(walletPlans, firstSession, null), null);
  assert.equal(resultForWalletSession(localPlans, null, null), localPlans);
  assert.equal(resultForWalletSession(null, null, null), null);
  assert.equal(resultForWalletSession(localPlans, undefined, null), null);
});

test("wallet reviews require enough time for a deliberate approval", () => {
  const now = 1_000_000;
  assert.equal(
    walletReviewNeedsRefresh(now + MIN_WALLET_APPROVAL_WINDOW_MS + 1, now),
    false,
  );
  assert.equal(
    walletReviewNeedsRefresh(now + MIN_WALLET_APPROVAL_WINDOW_MS, now),
    true,
  );
  assert.equal(walletReviewNeedsRefresh(now - 1, now), true);
  assert.equal(walletReviewNeedsRefresh(Number.NaN, now), true);
  assert.equal(walletReviewNeedsRefresh(now + 10_000, now, -1), true);
});

test("unsigned reviews reset only after a wallet session replacement settles", () => {
  const prepared = {};
  const refreshed = {};

  assert.equal(walletReviewSessionChanged(prepared, prepared, false, false), false);
  assert.equal(walletReviewSessionChanged(prepared, refreshed, true, false), false);
  assert.equal(walletReviewSessionChanged(prepared, refreshed, false, true), false);
  assert.equal(walletReviewSessionChanged(prepared, refreshed, false, false), true);
  assert.equal(walletReviewSessionChanged(prepared, null, false, false), true);
  assert.equal(walletReviewSessionChanged(null, refreshed, false, false), false);
});

test("exact-network errors use calm guidance instead of protocol internals", () => {
  assert.equal(
    walletErrorMessage({ message: "Network mismatch: switch to Preprod" }),
    "Eternl is set to a different Cardano network. Open Eternl, select Preprod, and try again. Baton did not connect or prepare a transaction.",
  );
  const detail =
    "Eternl is connected to network magic 2; this release requires Preprod (network magic 1). Switch networks in Eternl and reconnect.";
  const message = walletErrorMessage(new Error(detail));
  assert.doesNotMatch(message, /network (?:magic|id)|\b[12]\b/i);
  assert.match(message, /select Preprod/i);
  assert.match(message, /did not connect or prepare a transaction/i);
});
