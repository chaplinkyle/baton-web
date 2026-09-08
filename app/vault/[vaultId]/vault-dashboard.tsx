"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/app/providers";
import { cardanoErrorMessage } from "@/lib/cardano-errors";
import { EXPLORER_URL } from "@/lib/config";
import {
  type EternlConnection,
  isWalletSessionReady,
  reviewForWalletSession,
  walletIdentityKey,
  walletErrorMessage,
} from "@/lib/eternl";
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
  nextCheckInAt,
  shortHash,
  vaultStatus,
} from "@/lib/product";
import { availablePlanActions } from "@/lib/plan-actions";
import type { PlanRole } from "@/lib/plan-discovery";
import type {
  ActionReview,
  CompletedVaultState,
  ConfirmedVaultState,
} from "@/lib/vault-state";

type WalletRoleResult = {
  key: string;
  roles: PlanRole[];
  error: string | null;
};

const statusLabels = {
  active: "Your plan is protected",
  due: "Check-in due soon",
  missed: "Check-in overdue",
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
  const [reviewConnection, setReviewConnection] =
    useState<EternlConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [submissionConfirmed, setSubmissionConfirmed] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [walletRoleResult, setWalletRoleResult] = useState<WalletRoleResult | null>(null);
  const refreshVersionRef = useRef(0);
  const walletReady = isWalletSessionReady(
    wallet.connection,
    wallet.revalidating,
  );
  const activeReview = walletReady
    ? reviewForWalletSession(review, reviewConnection, wallet.connection)
    : null;

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const connection = wallet.connection;
    if (!manifest || !connection || wallet.revalidating) return;
    const key = `${manifest.creationTx}:${walletIdentityKey(connection)}`;

    void (async () => {
      try {
        const { combineWalletAssets, rolesForManifest } = await import("@/lib/plan-discovery");
        const assets = combineWalletAssets(await connection.lucid.wallet().getUtxos());
        if (!cancelled) {
          setWalletRoleResult({
            key,
            roles: rolesForManifest(manifest, connection.paymentKeyHashes, assets),
            error: null,
          });
        }
      } catch {
        if (!cancelled) {
          setWalletRoleResult({
            key,
            roles: [],
            error: "Baton could not confirm what this Eternl account can do. Reopen Eternl, confirm the selected account, and reconnect.",
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [manifest, wallet.connection, wallet.revalidating]);

  const refresh = useCallback(async (knownManifest: VaultManifest) => {
    const refreshVersion = ++refreshVersionRef.current;
    const connection = wallet.connection;
    const isCurrent = () => refreshVersionRef.current === refreshVersion;
    setLoading(true);
    setError(null);
    try {
      const { readVaultLifecycle, readOnlyLucid } = await import("@/lib/vault-state");
      const lucid = connection?.lucid ?? await readOnlyLucid();
      if (!isCurrent()) return;
      const lifecycle = await readVaultLifecycle(lucid, knownManifest);
      if (!isCurrent()) return;
      if (lifecycle.kind === "active") {
        setState(lifecycle.state);
        setCompleted(null);
      } else {
        setState(null);
        setCompleted(lifecycle.state);
      }
    } catch (cause) {
      if (!isCurrent()) return;
      setState(null);
      setCompleted(null);
      setError(cardanoErrorMessage(cause, "Your confirmed plan could not be read from Cardano."));
    } finally {
      if (isCurrent()) setLoading(false);
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
    return () => {
      cancelled = true;
      refreshVersionRef.current += 1;
    };
  }, [refresh, vaultId]);

  async function importFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
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
    const connection = wallet.connection;
    if (!walletReady || !connection || !manifest || !state) {
      setError("Connect the Eternl account needed for this action.");
      return;
    }
    setBusy(true);
    setReview(null);
    setReviewConnection(null);
    setSubmitted(null);
    setSubmissionConfirmed(false);
    setError(null);
    try {
      const {
        buildClose,
        buildPulse,
        buildRelease,
        readConfirmedVault,
      } = await import("@/lib/vault-state");
      const fresh = await readConfirmedVault(connection.lucid, manifest);
      const nextReview =
        action === "pulse"
          ? await buildPulse(connection.lucid, manifest, fresh)
          : action === "close"
            ? await buildClose(connection.lucid, manifest, fresh)
            : await buildRelease(connection.lucid, manifest, fresh);
      setState(fresh);
      setReview(nextReview);
      setReviewConnection(connection);
    } catch (cause) {
      setError(cardanoErrorMessage(cause, "This action could not be prepared."));
    } finally {
      setBusy(false);
    }
  }

  async function signAndSubmit() {
    if (!activeReview || !wallet.connection || !manifest) return;
    const reviewed = activeReview;
    setBusy(true);
    setError(null);
    try {
      const { signAndSubmitAction } = await import("@/lib/vault-state");
      const txHash = await signAndSubmitAction(reviewed);
      setSubmitted(txHash);
      setReview(null);
      setReviewConnection(null);
      const confirmed = await wallet.connection.lucid.awaitTx(txHash);
      if (!confirmed) throw new Error("Transaction was submitted but confirmation was not observed.");
      setSubmissionConfirmed(true);
      await refresh(manifest);
    } catch (cause) {
      setError(
        walletErrorMessage(
          cause,
          "Eternl did not complete this action.",
          "transaction",
        ),
      );
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
  const nextCheckIn = manifest && state
    ? nextCheckInAt(state.lastCheckInAtMs, manifest.checkInPeriodMs)
    : null;
  const nextMissBoundary = manifest && state
    ? Math.min(
        state.releaseAtMs,
        state.lastCheckInAtMs + manifest.checkInPeriodMs * (missed + 1),
      )
    : null;
  const scheduleMoment = state && nextCheckIn !== null && nextMissBoundary !== null
    ? status === "claimable"
      ? {
          label: "HANDOFF AVAILABLE SINCE",
          at: state.releaseAtMs,
          detail: "The waiting period has ended.",
        }
      : status === "missed"
        ? {
            label: missed + 1 >= (manifest?.missesToRelease ?? 0)
              ? "HANDOFF AVAILABLE AFTER"
              : "NEXT CHECK-IN DEADLINE",
            at: nextMissBoundary,
            detail: `Handoff remains locked until ${formatUtc(state.releaseAtMs)}.`,
          }
        : {
            label: "NEXT CHECK-IN DUE",
            at: nextCheckIn,
            detail: `Handoff remains locked until ${formatUtc(state.releaseAtMs)}.`,
          }
    : null;
  const protectedAssetCount = manifest && state
    ? Object.keys(state.utxo.assets).filter(
        (unit) => unit !== "lovelace" && unit !== manifest.receiptUnit,
      ).length
    : 0;
  const walletRoleKey = manifest && wallet.connection
    ? `${manifest.creationTx}:${walletIdentityKey(wallet.connection)}`
    : null;
  const currentWalletRoleResult = walletRoleKey && walletRoleResult?.key === walletRoleKey
    ? walletRoleResult
    : null;
  const walletRoles = currentWalletRoleResult?.roles ?? [];
  const checkingWalletRoles = Boolean(
    wallet.revalidating || (walletRoleKey && !currentWalletRoleResult),
  );
  const walletRoleError = currentWalletRoleResult?.error ?? null;
  const actions = manifest
    ? availablePlanActions(
        status,
        manifest.releaseMode,
        walletRoles,
        walletReady,
      )
    : [];
  const canPulse = actions.includes("pulse");
  const canClose = actions.includes("close");
  const canRelease = actions.includes("release");
  const connectedRole = walletRoles.includes("owner")
    ? "Connected as the owner"
    : walletRoles.includes("check-in")
      ? "Connected as the check-in wallet"
      : walletRoles.includes("recovery holder")
        ? "Recovery token found in this wallet"
        : walletRoles.includes("recipient")
          ? "Connected as the chosen recipient"
          : null;

  return (
    <div className="page-shell vault-shell">
      <header className="page-title vault-title">
        <div><p className="eyebrow">YOUR HANDOFF PLAN · {shortHash(vaultId, 6).toUpperCase()}</p><h1>{loading ? "Checking Cardano…" : !manifest ? "Open your Baton plan" : completed ? "This plan is complete" : "Your Baton plan"}</h1></div>
        {manifest && <button className="button secondary" onClick={() => downloadManifest(manifest)}>Download plan file</button>}
      </header>

      {error && <div className="error-banner">{error}</div>}
      {loading && <div className="vault-loading" role="status"><span className="status-dot" aria-hidden="true" /><div><strong>Checking this plan on Cardano</strong><small>Reading the confirmed assets, schedule, and latest check-in.</small></div></div>}
      {!loading && !manifest && <label className="manifest-drop"><input type="file" accept="application/json,.json" aria-label="Choose a saved Baton plan file" onChange={(e) => importFile(e.target.files?.[0])} /><span className="manifest-drop-button" aria-hidden="true">Choose file</span><span className="manifest-drop-copy"><strong>Open your saved plan file</strong><small>{fileName ?? "It contains no seed phrase or private key."}</small></span></label>}

      {manifest && completed && <section className="success-box"><span>COMPLETION CONFIRMED ON CARDANO</span><h3>This handoff plan has ended.</h3><p>The active receipt was permanently retired. The completion receipt and final assets are at <span className="mono">{shortHash(completed.utxo.address, 16)}</span>.</p>{submitted && <a href={`${EXPLORER_URL}/transaction/${submitted}`} target="_blank" rel="noreferrer">View transaction {shortHash(submitted, 14)} ↗</a>}</section>}

      {manifest && state && <>
        <section className={`vault-status status-${status}`}>
          <div className="status-orbit"><span>{missed}</span><small>OF {manifest.missesToRelease}<br />MISSED</small></div>
          <div className="status-main"><span className="eyebrow">CONFIRMED ON CARDANO · {state.sequence} CHECK-IN{state.sequence === 1 ? "" : "S"}</span><h2>{statusLabels[status]}</h2><p>{status === "claimable"
            ? "The full waiting period has passed. Your chosen recipient method can now complete the handoff."
            : status === "missed"
              ? `You have missed ${missed} of ${manifest.missesToRelease} allowed check-ins. Check in now to reset the waiting period.`
              : `Check in by ${formatUtc(nextCheckIn!)} to stay on schedule.`}</p></div>
          {scheduleMoment && <div className="status-clock"><span>{scheduleMoment.label}</span><strong>{formatUtc(scheduleMoment.at)}</strong><small>{scheduleMoment.detail}</small></div>}
        </section>

        <section className="vault-grid">
          <div className="vault-details"><div><span>PLAN ID</span><strong className="mono">{shortHash(manifest.receiptUnit, 14)}</strong></div><div><span>PROTECTED ADDRESS</span><strong className="mono">{shortHash(manifest.validatorAddress, 14)}</strong></div><div><span>CHECK IN</span><strong>Every {manifest.checkInPeriodMs / 86_400_000} days</strong></div><div><span>RECIPIENT METHOD</span><strong>{manifest.releaseMode === "bearer" ? "Recovery token" : "Chosen address"}</strong></div><div><span>LAST CHECK-IN</span><strong>{formatUtc(state.lastCheckInAtMs)}</strong></div><div><span>WHAT IS PROTECTED</span><strong>{formatAda(state.utxo.assets.lovelace ?? 0n)} + {protectedAssetCount === 0 ? "no other assets" : `${protectedAssetCount} other asset${protectedAssetCount === 1 ? "" : "s"}`}</strong></div></div>
          <div className="action-panel">
            <p className="eyebrow">WHAT YOU CAN DO NOW</p>
            {!wallet.connection ? <div className="action-guidance">
              <strong>Connect the wallet for this plan</strong>
              <p>Baton will confirm whether this account owns the plan, checks it in, or holds its recovery token. Connecting does not submit a transaction.</p>
              <button className="connect-inline" onClick={wallet.connect} disabled={wallet.connecting || wallet.availability === "detecting"}>{wallet.connectionActionLabel}</button>
            </div> : checkingWalletRoles ? <div className="action-guidance" role="status">
              <strong>{wallet.revalidating ? "Confirming this Eternl account" : "Checking this Eternl account"}</strong>
              <p>{wallet.revalidating ? "Wallet actions are paused until Baton confirms the selected Preprod account." : "Baton is confirming what this wallet can do without submitting a transaction."}</p>
            </div> : status === "claimable" && manifest.releaseMode === "fixed" ? <>
              <div className="action-role">Fixed receiving address</div>
              <button className="action-release" onClick={() => prepare("release")} disabled={busy}>Complete the handoff<span>The complete protected value can only go to the chosen address</span></button>
            </> : walletRoleError ? <div className="action-guidance action-guidance-error" role="alert">
              <strong>Wallet role could not be confirmed</strong>
              <p>{walletRoleError}</p>
            </div> : <>
              {connectedRole && <div className="action-role">{connectedRole}</div>}
              {canPulse && <button className="action-primary" onClick={() => prepare("pulse")} disabled={busy}>Check in with Eternl<span>No site fee · normal Cardano network fee applies</span></button>}
              {canClose && <button className="action-secondary" onClick={() => prepare("close")} disabled={busy}>Cancel this plan<span>Returns the complete protected value to the owner wallet</span></button>}
              {canRelease && <button className="action-release" onClick={() => prepare("release")} disabled={busy}>Complete the handoff<span>The recovery token and complete protected value will arrive together</span></button>}
              {!canPulse && !canClose && !canRelease && <div className="action-guidance">
                <strong>{walletRoles.includes("recovery holder")
                  ? "The recovery token is ready"
                  : walletRoles.includes("recipient")
                    ? "No action is needed yet"
                    : "This is not a managing wallet"}</strong>
                <p>{walletRoles.includes("recovery holder")
                  ? `This wallet can complete the handoff after ${formatUtc(state.releaseAtMs)}.`
                  : walletRoles.includes("recipient")
                    ? `The protected value cannot be received before ${formatUtc(state.releaseAtMs)}.`
                    : status === "claimable" && manifest.releaseMode === "bearer"
                      ? "Connect the Eternl account that holds this plan's BATON_RECOVERY token."
                      : "Switch to the owner or check-in account in Eternl, then reconnect Baton."}</p>
              </div>}
            </>}
          </div>
        </section>

        {activeReview && <section className="action-review"><div><p className="eyebrow">REVIEW BEFORE APPROVING</p><h2>{activeReview.action === "pulse" ? "Check in" : activeReview.action === "close" ? "Cancel this plan" : "Complete the handoff"}</h2></div><dl><div><dt>Transaction ID</dt><dd className="mono">{shortHash(activeReview.transactionHash, 14)}</dd></div><div><dt>Cardano network fee</dt><dd>{formatAda(activeReview.feeLovelace)}</dd></div><div><dt>Transaction size</dt><dd>{activeReview.transactionBytes.toLocaleString()} bytes</dd></div><div><dt>Site fee</dt><dd>None</dd></div><div><dt>Protected assets moved</dt><dd>{activeReview.action === "pulse" ? "None" : "Yes—this ends the plan"}</dd></div>{activeReview.newReleaseAt && <><div><dt>Handoff currently available after</dt><dd>{formatUtc(activeReview.currentReleaseAt)}</dd></div><div><dt>New handoff date</dt><dd>{formatUtc(activeReview.newReleaseAt)}</dd></div></>}</dl><div className="form-actions"><button className="button secondary" onClick={() => { setReview(null); setReviewConnection(null); }}>Go back</button><button className="button primary" onClick={signAndSubmit} disabled={busy}>{busy ? "Waiting for confirmation…" : "Approve in Eternl"}</button></div></section>}

        {submitted && <div className="success-box" role="status"><span>{submissionConfirmed ? "CONFIRMED ON CARDANO" : "SUBMITTED TO CARDANO"}</span><h3>{submissionConfirmed ? "Your action is complete." : "Waiting for confirmation…"}</h3><a href={`${EXPLORER_URL}/transaction/${submitted}`} target="_blank" rel="noreferrer">View transaction {shortHash(submitted, 14)} ↗</a></div>}
      </>}
    </div>
  );
}
