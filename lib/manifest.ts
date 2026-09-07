import type { OutRef } from "@lucid-evolution/lucid";
import { receiptNamesFor } from "./protocol-names.ts";

export type VaultManifest = {
  version: 3;
  network: "Mainnet" | "Preview" | "Preprod";
  creationTx: string;
  seed: OutRef;
  receiptName: string;
  terminalReceiptName: string;
  recoveryReceiptName: string;
  policyId: string;
  receiptUnit: string;
  terminalReceiptUnit: string;
  validatorAddress: string;
  ownerKeyHash: string;
  livenessKeyHash: string;
  checkInPeriodMs: number;
  missesToRelease: number;
  lastCheckInAtMs: number;
  releaseAtMs: number;
  releaseMode: "fixed" | "bearer";
  destination?: string;
  recoveryUnit?: string;
  payloadCommitment?: string;
};

function isHex(value: unknown, length?: number): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]+$/i.test(value) &&
    (length === undefined || value.length === length);
}

function utf8Hex(value: string) {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function parseManifest(value: string | unknown): VaultManifest {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object") throw new Error("Manifest must be a JSON object.");
  const manifest = parsed as Partial<VaultManifest>;
  if (manifest.version !== 3) throw new Error("Unsupported manifest version.");
  if (!(["Mainnet", "Preview", "Preprod"] as const).includes(manifest.network as never)) {
    throw new Error("Unsupported manifest network.");
  }
  if (!isHex(manifest.creationTx, 64)) throw new Error("Invalid creation transaction hash.");
  if (!manifest.seed || !isHex(manifest.seed.txHash, 64) || !Number.isInteger(manifest.seed.outputIndex) || manifest.seed.outputIndex < 0) throw new Error("Invalid one-shot seed reference.");
  if (!isHex(manifest.policyId, 56)) throw new Error("Invalid validator policy ID.");
  if (!isHex(manifest.ownerKeyHash, 56) || !isHex(manifest.livenessKeyHash, 56)) throw new Error("Invalid owner or liveness key hash.");
  if (manifest.ownerKeyHash === manifest.livenessKeyHash) throw new Error("Owner and liveness keys must be different.");
  if (!manifest.validatorAddress || !manifest.receiptUnit || !manifest.receiptName || !manifest.terminalReceiptUnit || !manifest.terminalReceiptName || !manifest.recoveryReceiptName) throw new Error("Manifest is missing its validator identity.");
  const receiptNames = receiptNamesFor(manifest.receiptName);
  if (
    !receiptNames ||
    manifest.terminalReceiptName !== receiptNames.complete ||
    manifest.recoveryReceiptName !== receiptNames.recovery
  ) {
    throw new Error("Manifest uses unsupported active, completion, or recovery receipt names.");
  }
  const receiptNameHex = utf8Hex(manifest.receiptName);
  if (receiptNameHex.length > 64 || manifest.receiptUnit !== `${manifest.policyId}${receiptNameHex}`) {
    throw new Error("Manifest receipt unit does not match its policy ID and asset name.");
  }
  const terminalReceiptNameHex = utf8Hex(manifest.terminalReceiptName);
  if (
    terminalReceiptNameHex.length > 64 ||
    manifest.terminalReceiptUnit !== `${manifest.policyId}${terminalReceiptNameHex}`
  ) {
    throw new Error("Manifest completion receipt unit does not match its policy ID and asset name.");
  }
  if (!Number.isSafeInteger(manifest.checkInPeriodMs) || manifest.checkInPeriodMs! <= 0) throw new Error("Invalid check-in period.");
  if (!Number.isInteger(manifest.missesToRelease) || manifest.missesToRelease! < 1 || manifest.missesToRelease! > 1000) throw new Error("Invalid missed-check-in threshold.");
  if (!Number.isSafeInteger(manifest.lastCheckInAtMs) || !Number.isSafeInteger(manifest.releaseAtMs)) throw new Error("Invalid manifest timestamps.");
  if (manifest.releaseAtMs !== manifest.lastCheckInAtMs! + manifest.checkInPeriodMs! * manifest.missesToRelease!) throw new Error("Manifest release boundary does not match its schedule.");
  if (manifest.releaseMode !== "fixed" && manifest.releaseMode !== "bearer") throw new Error("Unsupported release mode.");
  if (manifest.releaseMode === "fixed" && !manifest.destination) throw new Error("Fixed release manifest has no destination.");
  if (
    manifest.releaseMode === "bearer" &&
    manifest.recoveryUnit !== `${manifest.policyId}${utf8Hex(manifest.recoveryReceiptName)}`
  ) throw new Error("Bearer release manifest does not use its one-shot Baton recovery token.");
  if (manifest.releaseMode === "fixed" && manifest.recoveryUnit) {
    throw new Error("Fixed release manifest must not declare a recovery token.");
  }
  if (manifest.payloadCommitment && !isHex(manifest.payloadCommitment, 64)) throw new Error("Invalid payload commitment.");
  return manifest as VaultManifest;
}

export function manifestReleaseRule(manifest: VaultManifest) {
  if (manifest.releaseMode === "fixed") {
    return { kind: "fixed" as const, address: manifest.destination! };
  }
  return {
    kind: "bearer" as const,
    policyId: manifest.recoveryUnit!.slice(0, 56),
    assetName: manifest.recoveryUnit!.slice(56),
  };
}

export function downloadManifest(manifest: VaultManifest) {
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `baton-plan-${manifest.creationTx.slice(0, 12)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function storeManifest(manifest: VaultManifest) {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(
    `baton:${manifest.creationTx}`,
    JSON.stringify(parseManifest(manifest)),
  );
}

export function storedManifests() {
  if (typeof window === "undefined" || !window.localStorage) return [];
  const manifests = new Map<string, VaultManifest>();
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith("baton:") && !key?.startsWith("last-signal:")) continue;
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    try {
      const manifest = parseManifest(raw);
      manifests.set(manifest.creationTx, manifest);
    } catch {
      // Leave malformed or legacy records isolated instead of breaking the
      // complete plans screen.
    }
  }
  return [...manifests.values()];
}
