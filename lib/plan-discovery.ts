import {
  datumJsonToCbor,
  getAddressDetails,
  type Assets,
  type LucidEvolution,
  type UTxO,
} from "@lucid-evolution/lucid";
import { applyVault } from "./contract";
import { withCardanoReadRetry } from "./cardano-errors";
import {
  BATON_DISCOVERY_LABEL,
  CARDANO_NETWORK,
  KOIOS_URL,
} from "./config";
import { parseManifest, type VaultManifest } from "./manifest";
import { SUPPORTED_RECEIPT_NAMES } from "./protocol-names";
import {
  decodeVaultDatum,
  validateConfirmedVaultDatum,
} from "./vault-state";

export type PlanRole = "owner" | "check-in" | "recipient" | "recovery holder";

type KoiosAsset = {
  policy_id: string;
  asset_name: string;
  quantity: string;
};

type KoiosInput = {
  tx_hash: string;
  tx_index: number;
  payment_addr?: { bech32: string } | null;
  asset_list?: KoiosAsset[];
};

type KoiosOutput = {
  tx_hash?: string;
  tx_index?: number;
  value: string;
  payment_addr: { bech32: string } | null;
  inline_datum: { bytes: string | null; value?: unknown } | null;
  asset_list: KoiosAsset[];
};

export type KoiosCreationTransaction = {
  tx_hash: string;
  tx_timestamp?: number;
  inputs: KoiosInput[];
  outputs: KoiosOutput[];
  assets_minted: KoiosAsset[];
  metadata: Record<string, unknown> | null;
};

export type KoiosAssetTransaction = {
  tx_hash: string;
  block_height: number;
  block_time: number;
};

export type PlanHistoryEntry = {
  kind: "created" | "check-in" | "completed";
  txHash: string;
  confirmedAtMs: number;
  sequence: number;
};

export type PlanHistoryHead =
  | {
      kind: "active";
      txHash: string;
      outputIndex: number;
      sequence: number;
    }
  | {
      kind: "completed";
      txHash: string;
      outputIndex: number;
    };

type KoiosMetadataTransaction = {
  tx_hash: string;
};

type KoiosCredentialTransaction = {
  tx_hash: string;
};

function koiosReadError(response: Response, fallback: string) {
  if (response.status === 429) {
    return new Error("Cardano provider returned 429 Too Many Requests.");
  }
  if (response.status === 408 || response.status >= 500) {
    return new Error(
      `Cardano provider could not be reached (HTTP ${response.status}).`,
    );
  }
  return new Error(fallback);
}

