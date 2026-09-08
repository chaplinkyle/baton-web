import assert from "node:assert/strict";
import test from "node:test";
import {
  cardanoErrorMessage,
  isRetryableCardanoReadError,
  withCardanoReadRetry,
} from "../lib/cardano-errors";

test("provider timeouts become calm retry guidance", () => {
  const internal = new Error(
    "TimeoutException: Operation timed out after '10s' at Module.timeoutExceptionFromDuration\n" +
    "at http://localhost:3000/_next/static/chunks/node_modules_effect.js:1496:50",
  );
  const message = cardanoErrorMessage(internal);

  assert.match(message, /taking longer than expected/i);
  assert.match(message, /nothing changed/i);
  assert.doesNotMatch(message, /TimeoutException|node_modules|https?:\/\//i);
});

test("network failures explain that confirmed state was not changed", () => {
  const message = cardanoErrorMessage(new TypeError("Failed to fetch"));
  assert.match(message, /could not reach Cardano/i);
  assert.match(message, /nothing changed/i);
});

test("useful protocol validation remains visible", () => {
  assert.equal(
    cardanoErrorMessage(new Error("This is not a supported Baton creation transaction.")),
    "This is not a supported Baton creation transaction.",
  );
});

test("internal stack-like details fall back to the supplied safe copy", () => {
  assert.equal(
    cardanoErrorMessage(
      new Error("at Module.internal (http://localhost:3000/_next/static/chunk.js:1:1)"),
      "This plan could not be checked.",
    ),
    "This plan could not be checked.",
  );
});

test("idempotent Cardano reads retry one transient timeout", async () => {
  let calls = 0;
  const result = await withCardanoReadRetry(async () => {
    calls += 1;
    if (calls === 1) throw new Error("TimeoutException: Operation timed out after '10s'");
    return "ready";
  }, 2, 0);

  assert.equal(result, "ready");
  assert.equal(calls, 2);
});

test("idempotent Cardano reads back off through a temporary rate limit", async () => {
  let calls = 0;
  const result = await withCardanoReadRetry(async () => {
    calls += 1;
    if (calls < 3) throw new Error("Cardano provider returned 429 Too Many Requests.");
    return "ready";
  }, 3, 0);

  assert.equal(result, "ready");
  assert.equal(calls, 3);
});

test("Cardano read retries do not repeat protocol validation failures", async () => {
  let calls = 0;
  await assert.rejects(
    withCardanoReadRetry(async () => {
      calls += 1;
      throw new Error("Manifest does not reproduce the pinned validator.");
    }),
    /pinned validator/i,
  );
  assert.equal(calls, 1);
});

test("reconnect guidance is not mistaken for an ECONN transport failure", () => {
  const guidance =
    "Eternl is connected to network magic 2; this release requires Preprod. Switch networks in Eternl and reconnect.";

  assert.equal(isRetryableCardanoReadError(new Error(guidance)), false);
  assert.equal(cardanoErrorMessage(new Error(guidance)), guidance);
});

test("wallet funding failures become actionable Preprod guidance", () => {
  const message = cardanoErrorMessage(new Error(
    "{ Complete: Your wallet does not have enough funds to cover the required assets: {",
  ));

  assert.match(message, /does not have enough available ADA or selected assets/i);
  assert.match(message, /Preprod test ADA/i);
  assert.match(message, /Nothing changed/i);
  assert.doesNotMatch(message, /\{ Complete|required assets: \{/i);
});

test("an empty wallet gets faucet guidance instead of UTxO jargon", () => {
  const message = cardanoErrorMessage(
    new Error("The connected wallet has no spendable UTxO."),
  );

  assert.match(message, /no spendable test ADA/i);
  assert.match(message, /Baton wallet menu/i);
  assert.match(message, /official Cardano faucet on Preprod/i);
  assert.match(message, /Nothing was signed or submitted/i);
  assert.doesNotMatch(message, /UTxO/i);
});

test("missing collateral explains the safe wallet preparation step", () => {
  const message = cardanoErrorMessage(new Error("No collateral found in wallet"));

  assert.match(message, /ADA-only collateral output/i);
  assert.match(message, /Set up collateral in Eternl/i);
  assert.match(message, /Nothing changed/i);
});

test("structured runtime fragments never reach the interface", () => {
  assert.equal(
    cardanoErrorMessage(new Error("[RuntimeFailure: internal builder state]"), "Safe fallback."),
    "Safe fallback.",
  );
});
