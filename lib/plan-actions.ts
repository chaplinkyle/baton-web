import type { VaultManifest } from "./manifest";
import type { PlanRole } from "./plan-discovery";
import type { VaultStatus } from "./product";

export type PlanAction = "pulse" | "close" | "release";

/**
 * Returns only the actions the currently connected wallet can prepare.
 * Transaction builders and the validator remain the final authority; this
 * keeps the interface from inviting a user to attempt an action their account
 * cannot authorize.
 */
export function availablePlanActions(
  status: VaultStatus,
  releaseMode: VaultManifest["releaseMode"],
  roles: PlanRole[],
  connected: boolean,
): PlanAction[] {
  if (!connected) return [];

  if (status === "claimable") {
    if (releaseMode === "fixed") return ["release"];
    return roles.includes("recovery holder") ? ["release"] : [];
  }

  const actions: PlanAction[] = [];
  if (roles.includes("check-in")) actions.push("pulse");
  if (roles.includes("owner")) actions.push("close");
  return actions;
}