async function fetchKoiosRead(
  request: () => Promise<Response>,
  fallback: string,
) {
  return withCardanoReadRetry(async () => {
    const response = await request();
    if (!response.ok) throw koiosReadError(response, fallback);
    return response;
  }, 3);
}

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
  const response = await fetchKoiosRead(
    () => fetch(`${KOIOS_URL}/tx_info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        _tx_hashes: txHashes,
        _inputs: true,
        _assets: true,
        _metadata: true,
        _scripts: true,
      }),
    }),
    "Cardano did not return the requested plan transactions.",
  );
  return response.json() as Promise<KoiosCreationTransaction[]>;
}

async function fetchAssetTransactionHistory(manifest: VaultManifest) {
  const rows: KoiosAssetTransaction[] = [];
  const assetName = manifest.receiptUnit.slice(56);
  const pageSize = 1_000;
  const maximumRows = 10_000;

  for (let offset = 0; offset < maximumRows; offset += pageSize) {
    const response = await fetchKoiosRead(
      () => fetch(
        `${KOIOS_URL}/asset_txs?_asset_policy=${manifest.policyId}&_asset_name=${assetName}&_history=true`,
        {
          headers: { Range: `${offset}-${offset + pageSize - 1}` },
          cache: "no-store",
        },
      ),
      "Baton could not read this plan's transaction history.",
    );
    const page = await response.json() as KoiosAssetTransaction[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }

  throw new Error("This plan has more than 10,000 history entries; use an indexer to review the complete chain.");
}

function historyOutput(
  transaction: KoiosCreationTransaction,
  unit: string,
  address?: string,
) {
  return transaction.outputs.find(
    (output) =>
      (!address || output.payment_addr?.bech32 === address) &&
      assetQuantity(output.asset_list ?? [], unit) === 1n,
  );
}

function consumesPreviousState(
  transaction: KoiosCreationTransaction,
  previous: { txHash: string; outputIndex: number },
  manifest: VaultManifest,
) {
  return transaction.inputs.some(
    (input) =>
      input.tx_hash === previous.txHash &&
      input.tx_index === previous.outputIndex &&
      input.payment_addr?.bech32 === manifest.validatorAddress &&
      assetQuantity(input.asset_list ?? [], manifest.receiptUnit) === 1n,
  );
}

function historyTimestamp(row: KoiosAssetTransaction) {
  if (!Number.isSafeInteger(row.block_time) || row.block_time <= 0) {
    throw new Error("Cardano returned an invalid plan-history timestamp.");
  }
  return row.block_time * 1_000;
}

/**
 * Verify the indexed asset timeline against the immutable manifest, canonical
 * datum schema, receipt mint/burn shape, and the exact UTxO chain currently
 * reported by Cardano. Public indexer rows are treated only as candidates.
 */
export function verifyPlanHistory(
  manifest: VaultManifest,
  indexedRows: KoiosAssetTransaction[],
  transactions: KoiosCreationTransaction[],
  head: PlanHistoryHead,
): PlanHistoryEntry[] {
  const contract = applyVault(manifest.seed, manifest.receiptName, CARDANO_NETWORK);
  if (
    contract.policyId !== manifest.policyId ||
    contract.receiptUnit !== manifest.receiptUnit ||
    contract.terminalReceiptUnit !== manifest.terminalReceiptUnit ||
    contract.address !== manifest.validatorAddress
  ) {
    throw new Error("Plan history does not reproduce the manifest's validator.");
  }

  const transactionByHash = new Map(
    transactions.map((transaction) => [transaction.tx_hash, transaction]),
  );
  const rows = [...indexedRows].sort(
    (left, right) => left.block_height - right.block_height,
  );
  if (rows.length === 0 || rows[0].tx_hash !== manifest.creationTx) {
    throw new Error("Plan history does not begin with the manifest's creation transaction.");
  }

  const history: PlanHistoryEntry[] = [];
  let previous: { txHash: string; outputIndex: number } | null = null;
  let expectedSequence = 0;
  let terminal: { txHash: string; outputIndex: number } | null = null;

  for (const row of rows) {
    if (!/^[0-9a-f]{64}$/.test(row.tx_hash)) {
      throw new Error("Cardano returned a malformed plan-history transaction ID.");
    }
    const transaction = transactionByHash.get(row.tx_hash);
    if (!transaction) {
      throw new Error("Cardano omitted details for a plan-history transaction.");
    }
    if (previous && !consumesPreviousState(transaction, previous, manifest)) {
      throw new Error("Plan history contains a transaction outside the canonical receipt chain.");
    }

    const activeOutput = historyOutput(
      transaction,
      manifest.receiptUnit,
      manifest.validatorAddress,
    );
    if (activeOutput) {
      if (terminal) throw new Error("Plan history continues after its completion receipt.");
      const outputIndex = activeOutput.tx_index;
      if (typeof outputIndex !== "number" || !Number.isInteger(outputIndex) || !activeOutput.inline_datum) {
        throw new Error("Plan history contains an incomplete canonical state output.");
      }
      const datumCbor = inlineDatumCbor(activeOutput);
      if (!datumCbor) throw new Error("Plan history state has no inline datum.");
      const datum = validateConfirmedVaultDatum(manifest, datumCbor);
      if (datum.sequence !== expectedSequence) {
        throw new Error("Plan history contains a missing or out-of-order check-in sequence.");
      }
      const mintedReceipt = assetQuantity(
        transaction.assets_minted ?? [],
        manifest.receiptUnit,
      );
      if (
        (expectedSequence === 0 && mintedReceipt !== 1n) ||
        (expectedSequence > 0 && mintedReceipt !== 0n)
      ) {
        throw new Error("Plan history has an invalid active-receipt mint shape.");
      }
      history.push({
        kind: expectedSequence === 0 ? "created" : "check-in",
        txHash: row.tx_hash,
        confirmedAtMs: historyTimestamp(row),
        sequence: expectedSequence,
      });
      previous = { txHash: row.tx_hash, outputIndex };
      expectedSequence += 1;
      continue;
    }

    const terminalOutput = historyOutput(transaction, manifest.terminalReceiptUnit);
    const terminalOutputIndex = terminalOutput?.tx_index;
    if (
      !previous ||
      !terminalOutput ||
      typeof terminalOutputIndex !== "number" ||
      !Number.isInteger(terminalOutputIndex) ||
      assetQuantity(transaction.assets_minted ?? [], manifest.receiptUnit) !== -1n ||
      assetQuantity(transaction.assets_minted ?? [], manifest.terminalReceiptUnit) !== 1n
    ) {
      throw new Error("Plan history contains an invalid completion transition.");
    }
    terminal = { txHash: row.tx_hash, outputIndex: terminalOutputIndex };
    history.push({
      kind: "completed",
      txHash: row.tx_hash,
      confirmedAtMs: historyTimestamp(row),
      sequence: expectedSequence - 1,
    });
  }

  if (head.kind === "active") {
    if (
      terminal ||
      !previous ||
      previous.txHash !== head.txHash ||
      previous.outputIndex !== head.outputIndex ||
      expectedSequence - 1 !== head.sequence
    ) {
      throw new Error("Plan history does not end at the current active state.");
    }
  } else if (
    !terminal ||
    terminal.txHash !== head.txHash ||
    terminal.outputIndex !== head.outputIndex
  ) {
    throw new Error("Plan history does not end at the current completion receipt.");
  }

  return history;
}

export async function readPlanHistory(
  manifest: VaultManifest,
  head: PlanHistoryHead,
) {
  const indexedRows = await fetchAssetTransactionHistory(manifest);
  const transactions: KoiosCreationTransaction[] = [];
  const hashes = [...new Set(indexedRows.map((row) => row.tx_hash))];
  for (let offset = 0; offset < hashes.length; offset += 20) {
    transactions.push(...await fetchTransactionInfo(hashes.slice(offset, offset + 20)));
  }
  return verifyPlanHistory(manifest, indexedRows, transactions, head);
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
  paymentKeyHashes: string | readonly string[],
  walletAssets: Assets = {},
): PlanRole[] {
  const walletCredentials = new Set(
    typeof paymentKeyHashes === "string"
      ? [paymentKeyHashes]
      : paymentKeyHashes,
  );
  const roles: PlanRole[] = [];
  if (walletCredentials.has(manifest.ownerKeyHash)) roles.push("owner");
  if (walletCredentials.has(manifest.livenessKeyHash)) roles.push("check-in");
  if (manifest.releaseMode === "fixed" && manifest.destination) {
    const credential = getAddressDetails(manifest.destination).paymentCredential;
    if (
      credential?.type === "Key" &&
      walletCredentials.has(credential.hash)
    ) {
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
  paymentKeyHashes: string | readonly string[],
) {
  const walletCredentials = [...new Set(
    typeof paymentKeyHashes === "string"
      ? [paymentKeyHashes]
      : paymentKeyHashes,
  )];
  const [walletUtxos, metadataResponse, credentialResponse] = await Promise.all([
    lucid.wallet().getUtxos(),
    fetchKoiosRead(
      () => fetch(`${KOIOS_URL}/tx_by_metalabel?_label=${BATON_DISCOVERY_LABEL}`, {
        headers: { Range: "0-999" },
        cache: "no-store",
      }),
      "Baton could not search Cardano for connected plans.",
    ),
    fetchKoiosRead(
      () => fetch(`${KOIOS_URL}/credential_txs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Range: "0-999",
        },
        body: JSON.stringify({ _payment_credentials: walletCredentials }),
        cache: "no-store",
      }),
      "Baton could not search this wallet's Cardano history.",
    ),
  ]);
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
        const roles = rolesForManifest(manifest, walletCredentials, walletAssets);
        if (roles.length > 0) discovered.push({ manifest, roles });
      } catch {
        // Metadata labels are public and can be spoofed. Invalid candidates are
        // ignored unless their applied validator and on-chain datum verify.
      }
    }
  }

  return discovered;
}
