import {
  CML,
  getAddressDetails,
  valueToAssets,
  type Assets,
  type LucidEvolution,
  type TxSignBuilder,
  type UTxO,
} from "@lucid-evolution/lucid";
import {
  applyVault,
  encodeVaultDatum,
  mintReceiptRedeemer,
  withReceipt,
  type AppliedVault,
  type ReleaseRule,
} from "./contract";
import {
  BATON_DISCOVERY_LABEL,
  CARDANO_NETWORK,
  EXPECTED_NETWORK_ID,
  RECEIPT_NAME,
  TREASURY_ADDRESS,
} from "./config";
import {
  MAX_VALIDITY_WINDOW_MS,
  SITE_FEE_LOVELACE,
  VALIDITY_START_BUFFER_MS,
} from "./product";
import type { EternlConnection } from "./eternl";
import { signAndSubmitVerified } from "./wallet-signing";

export type CreationRequest = {
  protectedAssets: Assets;
  livenessAddress: string;
  checkInPeriodMs: number;
  missesToRelease: number;
  releaseRule: CreationReleaseRule;
  payloadCommitment?: string;
};

export type CreationReleaseRule =
  | { kind: "fixed"; address: string }
  | { kind: "bearer" };

export type CreationReview = {
  contract: AppliedVault;
  draft: TxSignBuilder;
  seed: UTxO;
  ownerKeyHash: string;
  livenessKeyHash: string;
  validFrom: number;
  validTo: number;
  lastCheckInAt: number;
  releaseAt: number;
  feeLovelace: bigint;
  minimumAdaLovelace: bigint;
  protectedAssets: Assets;
  transactionHash: string;
  transactionCbor: string;
  transactionBytes: number;
  siteFeeLovelace: bigint;
  checkInPeriodMs: number;
  missesToRelease: number;
  releaseRule: ReleaseRule;
  payloadCommitment?: string;
};

type InterfaceFee = { address: string; lovelace: bigint } | null;

function addressDetailsOnConfiguredNetwork(label: string, address: string) {
  let details: ReturnType<typeof getAddressDetails>;
  try {
    details = getAddressDetails(address);
  } catch {
    throw new Error(`${label} is not a valid Cardano address.`);
  }
  if (details.networkId !== EXPECTED_NETWORK_ID) {
    throw new Error(`${label} is not valid for ${CARDANO_NETWORK}.`);
  }
  return details;
}

function validateCreationRequest(request: CreationRequest, nowMs: number) {
  if (!Number.isSafeInteger(request.checkInPeriodMs) || request.checkInPeriodMs <= 0) {
    throw new Error("Check-in period must be a positive whole number of milliseconds.");
  }
  if (
    !Number.isInteger(request.missesToRelease) ||
    request.missesToRelease < 1 ||
    request.missesToRelease > 1_000
  ) {
    throw new Error("Allowed misses must be a whole number from 1 through 1,000.");
  }
  const releaseAt = nowMs + request.checkInPeriodMs * request.missesToRelease;
  if (!Number.isSafeInteger(releaseAt)) {
    throw new Error("The selected schedule exceeds the supported timestamp range.");
  }
  if ((request.protectedAssets.lovelace ?? 0n) <= 0n) {
    throw new Error("The protected bundle must include positive lovelace for its Cardano output.");
  }
  if (Object.values(request.protectedAssets).some((quantity) => quantity <= 0n)) {
    throw new Error("Every protected asset quantity must be positive.");
  }
  for (const unit of Object.keys(request.protectedAssets)) {
    if (
      unit !== "lovelace" &&
      !/^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/i.test(unit)
    ) {
      throw new Error("A protected native-asset unit is malformed.");
    }
  }
  if (
    request.payloadCommitment &&
    !/^[0-9a-f]{64}$/i.test(request.payloadCommitment)
  ) {
    throw new Error("Payload commitment must be one SHA-256 hash.");
  }
  if (request.releaseRule.kind === "fixed") {
    addressDetailsOnConfiguredNetwork("Fixed destination", request.releaseRule.address);
  }
}

function assetsEqual(left: Assets, right: Assets) {
  const units = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...units].every((unit) => (left[unit] ?? 0n) === (right[unit] ?? 0n));
}

