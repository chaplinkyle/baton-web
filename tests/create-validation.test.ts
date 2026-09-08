import assert from "node:assert/strict";
import test from "node:test";
import { credentialToAddress } from "@lucid-evolution/lucid";
import {
  validateProtectStep,
  validateRecipientStep,
} from "../lib/create-validation";

const OWNER_KEY =
  "963786b45e76384b04d0aad0a7a36cc7c22564f9a4ff7b1a18ed95c6";
const CHECK_IN_KEY =
  "5640d9bfcaa869ed535cf3564107938397eaaeb7245b7520980d5112";
const CHECK_IN_ADDRESS = credentialToAddress("Preprod", {
  type: "Key",
  hash: CHECK_IN_KEY,
});

const validProtect = {
  connected: true,
  networkVerified: true,
  ownerPaymentKeyHashes: [OWNER_KEY],
  ada: "25",
  periodDays: 7,
  misses: 4,
  livenessAddress: CHECK_IN_ADDRESS,
};

test("protect step accepts a complete Preprod configuration", () => {
  assert.equal(validateProtectStep(validProtect), null);
});

test("protect step guides the first invalid field", () => {
  assert.deepEqual(
    validateProtectStep({ ...validProtect, connected: false }),
    {
      step: 1,
      field: "wallet",
      message: "Connect your Preprod Eternl wallet to continue.",
    },
  );
  assert.match(
    validateProtectStep({ ...validProtect, networkVerified: false })?.message ?? "",
    /not verified.*Preprod/i,
  );
  assert.equal(validateProtectStep({ ...validProtect, ada: "4.99" })?.field, "ada");
  assert.equal(
    validateProtectStep({ ...validProtect, periodDays: 0 })?.field,
    "period",
  );
  assert.equal(
    validateProtectStep({ ...validProtect, misses: 1_001 })?.field,
    "misses",
  );
  assert.equal(
    validateProtectStep({ ...validProtect, livenessAddress: "" })?.field,
    "liveness",
  );
});

test("protect step rejects the owner key and non-Preprod check-in addresses", () => {
  const ownerAddress = credentialToAddress("Preprod", {
    type: "Key",
    hash: OWNER_KEY,
  });
  const mainnetAddress = credentialToAddress("Mainnet", {
    type: "Key",
    hash: CHECK_IN_KEY,
  });
  assert.match(
    validateProtectStep({ ...validProtect, livenessAddress: ownerAddress })?.message ?? "",
    /different Eternl account/i,
  );
  assert.match(
    validateProtectStep({ ...validProtect, livenessAddress: mainnetAddress })?.message ?? "",
    /Preprod/i,
  );
});

test("protect step rejects every address exposed by the creating Eternl account", () => {
  assert.match(
    validateProtectStep({
      ...validProtect,
      ownerPaymentKeyHashes: [OWNER_KEY, CHECK_IN_KEY],
    })?.message ?? "",
    /different Eternl account/i,
  );
});

test("recipient step requires a valid Preprod destination only for fixed plans", () => {
  assert.equal(
    validateRecipientStep({ releaseMode: "bearer", destination: "" }),
    null,
  );
  assert.equal(
    validateRecipientStep({ releaseMode: "fixed", destination: "" })?.field,
    "destination",
  );
  assert.equal(
    validateRecipientStep({ releaseMode: "fixed", destination: CHECK_IN_ADDRESS }),
    null,
  );
  assert.match(
    validateRecipientStep({
      releaseMode: "fixed",
      destination: credentialToAddress("Mainnet", {
        type: "Key",
        hash: CHECK_IN_KEY,
      }),
    })?.message ?? "",
    /Preprod/i,
  );
});
