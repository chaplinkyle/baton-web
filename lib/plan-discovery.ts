import {
  datumJsonToCbor,
  getAddressDetails,
  type Assets,
  type LucidEvolution,
  type UTxO,
} from "@lucid-evolution/lucid";
import { applyVault } from "./contract";
import {
  BATON_DISCOVERY_LABEL,
  CARDANO_NETWORK,
  KOIOS_URL,
} from "./config";
import { parseManifest, type VaultManifest } from "./manifest";
import { SUPPORTED_RECEIPT_NAMES } from "./protocol-names";
import { decodeVaultDatum } from "./vault-state";

export type PlanRole = "owner" | "check-in" | "recipient" | "recovery holder";

type KoiosAsset = {
  policy_id: string;
  asset_name: string;
  quantity: string;
};

type KoiosInput = {
  tx_hash: string;
  tx_index: number;
};

type KoiosOutput = {
  value: string;
  payment_addr: { bech32: string } | null;
  inline_datum: { bytes: string | null; value?: unknown } | null;
  asset_list: KoiosAsset[];
};

export type KoiosCreationTransaction = {
  tx_hash: string;
  inputs: KoiosInput[];
  outputs: KoiosOutput[];
  assets_minted: KoiosAsset[];
  metadata: Record<string, unknown> | null;
};

type KoiosMetadataTransaction = {
  tx_hash: string;
};

type KoiosCredentialTransaction = {
  tx_hash: string;
};

function assetQuantity(assets: KoiosAsset[], unit: string) {
  return assets
    .filter((asset) => `${asset.policy_id}${asset.asset_name}` === unit)
    .reduce((total, asset) => total + BigInt(asset.quantity), 0n);
}

function hasDiscoveryMarker(transaction: KoiosCreationTransaction) {
  const marker = transaction.metadata?.[String(BATON_DISCOVERY_LABEL)];
  if (!marker || typeof marker !== "object") return false;
  const value = marker as Record<string, unknown>;
  return value.app === "baton" && Number(value.version) === 1;
}

function inlineDatumCbor(output: KoiosOutput) {
  if (output.inline_datum?.bytes) return output.inline_datum.bytes;
  if (output.inline_datum?.value) {
    return datumJsonToCbor(
      output.inline_datum.value as Parameters<typeof datumJsonToCbor>[0],
    );
  }
  return null;
}

export function recoverManifestFromTransaction(
  transaction: KoiosCreationTransaction,
  requireDiscoveryMarker = false,
): VaultManifest {
  if (!/^[0-9a-f]{64}$/.test(transaction.tx_hash)) {
    throw new Error("Creation transaction hash is malformed.");
  }
  if (requireDiscoveryMarker && !hasDiscoveryMarker(transaction)) {
    throw new Error("Transaction does not contain the Baton discovery marker.");
  }

  for (const input of transaction.inputs) {
    if (!/^[0-9a-f]{64}$/.test(input.tx_hash) || !Number.isInteger(input.tx_index)) continue;
    const seed = { txHash: input.tx_hash, outputIndex: input.tx_index };
    for (const receiptName of SUPPORTED_RECEIPT_NAMES) {
      const contract = applyVault(seed, receiptName, CARDANO_NETWORK);
      const output = transaction.outputs.find(
        (candidate) =>
          candidate.payment_addr?.bech32 === contract.address &&
          assetQuantity(candidate.asset_list ?? [], contract.receiptUnit) === 1n,
      );
      if (!output) continue;
      const datumCbor = inlineDatumCbor(output);
      if (!datumCbor) continue;

      try {
      const datum = decodeVaultDatum(datumCbor);
      if (datum.sequence !== 0) continue;
      if (datum.ownerKeyHash === datum.livenessKeyHash) continue;
      if (assetQuantity(transaction.assets_minted ?? [], contract.receiptUnit) !== 1n) continue;

      const recoveryQuantity = assetQuantity(
        transaction.assets_minted ?? [],
        contract.recoveryReceiptUnit,
      );
      if (datum.releaseRule.kind === "bearer") {
        if (
          datum.releaseRule.policyId !== contract.policyId ||
          datum.releaseRule.assetName !== contract.recoveryReceiptUnit.slice(56) ||
          recoveryQuantity !== 1n
        ) continue;
      } else if (recoveryQuantity !== 0n) {
        continue;
      }

      return parseManifest({
        version: 3,
        network: CARDANO_NETWORK,
        creationTx: transaction.tx_hash,
        seed,
        receiptName: contract.receiptName,
        terminalReceiptName: contract.terminalReceiptName,
        recoveryReceiptName: contract.recoveryReceiptName,
        policyId: contract.policyId,
        receiptUnit: contract.receiptUnit,
        terminalReceiptUnit: contract.terminalReceiptUnit,
        validatorAddress: contract.address,
        ownerKeyHash: datum.ownerKeyHash,
        livenessKeyHash: datum.livenessKeyHash,
        checkInPeriodMs: datum.checkInPeriodMs,
        missesToRelease: datum.missesToRelease,
        lastCheckInAtMs: datum.lastCheckInAtMs,
        releaseAtMs:
          datum.lastCheckInAtMs + datum.checkInPeriodMs * datum.missesToRelease,
        releaseMode: datum.releaseRule.kind,
        destination:
          datum.releaseRule.kind === "fixed" ? datum.releaseRule.address : undefined,
        recoveryUnit:
          datum.releaseRule.kind === "bearer"
            ? contract.recoveryReceiptUnit
            : undefined,
        payloadCommitment: datum.payloadCommitment,
      });
      } catch {
        // A transaction may have several inputs. Only the one-shot seed can
        // reproduce the canonical script output, so continue trying candidates.
      }
    }
  }

  throw new Error("This is not a supported Baton creation transaction.");
}

