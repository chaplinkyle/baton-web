import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const PREPROD_KOIOS = "https://preprod.koios.rest/api/v1";

function usage() {
  return [
    "Usage: npm run plan:verify -- [--offline] <baton-plan.json|->",
    "",
    "Without --offline, Baton verifies the complete current plan against public Cardano Preprod data.",
    "With --offline, Baton verifies only deterministic manifest and vendored contract-artifact identities.",
    "Use - to read the plan JSON from standard input.",
  ].join("\n");
}

async function readStandardInput() {
  if (process.stdin.isTTY) throw new Error(usage());
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return withoutByteOrderMark(Buffer.concat(chunks).toString("utf8"));
}

async function readPlanFile(path: string | undefined) {
  if (!path || path === "-") return readStandardInput();
  return withoutByteOrderMark(await readFile(resolve(path), "utf8"));
}

function withoutByteOrderMark(value: string) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function serializableAssets(assets: Record<string, bigint>) {
  return Object.fromEntries(
    Object.entries(assets).map(([unit, quantity]) => [unit, quantity.toString()]),
  );
}

async function verifyVendoredArtifact(receiptName: string, expectedSha: string) {
  const path = receiptName === "BATON"
    ? new URL("../lib/plutus.json", import.meta.url)
    : new URL("../lib/plutus.rc9.json", import.meta.url);
  const bytes = await readFile(path);
  const actualSha = createHash("sha256").update(bytes).digest("hex");
  if (actualSha !== expectedSha) {
    throw new Error("The vendored contract blueprint does not match the pinned release hash.");
  }
  return actualSha;
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const offline = arguments_.includes("--offline");
  const unsupported = arguments_.filter(
    (argument) => argument.startsWith("--") && argument !== "--offline",
  );
  if (unsupported.length > 0) throw new Error(usage());
  const path = arguments_.find((argument) => argument !== "--offline");

  // The browser uses Baton's same-origin read proxy. A standalone Node process
  // needs the corresponding absolute public endpoint.
  process.env.NEXT_PUBLIC_KOIOS_URL ??= PREPROD_KOIOS;

  const [{ parseManifest }, verification] = await Promise.all([
    import("../lib/manifest"),
    import("../lib/plan-verification"),
  ]);
  const manifest = parseManifest(await readPlanFile(path));
  const definition = verification.verifyPlanDefinition(manifest);
  const artifactSha256 = await verifyVendoredArtifact(
    manifest.receiptName,
    definition.artifact.blueprintSha256,
  );
  const summary: Record<string, unknown> = {
    verified: true,
    mode: offline ? "offline-definition" : "complete-preprod",
    limits: offline
      ? "Current Cardano lifecycle and transaction history were not checked."
      : undefined,
    network: manifest.network,
    creationTx: manifest.creationTx,
    contract: {
      release: definition.artifact.release,
      rawValidatorHash: definition.artifact.validatorHash,
      appliedPolicyId: definition.contract.policyId,
      validatorAddress: definition.contract.address,
      activeReceiptUnit: definition.contract.receiptUnit,
      completionReceiptUnit: definition.contract.terminalReceiptUnit,
      blueprintSha256: artifactSha256,
    },
    schedule: {
      checkInPeriodMs: manifest.checkInPeriodMs,
      allowedMisses: manifest.missesToRelease,
      initialReleaseAtMs: manifest.releaseAtMs,
    },
    releasePolicy: manifest.releaseMode === "fixed"
      ? { kind: "fixed", destination: manifest.destination }
      : { kind: "recovery-token", recoveryUnit: manifest.recoveryUnit },
  };

  if (!offline) {
    const report = await verification.verifyPlan(manifest);
    const lifecycle = report.lifecycle;
    summary.creation = {
      confirmedAtMs: report.creation.confirmedAtMs,
      discoveryMarker: report.creation.discoveryMarker,
      siteFee: report.creation.siteFee,
      siteFeeLovelace: report.creation.siteFeeLovelace.toString(),
    };
    summary.currentState = {
      kind: lifecycle.kind,
      txHash: lifecycle.state.utxo.txHash,
      outputIndex: lifecycle.state.utxo.outputIndex,
      assets: serializableAssets(lifecycle.state.utxo.assets),
      ...(lifecycle.kind === "active"
        ? {
            sequence: lifecycle.state.sequence,
            lastCheckInAtMs: lifecycle.state.lastCheckInAtMs,
            releaseAtMs: lifecycle.state.releaseAtMs,
          }
        : {}),
    };
    summary.history = report.history;
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((cause: unknown) => {
  const message = cause instanceof Error ? cause.message : "Plan verification failed.";
  process.stderr.write(`Baton verification failed: ${message}\n`);
  process.exitCode = 1;
});
