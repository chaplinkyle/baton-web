import { CARDANO_NETWORK } from "./config";
import { applyVault, type AppliedVault } from "./contract";
import type { VaultManifest } from "./manifest";
import {
  protocolArtifactFor,
  type ProtocolArtifact,
} from "./protocol-artifacts";
import {
  readPlanHistory,
  verifyCreationTransaction,
  type CreationVerification,
  type PlanHistoryEntry,
} from "./plan-discovery";
import {
  readOnlyLucid,
  readVaultLifecycle,
  type VaultLifecycle,
} from "./vault-state";

export type PlanVerificationReport = {
  manifest: VaultManifest;
  contract: AppliedVault;
  artifact: ProtocolArtifact;
  creation: CreationVerification;
  lifecycle: VaultLifecycle;
  history: PlanHistoryEntry[];
};

export type PlanDefinitionVerification = {
  contract: AppliedVault;
  artifact: ProtocolArtifact;
};

function assertAppliedContract(manifest: VaultManifest, contract: AppliedVault) {
  if (manifest.network !== CARDANO_NETWORK) {
    throw new Error(
      `This plan file is for ${manifest.network}; this verifier is pinned to ${CARDANO_NETWORK}.`,
    );
  }
  if (
    contract.policyId !== manifest.policyId ||
    contract.address !== manifest.validatorAddress ||
    contract.receiptUnit !== manifest.receiptUnit ||
    contract.terminalReceiptUnit !== manifest.terminalReceiptUnit ||
    (manifest.recoveryUnit !== undefined &&
      contract.recoveryReceiptUnit !== manifest.recoveryUnit)
  ) {
    throw new Error("This plan file does not reproduce the expected Cardano contract.");
  }
}

/** Verify every deterministic plan identity without contacting Cardano. */
export function verifyPlanDefinition(
  manifest: VaultManifest,
): PlanDefinitionVerification {
  const contract = applyVault(
    manifest.seed,
    manifest.receiptName,
    CARDANO_NETWORK,
  );
  assertAppliedContract(manifest, contract);
  return {
    contract,
    artifact: protocolArtifactFor(manifest.receiptName),
  };
}

/**
 * Produce one fail-closed report spanning the pinned artifact, creation
 * transaction, current lifecycle output, and complete canonical receipt chain.
 */
export async function verifyPlan(
  manifest: VaultManifest,
): Promise<PlanVerificationReport> {
  const { contract, artifact } = verifyPlanDefinition(manifest);

  const [creation, lifecycle] = await Promise.all([
    verifyCreationTransaction(manifest),
    readVaultLifecycle(await readOnlyLucid(), manifest),
  ]);
  const history = await readPlanHistory(
    manifest,
    lifecycle.kind === "active"
      ? {
          kind: "active",
          txHash: lifecycle.state.utxo.txHash,
          outputIndex: lifecycle.state.utxo.outputIndex,
          sequence: lifecycle.state.sequence,
        }
      : {
          kind: "completed",
          txHash: lifecycle.state.utxo.txHash,
          outputIndex: lifecycle.state.utxo.outputIndex,
        },
  );

  return {
    manifest,
    contract,
    artifact,
    creation,
    lifecycle,
    history,
  };
}
