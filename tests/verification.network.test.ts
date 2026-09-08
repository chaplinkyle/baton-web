import assert from "node:assert/strict";
import test from "node:test";

const CREATION_TX =
  "5ac5cee8ef48845c86fb63b9f349f8ef18adef4175b544a4561e2d4b796d5b80";
const COMPLETION_TX =
  "7aba10c461f6886568a577fff89fba6e3e9b9b235bdb7856709439d968c7b69b";

test("verifies a complete public rc.10 Preprod plan end to end", {
  timeout: 30_000,
}, async () => {
  process.env.NEXT_PUBLIC_KOIOS_URL = "https://preprod.koios.rest/api/v1";
  const [{ recoverManifestFromCreationTx }, { verifyPlan }] =
    await Promise.all([
      import("../lib/plan-discovery"),
      import("../lib/plan-verification"),
    ]);

  const manifest = await recoverManifestFromCreationTx(CREATION_TX);
  const report = await verifyPlan(manifest);

  assert.equal(report.manifest.receiptName, "BATON");
  assert.equal(report.artifact.release, "0.1.0-rc.10");
  assert.equal(
    report.artifact.blueprintSha256,
    "b0809a00186e40ffca51511dbd81086d642be7149b6d1852fe127fc1822d22fc",
  );
  assert.equal(report.creation.siteFee, "verified");
  assert.equal(report.creation.siteFeeLovelace, 5_000_000n);
  assert.equal(report.lifecycle.kind, "completed");
  assert.equal(report.lifecycle.state.utxo.txHash, COMPLETION_TX);
  assert.equal(report.history.length, 7);
  assert.deepEqual(
    report.history.map((entry) => [entry.kind, entry.sequence]),
    [
      ["created", 0],
      ["check-in", 1],
      ["check-in", 2],
      ["check-in", 3],
      ["check-in", 4],
      ["check-in", 5],
      ["completed", 5],
    ],
  );
});
