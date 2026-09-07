import assert from "node:assert/strict";
import test from "node:test";
import {
  cardanoBrowseUri,
  type EternlConnection,
  refreshEternlConnection,
  WalletRequestTimeoutError,
  walletErrorMessage,
  withWalletTimeout,
} from "../lib/eternl";

const OWNER_ADDRESS = "addr_test1qztr0p45temrsjcy6z4dpfardnruyftylxj077c6rrket3sjrc6lv8zv5re7krwmg06djl866jl3ygd9zea2cv0aydtq6fqvee";
const CHECK_IN_ADDRESS = "addr_test1vptypkdle25xnm2ntne4vsg8jwpe064wkuj9kafqnqx4zysclztwf";

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
  assert.equal(networkReads, 1);
  assert.equal(addressReads, 1);
});

test("an authorized wallet refresh still rejects the wrong network", async () => {
  const connection = {
    api: { getNetworkId: async () => 1 },
    lucid: { wallet: () => ({ address: async () => OWNER_ADDRESS }) },
    address: OWNER_ADDRESS,
    paymentKeyHash: "963786b45e76384b04d0aad0a7a36cc7c22564f9a4ff7b1a18ed95c",
    networkId: 0,
    walletName: "Eternl",
    apiVersion: "1.0.0",
  } as unknown as EternlConnection;

  await assert.rejects(refreshEternlConnection(connection), /requires Preprod/i);
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

test("account changes require a fresh connection", () => {
  assert.match(
    walletErrorMessage({ code: -4, info: "Account changed" }),
    /account changed.*reconnect/i,
  );
});

test("provider network errors retain their useful detail", () => {
  assert.equal(
    walletErrorMessage({ message: "Network mismatch: switch to Preprod" }),
    "Network mismatch: switch to Preprod",
  );
});
