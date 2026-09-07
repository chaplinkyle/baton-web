"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/app/providers";
import { EXPLORER_URL } from "@/lib/config";
import {
  downloadManifest,
  parseManifest,
  storeManifest,
  type VaultManifest,
} from "@/lib/manifest";
import {
  formatAda,
  formatUtc,
  missedCount,
  shortHash,
  vaultStatus,
} from "@/lib/product";
import type {
  ActionReview,
  CompletedVaultState,
  ConfirmedVaultState,
} from "@/lib/vault-state";

const statusLabels = {
  active: "Your plan is protected",
  due: "Check-in due soon",
  missed: "A check-in was missed",
  claimable: "Handoff is available",
};

export function VaultDashboard({ vaultId }: { vaultId: string }) {
  const wallet = useWallet();
  const [manifest, setManifest] = useState<VaultManifest | null>(null);
  const [state, setState] = useState<ConfirmedVaultState | null>(null);
  const [completed, setCompleted] = useState<CompletedVaultState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ActionReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = useCallback(async (knownManifest: VaultManifest) => {
    setLoading(true);
    setError(null);
    try {
      const { readVaultLifecycle, readOnlyLucid } = await import("@/lib/vault-state");
      const lucid = wallet.connection?.lucid ?? await readOnlyLucid();
      const lifecycle = await readVaultLifecycle(lucid, knownManifest);
      if (lifecycle.kind === "active") {
        setState(lifecycle.state);
        setCompleted(null);
      } else {
        setState(null);
        setCompleted(lifecycle.state);
      }
    } catch (cause) {
      setState(null);
      setCompleted(null);
      setError(cause instanceof Error ? cause.message : "Your confirmed plan could not be read from Cardano.");
    } finally {
      setLoading(false);
    }
  }, [wallet.connection]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const raw = localStorage.getItem(`baton:${vaultId}`);
      if (!raw) {
        setLoading(false);
        setError("This browser does not have the file for this handoff plan. Choose your saved plan file below.");
        return;
      }
      try {
        const parsed = parseManifest(raw);
        setManifest(parsed);
        void refresh(parsed);
      } catch (cause) {
        setLoading(false);
        setError(cause instanceof Error ? cause.message : "Stored manifest is invalid.");
      }
    });
    return () => { cancelled = true; };
  }, [refresh, vaultId]);

  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = parseManifest(await file.text());
      storeManifest(parsed);
      setManifest(parsed);
      await refresh(parsed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That plan file could not be opened.");
    }
  }

  async function prepare(action: "pulse" | "close" | "release") {
    if (!wallet.connection || !manifest || !state) {
      setError("Connect the Eternl account needed for this action.");
      return;
    }
    setBusy(true);
    setReview(null);
    setSubmitted(null);
    setError(null);
    try {
      const {
        buildClose,
        buildPulse,
        buildRelease,
        readConfirmedVault,
      } = await import("@/lib/vault-state");
      const fresh = await readConfirmedVault(wallet.connection.lucid, manifest);
      setState(fresh);
      setReview(
        action === "pulse"
          ? await buildPulse(wallet.connection.lucid, manifest, fresh)
          : action === "close"
            ? await buildClose(wallet.connection.lucid, manifest, fresh)
            : await buildRelease(wallet.connection.lucid, manifest, fresh),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This action could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  async function signAndSubmit() {
    if (!review || !wallet.connection || !manifest) return;
    setBusy(true);
    setError(null);
    try {
      const { signAndSubmitAction } = await import("@/lib/vault-state");
      const txHash = await signAndSubmitAction(review);
      setSubmitted(txHash);
      const confirmed = await wallet.connection.lucid.awaitTx(txHash);
      if (!confirmed) throw new Error("Transaction was submitted but confirmation was not observed.");
      setReview(null);
      await refresh(manifest);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Eternl did not complete this action.");
    } finally {
      setBusy(false);
    }
  }

  const status = manifest && state
    ? vaultStatus(clock, state.lastCheckInAtMs, manifest.checkInPeriodMs, manifest.missesToRelease)
    : "active";
  const missed = manifest && state
    ? missedCount(clock, state.lastCheckInAtMs, manifest.checkInPeriodMs, manifest.missesToRelease)
    : 0;

  return (
    <div className="page-shell vault-shell">
      <header className="page-title vault-title">
        <div><p className="eyebrow">YOUR HANDOFF PLAN · {shortHash(vaultId, 6).toUpperCase()}</p><h1>{loading ? "Checking Cardano…" : completed ? "This plan is complete" : statusLabels[status]}</h1></div>
        {manifest && <button className="button secondary" onClick={() => downloadManifest(manifest)}>Download plan file</button>}
      </header>

      {error && <div className="error-banner">{error}</div>}
      {!manifest && <label className="manifest-drop"><input type="file" accept="application/json,.json" onChange={(e) => importFile(e.target.files?.[0])} /><span><strong>Choose your saved plan file</strong><small>It contains no seed phrase or private key.</small></span></label>}

      {manifest && completed && <section className="success-box"><span>COMPLETION CONFIRMED ON CARDANO</span><h3>This handoff plan has ended.</h3><p>The active receipt was permanently retired. The completion receipt and final assets are at <span className="mono">{shortHash(completed.utxo.address, 16)}</span>.</p>{submitted && <a href={`${EXPLORER_URL}/transaction/${submitted}`} target="_blank" rel="noreferrer">View transaction {shortHash(submitted, 14)} ↗</a>}</section>}

      {manifest && state && <>
        <section className={`vault-status status-${status}`}>
          <div className="status-orbit"><span>{missed}</span><small>OF {manifest.missesToRelease}<br />MISSED</small></div>
          <div className="status-main"><span className="eyebrow">CONFIRMED ON CARDANO · {state.sequence} CHECK-IN{state.sequence === 1 ? "" : "S"}</span><h2>{statusLabels[status]}</h2><p>{status === "claimable" ? "The full waiting period has passed. Your chosen recipient method can now complete the handoff." : `Check in before ${formatUtc(state.releaseAtMs)} to begin the full waiting period again.`}</p></div>
          <div className="status-clock"><span>HANDOFF AVAILABLE AFTER</span><strong>{formatUtc(state.releaseAtMs)}</strong><small>{new Date(state.releaseAtMs).toLocaleString()}</small></div>
        </section>

        <section className="vault-grid">
          <div className="vault-details"><div><span>PLAN ID</span><strong className="mono">{shortHash(manifest.receiptUnit, 14)}</strong></div><div><span>PROTECTED ADDRESS</span><strong className="mono">{shortHash(manifest.validatorAddress, 14)}</strong></div><div><span>CHECK IN</span><strong>Every {manifest.checkInPeriodMs / 86_400_000} days</strong></div><div><span>RECIPIENT METHOD</span><strong>{manifest.releaseMode === "bearer" ? "Recovery token" : "Chosen address"}</strong></div><div><span>LAST CHECK-IN</span><strong>{formatUtc(state.lastCheckInAtMs)}</strong></div><div><span>WHAT IS PROTECTED</span><strong>{formatAda(state.utxo.assets.lovelace ?? 0n)} + {Object.keys(state.utxo.assets).length - 2} other asset(s)</strong></div></div>
          <div className="action-panel"><p className="eyebrow">WHAT YOU CAN DO NOW</p>{status !== "claimable" ? <><button className="action-primary" onClick={() => prepare("pulse")} disabled={busy}>Check in with Eternl<span>No site fee · normal Cardano network fee applies</span></button><button className="action-secondary" onClick={() => prepare("close")} disabled={busy}>Cancel this plan<span>Returns the protected assets to the owner wallet</span></button></> : <button className="action-release" onClick={() => prepare("release")} disabled={busy}>Complete the handoff<span>{manifest.releaseMode === "bearer" ? "Requires the recovery token" : "Assets can only go to the chosen address"}</span></button>} {!wallet.connection && <button className="connect-inline" onClick={wallet.connect}>Connect Eternl</button>}</div>
        </section>

        {review && <section className="action-review"><div><p className="eyebrow">REVIEW BEFORE APPROVING</p><h2>{review.action === "pulse" ? "Check in" : review.action === "close" ? "Cancel this plan" : "Complete the handoff"}</h2></div><dl><div><dt>Transaction ID</dt><dd className="mono">{shortHash(review.transactionHash, 14)}</dd></div><div><dt>Cardano network fee</dt><dd>{formatAda(review.feeLovelace)}</dd></div><div><dt>Transaction size</dt><dd>{review.transactionBytes.toLocaleString()} bytes</dd></div><div><dt>Site fee</dt><dd>None</dd></div><div><dt>Protected assets moved</dt><dd>{review.action === "pulse" ? "None" : "Yes—this ends the plan"}</dd></div>{review.newReleaseAt && <><div><dt>Handoff currently available after</dt><dd>{formatUtc(review.currentReleaseAt)}</dd></div><div><dt>New handoff date</dt><dd>{formatUtc(review.newReleaseAt)}</dd></div></>}</dl><div className="form-actions"><button className="button secondary" onClick={() => setReview(null)}>Go back</button><button className="button primary" onClick={signAndSubmit} disabled={busy}>{busy ? "Waiting for confirmation…" : "Approve in Eternl"}</button></div></section>}

        {submitted && <div className="success-box"><span>CONFIRMED ON CARDANO</span><h3>Your action is complete.</h3><a href={`${EXPLORER_URL}/transaction/${submitted}`} target="_blank" rel="noreferrer">View transaction {shortHash(submitted, 14)} ↗</a></div>}
      </>}
    </div>
  );
}
