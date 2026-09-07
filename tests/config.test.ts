import assert from "node:assert/strict";
import test from "node:test";
import { getAddressDetails } from "@lucid-evolution/lucid";
import {
  CARDANO_NETWORK,
  PINNED_PREPROD_TREASURY_ADDRESS,
  runtimeReadiness,
  TREASURY_ADDRESS,
} from "../lib/config";

test("the official Preprod treasury is pinned and valid", () => {
  assert.equal(CARDANO_NETWORK, "Preprod");
  assert.equal(TREASURY_ADDRESS, PINNED_PREPROD_TREASURY_ADDRESS);
  assert.equal(
    PINNED_PREPROD_TREASURY_ADDRESS,
    "addr_test1qztr0p45temrsjcy6z4dpfardnruyftylxj077c6rrket3sjrc6lv8zv5re7krwmg06djl866jl3ygd9zea2cv0aydtq6fqvee",
  );
  const details = getAddressDetails(PINNED_PREPROD_TREASURY_ADDRESS);
  assert.equal(details.networkId, 0);
  assert.equal(details.paymentCredential?.type, "Key");
  assert.equal(runtimeReadiness.canCreate, true);
});
