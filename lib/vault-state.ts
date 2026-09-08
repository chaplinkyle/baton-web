import {
  Constr,
  Data,
  Koios,
  Lucid,
  credentialToAddress,
  getAddressDetails,
  type Assets,
  type Credential,
  type LucidEvolution,
  type TxSignBuilder,
  type UTxO,
} from "@lucid-evolution/lucid";
import { withCardanoReadRetry } from "./cardano-errors";
import {
  applyVault,
  closeRedeemer,
  encodeVaultDatum,
  finalizeReceiptRedeemer,
  pulseRedeemer,
  releaseRedeemer,
  withTerminalReceipt,
  type ReleaseRule,
} from "./contract";
import { CARDANO_NETWORK, KOIOS_URL } from "./config";
import {
  MAX_VALIDITY_WINDOW_MS,
  VALIDITY_START_BUFFER_MS,
  releaseAt,
} from "./product";
import {
  manifestReleaseRule,
  type VaultManifest,
} from "./manifest";

export type ConfirmedVaultState = {
  utxo: UTxO;
  lastCheckInAtMs: number;
  sequence: number;
  releaseAtMs: number;
};

export type CompletedVaultState = {
  utxo: UTxO;
};

export type VaultLifecycle =
  | { kind: "active"; state: ConfirmedVaultState }
  | { kind: "completed"; state: CompletedVaultState };

function asConstr(value: unknown, label: string): Constr<unknown> {
  if (!(value instanceof Constr)) throw new Error(`${label} is not constructor data.`);
  return value as Constr<unknown>;
}