export async function buildCreation(
  lucid: LucidEvolution,
  request: CreationRequest,
  nowMs = Date.now(),
): Promise<CreationReview> {
  if (!TREASURY_ADDRESS) {
    throw new Error(
      "Creation is intentionally disabled until the operator treasury address is pinned in the release configuration.",
    );
  }
  return buildCreationTransaction(
    lucid,
    request,
    { address: TREASURY_ADDRESS, lovelace: SITE_FEE_LOVELACE },
    nowMs,
  );
}

/** Build directly against the open validator without any interface fee. */
export async function buildDirectCreation(
  lucid: LucidEvolution,
  request: CreationRequest,
  nowMs = Date.now(),
): Promise<CreationReview> {
  return buildCreationTransaction(lucid, request, null, nowMs);
}

async function buildCreationTransaction(
  lucid: LucidEvolution,
  request: CreationRequest,
  interfaceFee: InterfaceFee,
  nowMs: number,
): Promise<CreationReview> {

  validateCreationRequest(request, nowMs);
  if (interfaceFee) {
    addressDetailsOnConfiguredNetwork("Operator treasury address", interfaceFee.address);
  }

  const address = await lucid.wallet().address();
  const ownerCredential = addressDetailsOnConfiguredNetwork(
    "Owner address",
    address,
  ).paymentCredential;
  const livenessCredential = addressDetailsOnConfiguredNetwork(
    "Liveness address",
    request.livenessAddress,
  ).paymentCredential;
  if (!ownerCredential || ownerCredential.type !== "Key") {
    throw new Error("Owner address must use a key payment credential.");
  }
  if (!livenessCredential || livenessCredential.type !== "Key") {
    throw new Error("Liveness address must use a key payment credential.");
  }
  if (ownerCredential.hash === livenessCredential.hash) {
    throw new Error("Owner and liveness keys must be separate in version one.");
  }

  const utxos = await lucid.wallet().getUtxos();
  const seed = utxos.find((utxo) => !utxo.scriptRef) ?? utxos[0];
  if (!seed) throw new Error("The connected wallet has no spendable UTxO.");

  const contract = applyVault(seed, RECEIPT_NAME, CARDANO_NETWORK);
  const releaseRule: ReleaseRule = request.releaseRule.kind === "fixed"
    ? request.releaseRule
    : {
        kind: "bearer",
        policyId: contract.policyId,
        assetName: contract.recoveryReceiptUnit.slice(56),
      };

  const validFrom = lucid.slotToUnixTime(
    Math.max(0, lucid.unixTimeToSlot(nowMs - VALIDITY_START_BUFFER_MS)),
  );
  const lastCheckInAt = lucid.slotToUnixTime(
    lucid.unixTimeToSlot(nowMs + MAX_VALIDITY_WINDOW_MS - 60_000),
  );
  const datum = encodeVaultDatum({
    ownerKeyHash: ownerCredential.hash,
    livenessKeyHash: livenessCredential.hash,
    checkInPeriodMs: request.checkInPeriodMs,
    missesToRelease: request.missesToRelease,
    lastCheckInAtMs: lastCheckInAt,
    releaseRule,
    payloadCommitment: request.payloadCommitment,
  });

  const creationMint: Assets = releaseRule.kind === "bearer"
    ? {
        [contract.receiptUnit]: 1n,
        [contract.recoveryReceiptUnit]: 1n,
      }
    : { [contract.receiptUnit]: 1n };
  let builder = lucid
    .newTx()
    .collectFrom([seed])
    .mintAssets(creationMint, mintReceiptRedeemer)
    .pay.ToContract(
      contract.address,
      { kind: "inline", value: datum },
      withReceipt(request.protectedAssets, contract.receiptUnit),
    )
    .addSignerKey(ownerCredential.hash)
    .validFrom(validFrom)
    .validTo(lastCheckInAt)
    .attachMetadata(BATON_DISCOVERY_LABEL, {
      app: "baton",
      version: 1,
    })
    .attach.MintingPolicy(contract.mintingPolicy);
  if (releaseRule.kind === "bearer") {
    builder = builder.pay.ToAddress(address, {
      [contract.recoveryReceiptUnit]: 1n,
    });
  }
  if (interfaceFee) {
    builder = builder.pay.ToAddress(interfaceFee.address, {
      lovelace: interfaceFee.lovelace,
    });
  }
  const draft = await builder.complete();

  const transaction = draft.toTransaction();
  const feeLovelace = BigInt(transaction.body().fee().toString());
  const outputs = transaction.body().outputs();
  const coinsPerUtxoByte = lucid.config().protocolParameters?.coinsPerUtxoByte;
  if (coinsPerUtxoByte === undefined) {
    throw new Error("Cardano protocol parameters are unavailable for the minimum-ADA review.");
  }
  const receiptOutputs: Assets[] = [];
  const recoveryOutputs: Array<{ address: string; assets: Assets }> = [];
  let minimumAdaLovelace: bigint | null = null;
  let hasExactSiteFeeOutput = interfaceFee === null;
  for (let index = 0; index < outputs.len(); index += 1) {
    const output = outputs.get(index);
    const outputAssets = valueToAssets(output.amount());
    const outputAddress = output.address().to_bech32();
    if (outputAssets[contract.receiptUnit] === 1n) {
      if (outputAddress !== contract.address) {
        throw new Error("Constructed receipt NFT output is not at the expected vault address.");
      }
      receiptOutputs.push(outputAssets);
      minimumAdaLovelace = CML.min_ada_required(output, coinsPerUtxoByte);
    }
    if (outputAssets[contract.recoveryReceiptUnit] === 1n) {
      recoveryOutputs.push({ address: outputAddress, assets: outputAssets });
    }
    if (
      interfaceFee &&
      outputAddress === interfaceFee.address &&
      outputAssets.lovelace === interfaceFee.lovelace &&
      Object.keys(outputAssets).length === 1
    ) {
      hasExactSiteFeeOutput = true;
    }
  }
  if (receiptOutputs.length !== 1) {
    throw new Error("Constructed transaction does not contain one canonical vault output.");
  }
  if (minimumAdaLovelace === null) {
    throw new Error("Constructed transaction is missing its minimum-ADA calculation.");
  }
  if (!assetsEqual(receiptOutputs[0], withReceipt(request.protectedAssets, contract.receiptUnit))) {
    throw new Error("Constructed vault output differs from the exact protected bundle requested.");
  }
  if (releaseRule.kind === "bearer") {
    if (recoveryOutputs.length !== 1 || recoveryOutputs[0].address !== address) {
      throw new Error("Constructed transaction does not deliver one recovery token to the owner.");
    }
    if ((receiptOutputs[0][contract.recoveryReceiptUnit] ?? 0n) !== 0n) {
      throw new Error("Constructed transaction incorrectly locks the recovery token in the vault.");
    }
  } else if (recoveryOutputs.length !== 0) {
    throw new Error("A fixed-destination plan must not mint a recovery token.");
  }
  if (!hasExactSiteFeeOutput) {
    throw new Error("Constructed transaction does not contain the disclosed exact 5 ADA site fee output.");
  }

  return {
    contract,
    draft,
    seed,
    ownerKeyHash: ownerCredential.hash,
    livenessKeyHash: livenessCredential.hash,
    validFrom,
    validTo: lastCheckInAt,
    lastCheckInAt,
    releaseAt:
      lastCheckInAt + request.checkInPeriodMs * request.missesToRelease,
    feeLovelace,
    minimumAdaLovelace,
    protectedAssets: request.protectedAssets,
    transactionHash: draft.toHash(),
    transactionCbor: draft.toCBOR({ canonical: true }),
    transactionBytes: draft.toCBOR({ canonical: true }).length / 2,
    siteFeeLovelace: interfaceFee?.lovelace ?? 0n,
    checkInPeriodMs: request.checkInPeriodMs,
    missesToRelease: request.missesToRelease,
    releaseRule,
    payloadCommitment: request.payloadCommitment,
  };
}

export async function signAndSubmitCreation(
  review: CreationReview,
  connection?: Pick<EternlConnection, "api" | "lucid">,
) {
  return signAndSubmitVerified(review, review.ownerKeyHash, connection);
}
