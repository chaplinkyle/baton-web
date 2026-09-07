import { VaultDashboard } from "./vault-dashboard";

export default async function VaultPage({
  params,
}: {
  params: Promise<{ vaultId: string }>;
}) {
  const { vaultId } = await params;
  return <VaultDashboard vaultId={vaultId} />;
}
