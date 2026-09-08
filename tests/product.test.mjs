import assert from "node:assert/strict";
import test from "node:test";
import {
  DAY_MS,
  missedCount,
  nextCheckInAt,
  releaseAt,
  vaultStatus,
} from "../lib/product.ts";
import { parseManifest } from "../lib/manifest.ts";

test("four misses release on the fourth boundary", () => {
  const anchor = Date.UTC(2026, 7, 1);
  const period = 7 * DAY_MS;
  assert.equal(nextCheckInAt(anchor, period), Date.UTC(2026, 7, 8));
  assert.equal(releaseAt(anchor, period, 4), Date.UTC(2026, 7, 29));
  assert.equal(missedCount(Date.UTC(2026, 7, 22), anchor, period, 4), 3);
  assert.equal(vaultStatus(Date.UTC(2026, 7, 29), anchor, period, 4), "claimable");
});

test("no missed transaction is needed to derive state", () => {
  const anchor = 1_000;
  assert.equal(missedCount(anchor + 9_999, anchor, 10_000, 3), 0);
  assert.equal(missedCount(anchor + 10_000, anchor, 10_000, 3), 1);
  assert.equal(missedCount(anchor + 20_000, anchor, 10_000, 3), 2);
  assert.equal(missedCount(anchor + 30_000, anchor, 10_000, 3), 3);
});

test("2,000 generated schedules preserve every missed-boundary invariant", () => {
  let randomState = 0x1a57c0de;
  const nextRandom = () => {
    randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
    return randomState;
  };
  const anchor = Date.UTC(2026, 0, 1);
  for (let index = 0; index < 2_000; index += 1) {
    const period = 1_000 + nextRandom() % (3_650 * DAY_MS);
    const misses = 1 + nextRandom() % 1_000;
    const finalBoundary = releaseAt(anchor, period, misses);
    assert.equal(finalBoundary, anchor + period * misses);
    assert.equal(missedCount(anchor, anchor, period, misses), 0);
    assert.equal(vaultStatus(anchor, anchor, period, misses), "active");
    assert.equal(missedCount(finalBoundary - 1, anchor, period, misses), misses - 1);
    assert.notEqual(vaultStatus(finalBoundary - 1, anchor, period, misses), "claimable");
    assert.equal(missedCount(finalBoundary, anchor, period, misses), misses);
    assert.equal(vaultStatus(finalBoundary, anchor, period, misses), "claimable");

    const renewedAnchor = anchor + 1 + nextRandom() % period;
    assert.ok(releaseAt(renewedAnchor, period, misses) > finalBoundary);
    assert.equal(missedCount(renewedAnchor, renewedAnchor, period, misses), 0);
  }
});

test("manifest rejects a zero miss threshold", () => {
  const invalid = {
    version: 3,
    network: "Preprod",
    creationTx: "00".repeat(32),
    seed: { txHash: "11".repeat(32), outputIndex: 0 },
    receiptName: "BATON",
    terminalReceiptName: "BATON_COMPLETE",
    recoveryReceiptName: "BATON_RECOVERY",
    policyId: "22".repeat(28),
    receiptUnit: "22".repeat(28) + Buffer.from("BATON", "utf8").toString("hex"),
    terminalReceiptUnit: "22".repeat(28) + Buffer.from("BATON_COMPLETE", "utf8").toString("hex"),
    validatorAddress: "addr_test1invalid",
    ownerKeyHash: "33".repeat(28),
    livenessKeyHash: "44".repeat(28),
    checkInPeriodMs: DAY_MS,
    missesToRelease: 0,
    lastCheckInAtMs: 1,
    releaseAtMs: 1,
    releaseMode: "bearer",
    recoveryUnit: "22".repeat(28) + Buffer.from("BATON_RECOVERY", "utf8").toString("hex"),
  };
  assert.throws(() => parseManifest(invalid), /missed-check-in threshold/i);
});

