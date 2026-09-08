import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const publicCompletedPlan = {
  version: 3,
  network: "Preprod",
  creationTx: "5ac5cee8ef48845c86fb63b9f349f8ef18adef4175b544a4561e2d4b796d5b80",
  seed: {
    txHash: "628416245cab53bb58fa23ddb4f31130a1afba802a6d44bcb9f8bbf92c49bcd5",
    outputIndex: 1,
  },
  receiptName: "BATON",
  terminalReceiptName: "BATON_COMPLETE",
  recoveryReceiptName: "BATON_RECOVERY",
  policyId: "7f3e9c7255c502989195452f721a8c7491da9d8a42aaf4af7a773cb3",
  receiptUnit: "7f3e9c7255c502989195452f721a8c7491da9d8a42aaf4af7a773cb34241544f4e",
  terminalReceiptUnit: "7f3e9c7255c502989195452f721a8c7491da9d8a42aaf4af7a773cb34241544f4e5f434f4d504c455445",
  validatorAddress: "addr_test1wplna8rj2hzs9xy3j4zj7us6336frk5a3fp24a900fmnevcyqvez5",
  ownerKeyHash: "8fe64f5f39fd3a35bd0cc2203906b882ff488f118a2bb963760cc237",
  livenessKeyHash: "e68397ea7ea0b40cb6490962b115ba1cff283f360b55fd0ee4ffda97",
  checkInPeriodMs: 86_400_000,
  missesToRelease: 2,
  lastCheckInAtMs: 1_788_790_308_000,
  releaseAtMs: 1_788_963_108_000,
  releaseMode: "fixed",
  destination: "addr_test1vqkjkxhwhry4kduldkt7ytg8ylleccj2cl04mrsgff2s6kqwp65cj",
};

test("offline plan CLI accepts BOM-prefixed JSON from Windows stdin", {
  timeout: 20_000,
}, () => {
  const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/verify-plan.ts", "--offline", "-"],
    {
      cwd: projectDirectory,
      encoding: "utf8",
      input: `\uFEFF${JSON.stringify(publicCompletedPlan)}`,
      timeout: 15_000,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as {
    verified: boolean;
    mode: string;
    limits: string;
    contract: { blueprintSha256: string };
  };
  assert.equal(report.verified, true);
  assert.equal(report.mode, "offline-definition");
  assert.match(report.limits, /current Cardano lifecycle.*not checked/i);
  assert.equal(
    report.contract.blueprintSha256,
    "b0809a00186e40ffca51511dbd81086d642be7149b6d1852fe127fc1822d22fc",
  );
});
