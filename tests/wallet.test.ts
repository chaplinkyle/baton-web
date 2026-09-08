import assert from "node:assert/strict";
import test from "node:test";
import {
  cardanoBrowseUri,
  type EternlConnection,
  isExactWalletNetwork,
  isWalletAccountChangeError,
  isWalletSessionReady,
  refreshEternlConnection,
  reviewForWalletSession,
  shouldOfferWalletAppHandoff,
  WalletRequestTimeoutError,
  walletConnectionActionLabel,
  walletErrorMessage,
  walletIdentityKey,
  walletIssuePresentation,
  walletSetupPresentation,
  withWalletTimeout,
} from "../lib/eternl";
import { CML } from "@lucid-evolution/lucid";

const OWNER_ADDRESS = "addr_test1qztr0p45temrsjcy6z4dpfardnruyftylxj077c6rrket3sjrc6lv8zv5re7krwmg06djl866jl3ygd9zea2cv0aydtq6fqvee";
const CHECK_IN_ADDRESS = "addr_test1vptypkdle25xnm2ntne4vsg8jwpe064wkuj9kafqnqx4zysclztwf";

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
    lucid: { wallet: () => ({ address: async () => CHECK_IN_ADDRESS }) },
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

test("a wallet session cannot authorize actions while it is being revalidated", () => {
  const connection = { address: OWNER_ADDRESS } as EternlConnection;
  assert.equal(isWalletSessionReady(connection, false), true);
  assert.equal(isWalletSessionReady(connection, true), false);
  assert.equal(isWalletSessionReady(null, false), false);
});

test("connection refusal uses connection-specific guidance", () => {
  assert.match(
    walletErrorMessage({ code: -3, info: "User canceled connection" }),
    /connection was not approved/i,
  );
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
  assert.match(walletErrorMessage({ code: -4 }), /stopped using the previous account/i);
});

test("unsigned reviews belong to one exact wallet session", () => {
  const firstSession = { address: OWNER_ADDRESS } as EternlConnection;
  const secondSession = { address: OWNER_ADDRESS } as EternlConnection;
  const review = { transactionHash: "prepared" };

  assert.equal(
    reviewForWalletSession(review, firstSession, firstSession),
    review,
  );
  assert.equal(reviewForWalletSession(review, firstSession, secondSession), null);
  assert.equal(reviewForWalletSession(review, firstSession, null), null);
});

test("provider network errors retain their useful detail", () => {
  assert.equal(
    walletErrorMessage({ message: "Network mismatch: switch to Preprod" }),
    "Network mismatch: switch to Preprod",
  );
});

test("exact-network guidance is not replaced by a generic outage message", () => {
  const detail =
    "Eternl is connected to network magic 2; this release requires Preprod (network magic 1). Switch networks in Eternl and reconnect.";

  assert.equal(walletErrorMessage(new Error(detail)), detail);
});
