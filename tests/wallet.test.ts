import assert from "node:assert/strict";
import test from "node:test";
import {
  cardanoBrowseUri,
  WalletRequestTimeoutError,
  walletErrorMessage,
  withWalletTimeout,
} from "../lib/eternl";

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
