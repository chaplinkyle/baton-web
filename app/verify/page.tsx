"use client";

import { useState } from "react";
import { cardanoErrorMessage } from "@/lib/cardano-errors";
import { CARDANO_NETWORK } from "@/lib/config";
import { parseManifest, type VaultManifest } from "@/lib/manifest";
import { formatUtc, shortHash } from "@/lib/product";
import type { VaultLifecycle } from "@/lib/vault-state";

export default function VerifyPage() {
  const [text, setText] = useState("");
  const [manifest, setManifest] = useState<VaultManifest | null>(null);
  const [lifecycle, setLifecycle] = useState<VaultLifecycle | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify(raw = text) {
    setBusy(true); setError(null); setManifest(null); setLifecycle(null);
    try {
      const [{ applyVault }, { readVaultLifecycle, readOnlyLucid }] = await Promise.all([
        import("@/lib/contract"), import("@/lib/vault-state"),
      ]);
      const parsed = parseManifest(raw);
      const applied = applyVault(parsed.seed, parsed.receiptName, CARDANO_NETWORK);
      if (applied.policyId !== parsed.policyId || applied.address !== parsed.validatorAddress || applied.receiptUnit !== parsed.receiptUnit || applied.terminalReceiptUnit !== parsed.terminalReceiptUnit) throw new Error("This plan file does not reproduce the expected Cardano contract.");
      const confirmed = await readVaultLifecycle(await readOnlyLucid(), parsed);
      setManifest(parsed); setLifecycle(confirmed);
    } catch (cause) {
      setError(cardanoErrorMessage(cause, "This plan could not be checked."));
    } finally { setBusy(false); }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    const raw = await file.text(); setText(raw); await verify(raw);
  }

  return (
    <div className="page-shell verify-shell">
      <header className="page-title compact-title">
        <p className="eyebrow">CHECK A PLAN</p>
        <h1>Confirm a handoff plan directly from Cardano.</h1>
        <p>Choose the plan file downloaded during setup. No account, wallet connection, or trust in this site is required.</p>
      </header>
      <div className="verify-grid">
        <section className="verify-input">
          <label className="manifest-drop"><input type="file" accept="application/json,.json" aria-label="Choose a Baton plan file" onChange={(e) => upload(e.target.files?.[0])} /><span className="manifest-drop-button" aria-hidden="true">Choose file</span><span className="manifest-drop-copy"><strong>Open a Baton plan file</strong><small>{fileName ?? "JSON file downloaded when the plan was created"}</small></span></label>
          <details><summary>Or paste the plan file contents</summary><textarea aria-label="Plan file contents" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} placeholder={'{\n  "version": 2,\n  "network": "Preprod"\n}'} /></details>
          <button className="button primary" onClick={() => verify()} disabled={busy || !text}>{busy ? "Checking Cardano…" : "Check this plan"}</button>
        </section>
        <section className="verify-results" aria-live="polite" aria-busy={busy}>
          <p className="eyebrow">PLAN CHECK</p>
          {error && <div className="error-banner">{error}</div>}
          {!error && !lifecycle && <div className="empty-report"><span aria-hidden="true">✓</span><p>Your confirmed schedule and recipient method will appear here.</p></div>}
          {manifest && lifecycle?.kind === "active" && <div className="checks"><div><i>✓</i><span>Plan found on Cardano</span><strong>{shortHash(manifest.policyId, 10)}</strong></div><div><i>✓</i><span>Protected assets found</span><strong>{shortHash(manifest.receiptUnit, 10)}</strong></div><div><i>✓</i><span>Successful check-ins</span><strong>{lifecycle.state.sequence}</strong></div><div><i>✓</i><span>Handoff available after</span><strong>{formatUtc(lifecycle.state.releaseAtMs)}</strong></div><div><i>✓</i><span>Recipient method</span><strong>{manifest.releaseMode === "bearer" ? "Recovery token" : "Chosen address"}</strong></div></div>}
          {manifest && lifecycle?.kind === "completed" && <div className="checks"><div><i>✓</i><span>Plan completion confirmed</span><strong>{shortHash(manifest.terminalReceiptUnit, 10)}</strong></div><div><i>✓</i><span>Final assets located</span><strong>{shortHash(lifecycle.state.utxo.address, 10)}</strong></div><div><i>✓</i><span>Active plan cannot resume</span><strong>Final</strong></div></div>}
        </section>
      </div>
    </div>
  );
}