async function fetchTransactionInfo(txHashes: string[]) {
  if (txHashes.length === 0) return [];
  const response = await fetch(`${KOIOS_URL}/tx_info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      _tx_hashes: txHashes,
      _inputs: true,
      _assets: true,
      _metadata: true,
      _scripts: true,
    }),
  });
  if (!response.ok) throw new Error("Cardano did not return the requested plan transactions.");
  return response.json() as Promise<KoiosCreationTransaction[]>;
}

export async function recoverManifestFromCreationTx(txHash: string) {
  const normalized = txHash.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Enter a 64-character Cardano transaction ID.");
  }
  const [transaction] = await fetchTransactionInfo([normalized]);
  if (!transaction) throw new Error("That transaction was not found on this Cardano network.");
  return recoverManifestFromTransaction(transaction);
}

export function rolesForManifest(
  manifest: VaultManifest,
  paymentKeyHash: string,
  walletAssets: Assets = {},
): PlanRole[] {
  const roles: PlanRole[] = [];
  if (manifest.ownerKeyHash === paymentKeyHash) roles.push("owner");
  if (manifest.livenessKeyHash === paymentKeyHash) roles.push("check-in");
  if (manifest.releaseMode === "fixed" && manifest.destination) {
    const credential = getAddressDetails(manifest.destination).paymentCredential;
    if (credential?.type === "Key" && credential.hash === paymentKeyHash) {
      roles.push("recipient");
    }
  }
  if (
    manifest.releaseMode === "bearer" &&
    manifest.recoveryUnit &&
    (walletAssets[manifest.recoveryUnit] ?? 0n) >= 1n
  ) {
    roles.push("recovery holder");
  }
  return roles;
}

export function combineWalletAssets(utxos: UTxO[]) {
  return utxos.reduce<Assets>((combined, utxo) => {
    for (const [unit, quantity] of Object.entries(utxo.assets)) {
      combined[unit] = (combined[unit] ?? 0n) + quantity;
    }
    return combined;
  }, {});
}

export async function discoverWalletManifests(
  lucid: LucidEvolution,
  paymentKeyHash: string,
) {
  const [walletUtxos, metadataResponse, credentialResponse] = await Promise.all([
    lucid.wallet().getUtxos(),
    fetch(`${KOIOS_URL}/tx_by_metalabel?_label=${BATON_DISCOVERY_LABEL}`, {
      headers: { Range: "0-999" },
      cache: "no-store",
    }),
    fetch(`${KOIOS_URL}/credential_txs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Range: "0-999",
      },
      body: JSON.stringify({ _payment_credentials: [paymentKeyHash] }),
      cache: "no-store",
    }),
  ]);
  if (!metadataResponse.ok) throw new Error("Baton could not search Cardano for connected plans.");
  if (!credentialResponse.ok) throw new Error("Baton could not search this wallet's Cardano history.");
  const indexed = await metadataResponse.json() as KoiosMetadataTransaction[];
  const credentialTransactions = await credentialResponse.json() as KoiosCredentialTransaction[];
  const walletAssets = combineWalletAssets(walletUtxos);
  const discovered: Array<{ manifest: VaultManifest; roles: PlanRole[] }> = [];
  const credentialHashes = new Set(
    credentialTransactions.map((transaction) => transaction.tx_hash),
  );
  const candidateHashes = [...new Set([
    ...indexed.map((transaction) => transaction.tx_hash),
    ...credentialHashes,
  ])];

  for (let offset = 0; offset < candidateHashes.length; offset += 20) {
    const transactions = await fetchTransactionInfo(
      candidateHashes.slice(offset, offset + 20),
    );
    for (const transaction of transactions) {
      try {
        // Site-created plans use the public metadata index. Legacy plans did
        // not, so also inspect the connected payment credential's own history.
        // Every candidate still has to reproduce its applied validator and
        // on-chain datum before wallet roles are considered.
        const manifest = recoverManifestFromTransaction(
          transaction,
          !credentialHashes.has(transaction.tx_hash),
        );
        const roles = rolesForManifest(manifest, paymentKeyHash, walletAssets);
        if (roles.length > 0) discovered.push({ manifest, roles });
      } catch {
        // Metadata labels are public and can be spoofed. Invalid candidates are
        // ignored unless their applied validator and on-chain datum verify.
      }
    }
  }

  return discovered;
}
