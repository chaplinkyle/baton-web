import { BATON_RECEIPT_NAMES, LEGACY_RC9_RECEIPT_NAMES } from "./protocol-names";

export type ProtocolArtifact = {
  release: string;
  compiler: string;
  validatorHash: string;
  blueprintSha256: string;
  compiledBytes: number;
  sourceUrl: string | null;
  blueprintUrl: string;
  releaseManifestUrl: string;
};

export const CONTRACT_REPOSITORY_URL =
  "https://github.com/chaplinkyle/baton-cardano";

const CURRENT_ARTIFACT: ProtocolArtifact = {
  release: "0.1.0-rc.10",
  compiler: "v1.1.23+8949565",
  validatorHash: "199955b94b93bd11624d5e7c0a201ae11e32270377df63b5317f6fb1",
  blueprintSha256: "b0809a00186e40ffca51511dbd81086d642be7149b6d1852fe127fc1822d22fc",
  compiledBytes: 4_505,
  sourceUrl: `${CONTRACT_REPOSITORY_URL}/blob/v0.1.0-rc.10/validators/baton.ak`,
  blueprintUrl: `${CONTRACT_REPOSITORY_URL}/blob/v0.1.0-rc.10/plutus.json`,
  releaseManifestUrl: `${CONTRACT_REPOSITORY_URL}/blob/v0.1.0-rc.10/release/release-manifest.json`,
};

const LEGACY_RC9_ARTIFACT: ProtocolArtifact = {
  release: "0.1.0-rc.9 compatibility",
  compiler: "v1.1.23+8949565",
  validatorHash: "c06bb79eee8686abd9628224bec39b745900c220076459cdc13da46b",
  blueprintSha256: "fabc367f2f0c329ad0259d69c8bf46338473f517976bb730d0dbe10d30ab5800",
  compiledBytes: 4_545,
  sourceUrl: null,
  blueprintUrl: `${CONTRACT_REPOSITORY_URL}/blob/v0.1.0-rc.10/legacy/0.1.0-rc.9/plutus.json`,
  releaseManifestUrl: `${CONTRACT_REPOSITORY_URL}/blob/v0.1.0-rc.10/release/release-manifest.json`,
};

export function protocolArtifactFor(receiptName: string) {
  if (receiptName === BATON_RECEIPT_NAMES.active) return CURRENT_ARTIFACT;
  if (receiptName === LEGACY_RC9_RECEIPT_NAMES.active) return LEGACY_RC9_ARTIFACT;
  throw new Error("Baton does not have a pinned artifact for this receipt name.");
}