function validManifest() {
  const policyId = "22".repeat(28);
  const receiptName = "BATON";
  const terminalReceiptName = "BATON_COMPLETE";
  const recoveryReceiptName = "BATON_RECOVERY";
  const receiptNameHex = Buffer.from(receiptName, "utf8").toString("hex");
  const terminalReceiptNameHex = Buffer.from(terminalReceiptName, "utf8").toString("hex");
  const lastCheckInAtMs = 1_000;
  const checkInPeriodMs = 10_000;
  const missesToRelease = 4;
  return {
    version: 3,
    network: "Preprod",
    creationTx: "00".repeat(32),
    seed: { txHash: "11".repeat(32), outputIndex: 0 },
    receiptName,
    terminalReceiptName,
    recoveryReceiptName,
    policyId,
    receiptUnit: policyId + receiptNameHex,
    terminalReceiptUnit: policyId + terminalReceiptNameHex,
    validatorAddress: "addr_test1validator",
    ownerKeyHash: "33".repeat(28),
    livenessKeyHash: "44".repeat(28),
    checkInPeriodMs,
    missesToRelease,
    lastCheckInAtMs,
    releaseAtMs: lastCheckInAtMs + checkInPeriodMs * missesToRelease,
    releaseMode: "bearer",
    recoveryUnit: policyId + Buffer.from(recoveryReceiptName, "utf8").toString("hex"),
  };
}

test("valid manifest preserves the configurable schedule", () => {
  assert.deepEqual(parseManifest(validManifest()), validManifest());
});

test("legacy rc.9 manifests remain actionable during the Baton transition", () => {
  const manifest = validManifest();
  const receiptName = "LAST_SIGNAL";
  const terminalReceiptName = "LAST_SIGNAL_DONE";
  const recoveryReceiptName = "LAST_SIGNAL_RECOVERY";
  const legacy = {
    ...manifest,
    receiptName,
    terminalReceiptName,
    recoveryReceiptName,
    receiptUnit: manifest.policyId + Buffer.from(receiptName, "utf8").toString("hex"),
    terminalReceiptUnit:
      manifest.policyId + Buffer.from(terminalReceiptName, "utf8").toString("hex"),
    recoveryUnit:
      manifest.policyId + Buffer.from(recoveryReceiptName, "utf8").toString("hex"),
  };
  assert.deepEqual(parseManifest(legacy), legacy);
});

test("manifest rejects a forged release boundary", () => {
  assert.throws(
    () => parseManifest({ ...validManifest(), releaseAtMs: 999_999 }),
    /does not match its schedule/,
  );
});

test("manifest rejects a receipt unit inconsistent with its validator policy", () => {
  assert.throws(
    () => parseManifest({ ...validManifest(), receiptUnit: "66".repeat(32) }),
    /receipt unit does not match/,
  );
});

test("manifest rejects a completion receipt inconsistent with its validator policy", () => {
  assert.throws(
    () => parseManifest({ ...validManifest(), terminalReceiptUnit: "66".repeat(32) }),
    /completion receipt unit does not match/,
  );
});

test("manifest rejects identical active and completion receipts", () => {
  const manifest = validManifest();
  assert.throws(
    () => parseManifest({
      ...manifest,
      terminalReceiptName: manifest.receiptName,
      terminalReceiptUnit: manifest.receiptUnit,
    }),
    /unsupported active, completion, or recovery receipt names/,
  );
});

test("manifest rejects an invented completion receipt name", () => {
  const manifest = validManifest();
  const terminalReceiptName = "INVENTED_DONE";
  assert.throws(
    () => parseManifest({
      ...manifest,
      terminalReceiptName,
      terminalReceiptUnit:
        manifest.policyId + Buffer.from(terminalReceiptName, "utf8").toString("hex"),
    }),
    /unsupported active, completion, or recovery receipt names/,
  );
});

test("manifest rejects identical owner and liveness keys", () => {
  const manifest = validManifest();
  assert.throws(
    () => parseManifest({ ...manifest, livenessKeyHash: manifest.ownerKeyHash }),
    /must be different/,
  );
});

test("manifest rejects recovery units outside the plan's one-shot policy", () => {
  assert.throws(
    () => parseManifest({ ...validManifest(), recoveryUnit: "55".repeat(28) + "01" }),
    /one-shot Baton recovery token/,
  );
});
