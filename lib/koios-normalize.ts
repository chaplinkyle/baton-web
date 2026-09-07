import { datumJsonToCbor } from "@lucid-evolution/lucid";

function parseRenderedAssetList(value: string) {
  if (value === "[]") return [];
  const assets: Array<{
    policy_id: string;
    asset_name: string;
    fingerprint: string;
    decimals: number;
    quantity: string;
  }> = [];
  const policyPattern = /PolicyID\s*\{policyID\s*=\s*ScriptHash\s*"([0-9a-f]{56})"\}\s*,\s*\[([^\]]*)\]\s*\)/gi;
  for (const policyMatch of value.matchAll(policyPattern)) {
    const assetPattern = /\("([0-9a-f]*)"\s*,\s*(-?\d+)\)/gi;
    for (const assetMatch of policyMatch[2].matchAll(assetPattern)) {
      assets.push({
        policy_id: policyMatch[1].toLowerCase(),
        asset_name: assetMatch[1].toLowerCase(),
        fingerprint: "",
        decimals: 0,
        quantity: assetMatch[2],
      });
    }
  }
  return assets.length > 0 ? assets : null;
}

/**
 * Normalize the inconsistent collateral and inline-datum shapes Koios can
 * return so Lucid's strict provider decoder receives its documented types.
 */
export function normalizeKoiosJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeKoiosJson);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key === "asset_list" && typeof child === "string") {
        const parsed = parseRenderedAssetList(child);
        if (parsed) return [key, parsed];
      }
      if (key === "inline_datum" && child && typeof child === "object") {
        const datum = child as { bytes?: unknown; value?: unknown };
        if (datum.bytes === null && datum.value === null) return [key, null];
        if (datum.bytes === null && datum.value && typeof datum.value === "object") {
          return [key, {
            ...datum,
            bytes: datumJsonToCbor(
              datum.value as Parameters<typeof datumJsonToCbor>[0],
            ),
          }];
        }
      }
      return [key, normalizeKoiosJson(child)];
    }),
  );
}
