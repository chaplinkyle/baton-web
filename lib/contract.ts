import {
  applyDoubleCborEncoding,
  applyParamsToScript,
  Constr,
  Data,
  fromText,
  getAddressDetails,
  validatorToAddress,
  validatorToScriptHash,
  type Address,
  type Assets,
  type Network,
  type OutRef,
  type Script,
} from "@lucid-evolution/lucid";
import blueprint from "./plutus.json";
import legacyRc9Blueprint from "./plutus.rc9.json";
import {
  BATON_RECEIPT_NAMES,
  receiptNamesFor,
} from "./protocol-names";

const batonValidator = (() => {
  const found = blueprint.validators.find(
    (candidate) => candidate.title === "baton.baton.spend",
  );
  if (!found) throw new Error("Baton validator missing from blueprint");
  return found;
})();

const legacyRc9Validator = (() => {
  const found = legacyRc9Blueprint.validators.find(
    (candidate) => candidate.title === "last_signal.last_signal.spend",
  );
  if (!found) throw new Error("Legacy rc.9 validator missing from compatibility blueprint");
  return found;
})();

export type AppliedVault = {
  mintingPolicy: Script;
  spendingValidator: Script;
  policyId: string;
  receiptUnit: string;
  terminalReceiptUnit: string;
  recoveryReceiptUnit: string;
  receiptName: string;
  terminalReceiptName: string;
  recoveryReceiptName: string;
  address: string;
  parameterizedCode: string;
};

export type ReleaseRule =
  | { kind: "fixed"; address: Address }
  | { kind: "bearer"; policyId: string; assetName: string };

export type VaultDatumInput = {
  ownerKeyHash: string;
  livenessKeyHash: string;
  checkInPeriodMs: number;
  missesToRelease: number;
  lastCheckInAtMs: number;
  releaseRule: ReleaseRule;
  sequence?: number;
  payloadCommitment?: string;
};

function credentialData(credential: { type: "Key" | "Script"; hash: string }) {
  return new Constr(credential.type === "Key" ? 0 : 1, [credential.hash]);
}

export function addressData(address: Address) {
  const details = getAddressDetails(address);
  if (!details.paymentCredential) {
    throw new Error("A Byron or reward-only address cannot receive this vault");
  }

  const payment = credentialData(details.paymentCredential);
  const stake = details.stakeCredential
    ? new Constr(0, [new Constr(0, [credentialData(details.stakeCredential)])])
    : new Constr(1, []);

  return new Constr(0, [payment, stake]);
}

export function applyVault(
  seed: OutRef,
  receiptName: string,
  network: Network,
): AppliedVault {
  const names = receiptNamesFor(receiptName);
  if (!names) throw new Error("Unsupported Baton receipt name.");
  const validator = names === BATON_RECEIPT_NAMES
    ? batonValidator
    : legacyRc9Validator;
  const outputReference = new Constr(0, [
    seed.txHash,
    BigInt(seed.outputIndex),
  ]);
  const receiptNameHex = fromText(receiptName);
  const terminalReceiptNameHex = fromText(names.complete);
  const recoveryReceiptNameHex = fromText(names.recovery);
  const parameterizedCode = applyParamsToScript(validator.compiledCode, [
    outputReference,
    receiptNameHex,
  ]);
  const rawScript: Script = { type: "PlutusV3", script: parameterizedCode };
  const attachedScript: Script = {
    type: "PlutusV3",
    script: applyDoubleCborEncoding(parameterizedCode),
  };
  const policyId = validatorToScriptHash(rawScript);

  return {
    mintingPolicy: attachedScript,
    spendingValidator: attachedScript,
    policyId,
    receiptUnit: `${policyId}${receiptNameHex}`,
    terminalReceiptUnit: `${policyId}${terminalReceiptNameHex}`,
    recoveryReceiptUnit: `${policyId}${recoveryReceiptNameHex}`,
    receiptName: names.active,
    terminalReceiptName: names.complete,
    recoveryReceiptName: names.recovery,
    address: validatorToAddress(network, rawScript),
    parameterizedCode,
  };
}

export function encodeVaultDatum(input: VaultDatumInput) {
  const releasePolicy =
    input.releaseRule.kind === "fixed"
      ? new Constr(0, [
          addressData(input.releaseRule.address),
          new Constr(0, []),
        ])
      : new Constr(1, [
          input.releaseRule.policyId,
          input.releaseRule.assetName,
        ]);

  const payload = input.payloadCommitment
    ? new Constr(0, [input.payloadCommitment])
    : new Constr(1, []);

  return Data.to(
    new Constr(0, [
      1n,
      input.ownerKeyHash,
      input.livenessKeyHash,
      BigInt(input.checkInPeriodMs),
      BigInt(input.missesToRelease),
      BigInt(input.lastCheckInAtMs),
      releasePolicy,
      BigInt(input.sequence ?? 0),
      payload,
    ]),
  );
}

export const mintReceiptRedeemer = Data.to(new Constr(0, []));
export const finalizeReceiptRedeemer = Data.to(new Constr(1, []));

export function pulseRedeemer(newCheckInAtMs: number) {
  return Data.to(new Constr(0, [BigInt(newCheckInAtMs)]));
}

export const closeRedeemer = Data.to(new Constr(1, []));

export function releaseRedeemer(payoutAddress: Address) {
  return Data.to(new Constr(2, [addressData(payoutAddress)]));
}

export function withReceipt(assets: Assets, receiptUnit: string): Assets {
  return { ...assets, [receiptUnit]: 1n };
}

export function withTerminalReceipt(
  assets: Assets,
  receiptUnit: string,
  terminalReceiptUnit: string,
): Assets {
  if (assets[receiptUnit] !== 1n) {
    throw new Error("Active plan state must contain exactly one active receipt.");
  }
  if ((assets[terminalReceiptUnit] ?? 0n) !== 0n) {
    throw new Error("Active plan state cannot already contain a completion receipt.");
  }
  const finalized = { ...assets };
  delete finalized[receiptUnit];
  finalized[terminalReceiptUnit] = 1n;
  return finalized;
}