function asSafeNumber(value: unknown, label: string) {
  if (typeof value !== "bigint") throw new Error(`${label} is not an integer.`);
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds browser-safe range.`);
  return result;
}

function asHex(value: unknown, label: string, bytes?: number) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]*$/i.test(value) ||
    value.length % 2 !== 0 ||
    (bytes !== undefined && value.length !== bytes * 2)
  ) {
    throw new Error(`${label} is not a valid byte string.`);
  }
  return value.toLowerCase();
}

function decodeCredential(value: unknown, label: string): Credential {
  const credential = asConstr(value, label);
  if ((credential.index !== 0 && credential.index !== 1) || credential.fields.length !== 1) {
    throw new Error(`${label} has an unsupported credential shape.`);
  }
  return {
    type: credential.index === 0 ? "Key" : "Script",
    hash: asHex(credential.fields[0], `${label} hash`, 28),
  };
}

function decodeAddress(value: unknown) {
  const address = asConstr(value, "Fixed destination");
  if (address.index !== 0 || address.fields.length !== 2) {
    throw new Error("Fixed destination has an unsupported address shape.");
  }
  const payment = decodeCredential(address.fields[0], "Fixed destination payment credential");
  const stakeOption = asConstr(address.fields[1], "Fixed destination stake credential");
  let stake: Credential | undefined;
  if (stakeOption.index === 0 && stakeOption.fields.length === 1) {
    const inline = asConstr(stakeOption.fields[0], "Fixed destination inline stake credential");
    if (inline.index !== 0 || inline.fields.length !== 1) {
      throw new Error("Pointer stake addresses are not supported by Baton discovery.");
    }
    stake = decodeCredential(inline.fields[0], "Fixed destination stake credential");
  } else if (stakeOption.index !== 1 || stakeOption.fields.length !== 0) {
    throw new Error("Fixed destination has an unsupported stake option.");
  }
  return credentialToAddress(CARDANO_NETWORK, payment, stake);
}

export type DecodedVaultDatum = {
  ownerKeyHash: string;
  livenessKeyHash: string;
  checkInPeriodMs: number;
  missesToRelease: number;
  lastCheckInAtMs: number;
  sequence: number;
  releaseRule: ReleaseRule;
  payloadCommitment?: string;
};

export function decodeVaultDatum(datumCbor: string): DecodedVaultDatum {
  const root = asConstr(Data.from(datumCbor), "Vault datum");
  if (root.index !== 0 || root.fields.length !== 9) throw new Error("Unexpected vault datum schema.");
  const version = asSafeNumber(root.fields[0], "Vault version");
  if (version !== 1) throw new Error("Unsupported on-chain vault version.");

  const release = asConstr(root.fields[6], "Release policy");
  let releaseRule: ReleaseRule;
  if (release.index === 0 && release.fields.length === 2) {
    const payoutDatum = asConstr(release.fields[1], "Fixed destination payout datum");
    if (payoutDatum.index !== 0 || payoutDatum.fields.length !== 0) {
      throw new Error("Baton discovery does not support a fixed destination with inline payout data.");
    }
    releaseRule = { kind: "fixed", address: decodeAddress(release.fields[0]) };
  } else if (release.index === 1 && release.fields.length === 2) {
    releaseRule = {
      kind: "bearer",
      policyId: asHex(release.fields[0], "Recovery policy ID", 28),
      assetName: asHex(release.fields[1], "Recovery asset name"),
    };
  } else {
    throw new Error("Vault datum has an unsupported release policy.");
  }

  const payload = asConstr(root.fields[8], "Payload commitment");
  let payloadCommitment: string | undefined;
  if (payload.index === 0 && payload.fields.length === 1) {
    payloadCommitment = asHex(payload.fields[0], "Payload commitment", 32);
  } else if (payload.index !== 1 || payload.fields.length !== 0) {
    throw new Error("Vault datum has an unsupported payload commitment.");
  }

  return {
    ownerKeyHash: asHex(root.fields[1], "Owner key hash", 28),
    livenessKeyHash: asHex(root.fields[2], "Liveness key hash", 28),
    checkInPeriodMs: asSafeNumber(root.fields[3], "Check-in period"),
    missesToRelease: asSafeNumber(root.fields[4], "Miss threshold"),
    lastCheckInAtMs: asSafeNumber(root.fields[5], "Last check-in"),
    releaseRule,
    sequence: asSafeNumber(root.fields[7], "Sequence"),
    payloadCommitment,
  };
}

export function decodeStateClock(datumCbor: string) {
  const datum = decodeVaultDatum(datumCbor);
  return {
    ownerKeyHash: datum.ownerKeyHash,
    livenessKeyHash: datum.livenessKeyHash,
    checkInPeriodMs: datum.checkInPeriodMs,
    missesToRelease: datum.missesToRelease,
    lastCheckInAtMs: datum.lastCheckInAtMs,
    sequence: datum.sequence,
  };
}

export async function readOnlyLucid() {
  return withCardanoReadRetry(
    () => Lucid(new Koios(KOIOS_URL), CARDANO_NETWORK),
  );
}

function reproduceContract(manifest: VaultManifest) {
  if (manifest.network !== CARDANO_NETWORK) {
    throw new Error(`Manifest is for ${manifest.network}; this release is ${CARDANO_NETWORK}.`);
  }
  const contract = applyVault(manifest.seed, manifest.receiptName, CARDANO_NETWORK);
  if (
    contract.policyId !== manifest.policyId ||
    contract.receiptUnit !== manifest.receiptUnit ||
    contract.terminalReceiptUnit !== manifest.terminalReceiptUnit ||
    contract.address !== manifest.validatorAddress
  ) {
    throw new Error("Manifest does not reproduce the pinned parameterized validator.");
  }
  return contract;
}

export async function readConfirmedVault(
  lucid: LucidEvolution,
  manifest: VaultManifest,
): Promise<ConfirmedVaultState> {
  reproduceContract(manifest);
  const utxo = await withCardanoReadRetry(
    () => lucid.utxoByUnit(manifest.receiptUnit),
    3,
  );
  if (!utxo.datum) throw new Error("Receipt UTxO has no inline datum.");
  const clock = decodeStateClock(utxo.datum);
  if (
    clock.ownerKeyHash !== manifest.ownerKeyHash ||
    clock.livenessKeyHash !== manifest.livenessKeyHash ||
    clock.checkInPeriodMs !== manifest.checkInPeriodMs ||
    clock.missesToRelease !== manifest.missesToRelease
  ) {
    throw new Error("Confirmed datum disagrees with immutable manifest fields.");
  }
  const expectedDatum = encodeVaultDatum({
    ownerKeyHash: manifest.ownerKeyHash,
    livenessKeyHash: manifest.livenessKeyHash,
    checkInPeriodMs: manifest.checkInPeriodMs,
    missesToRelease: manifest.missesToRelease,
    lastCheckInAtMs: clock.lastCheckInAtMs,
    releaseRule: manifestReleaseRule(manifest),
    sequence: clock.sequence,
    payloadCommitment: manifest.payloadCommitment,
  });
  if (expectedDatum !== utxo.datum) {
    throw new Error("Confirmed datum contains release or payload fields not represented by this manifest.");
  }
  return {
    utxo,
    lastCheckInAtMs: clock.lastCheckInAtMs,
    sequence: clock.sequence,
    releaseAtMs: releaseAt(
      clock.lastCheckInAtMs,
      manifest.checkInPeriodMs,
      manifest.missesToRelease,
    ),
  };
}

export async function readVaultLifecycle(
  lucid: LucidEvolution,
  manifest: VaultManifest,
): Promise<VaultLifecycle> {
  reproduceContract(manifest);
  try {
    return { kind: "active", state: await readConfirmedVault(lucid, manifest) };
  } catch (activeError) {
    try {
      const utxo = await withCardanoReadRetry(
        () => lucid.utxoByUnit(manifest.terminalReceiptUnit),
        3,
      );
      if (
        utxo.assets[manifest.terminalReceiptUnit] !== 1n ||
        (utxo.assets[manifest.receiptUnit] ?? 0n) !== 0n
      ) {
        throw new Error("Completion receipt UTxO has an invalid receipt balance.");
      }
      return { kind: "completed", state: { utxo } };
    } catch {
      throw activeError;
    }
  }
}

export type ActionReview = {
  action: "pulse" | "close" | "release";
  draft: TxSignBuilder;
  feeLovelace: bigint;
  transactionHash: string;
  transactionBytes: number;
  currentReleaseAt: number;
  newReleaseAt?: number;
  newCheckInAt?: number;
};

/**
 * Match the complete, already-validated CIP-30 account address set so an HD
 * address rotation does not hide a legitimate action. This is only an
 * interface/preparation check: the transaction and validator still require
 * the exact on-chain signing key.
 */
function walletAccountControlsPaymentKey(
  currentPaymentKeyHash: string,
  accountPaymentKeyHashes: readonly string[] | undefined,
  requiredPaymentKeyHash: string,
) {
  return currentPaymentKeyHash === requiredPaymentKeyHash ||
    accountPaymentKeyHashes?.includes(requiredPaymentKeyHash) === true;
}

function completedReview(
  action: ActionReview["action"],
  draft: TxSignBuilder,
  currentReleaseAt: number,
  extra: Pick<ActionReview, "newReleaseAt" | "newCheckInAt"> = {},
): ActionReview {
  return {
    action,
    draft,
    currentReleaseAt,
    ...extra,
    feeLovelace: BigInt(draft.toTransaction().body().fee().toString()),
    transactionHash: draft.toHash(),
    transactionBytes: draft.toCBOR({ canonical: true }).length / 2,
  };
}

export async function buildPulse(
  lucid: LucidEvolution,
  manifest: VaultManifest,
  state: ConfirmedVaultState,
  nowMs = Date.now(),
  accountPaymentKeyHashes?: readonly string[],
) {
  if (nowMs >= state.releaseAtMs) throw new Error("The final release boundary has passed; Pulse is no longer valid.");
  const walletAddress = await lucid.wallet().address();
  const credential = getAddressDetails(walletAddress).paymentCredential;
  if (
    !credential ||
    credential.type !== "Key" ||
    !walletAccountControlsPaymentKey(
      credential.hash,
      accountPaymentKeyHashes,
      manifest.livenessKeyHash,
    )
  ) {
    throw new Error("Connected Eternl account is not the configured liveness key.");
  }
  const contract = applyVault(manifest.seed, manifest.receiptName, CARDANO_NETWORK);
  const validFrom = lucid.slotToUnixTime(
    Math.max(0, lucid.unixTimeToSlot(nowMs - VALIDITY_START_BUFFER_MS)),
  );
  const proposedCheckInAt = Math.min(
    Math.max(
      nowMs + MAX_VALIDITY_WINDOW_MS - 60_000,
      state.lastCheckInAtMs + 1_000,
    ),
    state.releaseAtMs,
  );
  const newCheckInAt = lucid.slotToUnixTime(
    lucid.unixTimeToSlot(proposedCheckInAt),
  );
  const newDatum = encodeVaultDatum({
    ownerKeyHash: manifest.ownerKeyHash,
    livenessKeyHash: manifest.livenessKeyHash,
    checkInPeriodMs: manifest.checkInPeriodMs,
    missesToRelease: manifest.missesToRelease,
    lastCheckInAtMs: newCheckInAt,
    releaseRule: manifestReleaseRule(manifest),
    sequence: state.sequence + 1,
    payloadCommitment: manifest.payloadCommitment,
  });
  const draft = await lucid
    .newTx()
    .collectFrom([state.utxo], pulseRedeemer(newCheckInAt))
    .pay.ToContract(contract.address, { kind: "inline", value: newDatum }, state.utxo.assets)
    .addSignerKey(manifest.livenessKeyHash)
    .validFrom(validFrom)
    .validTo(newCheckInAt)
    .attach.SpendingValidator(contract.spendingValidator)
    .complete();
  return completedReview("pulse", draft, state.releaseAtMs, {
    newCheckInAt,
    newReleaseAt: releaseAt(newCheckInAt, manifest.checkInPeriodMs, manifest.missesToRelease),
  });
}

export async function buildClose(
  lucid: LucidEvolution,
  manifest: VaultManifest,
  state: ConfirmedVaultState,
  nowMs = Date.now(),
  accountPaymentKeyHashes?: readonly string[],
) {
  if (nowMs >= state.releaseAtMs) throw new Error("Owner close is no longer valid after final expiry.");
  const walletAddress = await lucid.wallet().address();
  const credential = getAddressDetails(walletAddress).paymentCredential;
  if (
    !credential ||
    credential.type !== "Key" ||
    !walletAccountControlsPaymentKey(
      credential.hash,
      accountPaymentKeyHashes,
      manifest.ownerKeyHash,
    )
  ) {
    throw new Error("Connected Eternl account is not the configured owner key.");
  }
  const contract = applyVault(manifest.seed, manifest.receiptName, CARDANO_NETWORK);
  const validFrom = lucid.slotToUnixTime(
    Math.max(0, lucid.unixTimeToSlot(nowMs - VALIDITY_START_BUFFER_MS)),
  );
  const validTo = lucid.slotToUnixTime(
    lucid.unixTimeToSlot(
      Math.min(nowMs + MAX_VALIDITY_WINDOW_MS - 60_000, state.releaseAtMs),
    ),
  );
  const payoutAssets = withTerminalReceipt(
    state.utxo.assets,
    contract.receiptUnit,
    contract.terminalReceiptUnit,
  );
  const draft = await lucid
    .newTx()
    .collectFrom([state.utxo], closeRedeemer)
    .mintAssets(
      { [contract.receiptUnit]: -1n, [contract.terminalReceiptUnit]: 1n },
      finalizeReceiptRedeemer,
    )
    .pay.ToAddress(walletAddress, payoutAssets)
    .addSignerKey(manifest.ownerKeyHash)
    .validFrom(validFrom)
    .validTo(validTo)
    .attach.MintingPolicy(contract.mintingPolicy)
    .attach.SpendingValidator(contract.spendingValidator)
    .complete();
  return completedReview("close", draft, state.releaseAtMs);
}

export async function buildRelease(
  lucid: LucidEvolution,
  manifest: VaultManifest,
  state: ConfirmedVaultState,
  nowMs = Date.now(),
) {
  if (nowMs < state.releaseAtMs) throw new Error("Release is not valid before the final missed boundary.");
  const walletAddress = await lucid.wallet().address();
  const contract = applyVault(manifest.seed, manifest.receiptName, CARDANO_NETWORK);
  const payoutAddress = manifest.destination ?? walletAddress;
  let payoutAssets: Assets = withTerminalReceipt(
    state.utxo.assets,
    contract.receiptUnit,
    contract.terminalReceiptUnit,
  );
  let builder = lucid.newTx().collectFrom([state.utxo], releaseRedeemer(payoutAddress));
  if (manifest.releaseMode === "bearer") {
    const recoveryUnit = manifest.recoveryUnit!;
    const recovery = await lucid.wallet().getUtxos();
    const recoveryInput = recovery.find((utxo) => utxo.assets[recoveryUnit] === 1n);
    if (!recoveryInput) throw new Error("Connected Eternl account does not hold the recovery token.");
    builder = builder.collectFrom([recoveryInput]);
    payoutAssets = {
      ...payoutAssets,
      [recoveryUnit]: (payoutAssets[recoveryUnit] ?? 0n) + 1n,
    };
  }
  // Tolerate a client clock slightly ahead of the node without ever making a
  // release valid before the contract's final missed-check-in boundary.
  const requestedLower = Math.max(
    nowMs - VALIDITY_START_BUFFER_MS,
    state.releaseAtMs,
  );
  let lowerSlot = lucid.unixTimeToSlot(requestedLower);
  let validFrom = lucid.slotToUnixTime(lowerSlot);
  if (validFrom < state.releaseAtMs) {
    lowerSlot += 1;
    validFrom = lucid.slotToUnixTime(lowerSlot);
  }
  const validTo = lucid.slotToUnixTime(
    lucid.unixTimeToSlot(nowMs + MAX_VALIDITY_WINDOW_MS - 60_000),
  );
  const draft = await builder
    .mintAssets(
      { [contract.receiptUnit]: -1n, [contract.terminalReceiptUnit]: 1n },
      finalizeReceiptRedeemer,
    )
    .pay.ToAddress(payoutAddress, payoutAssets)
    .validFrom(validFrom)
    .validTo(validTo)
    .attach.MintingPolicy(contract.mintingPolicy)
    .attach.SpendingValidator(contract.spendingValidator)
    .complete();
  return completedReview("release", draft, state.releaseAtMs);
}

export async function signAndSubmitAction(review: ActionReview) {
  const signed = await review.draft.sign.withWallet().complete();
  return signed.submit();
}
