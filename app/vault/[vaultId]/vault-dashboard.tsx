"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/app/providers";
import { ErrorBanner } from "@/components/ErrorBanner";
import { cardanoErrorMessage } from "@/lib/cardano-errors";
import { CARDANO_NETWORK, EXPLORER_URL } from "@/lib/config";
import {
  type EternlConnection,
  isExactWalletNetwork,
  isWalletSessionReady,
  MIN_WALLET_APPROVAL_WINDOW_MS,
  resultForWalletSession,
  reviewForWalletSession,
  walletReviewNeedsRefresh,
  walletReviewSessionChanged,
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
  formatCheckInPeriod,
  formatLocal,
  formatUtc,
  missedCount,
  nextCheckInAt,
  shortHash,
  vaultStatus,
} from "@/lib/product";
import { availablePlanActions } from "@/lib/plan-actions";
import type { PlanHistoryEntry, PlanRole } from "@/lib/plan-discovery";
import { protocolArtifactFor } from "@/lib/protocol-artifacts";
import { receiptDisplayName } from "@/lib/protocol-names";
import type {
  ActionReview,
  CompletedVaultState,
  ConfirmedVaultState,
} from "@/lib/vault-state";

type WalletRoleResult = {
  connection: EternlConnection;
  creationTx: string;
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
  const [history, setHistory] = useState<PlanHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [localTimeZone, setLocalTimeZone] = useState<string | null>(null);
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
    if (!review || !walletReviewSessionChanged(
      reviewConnection,
      wallet.connection,
      wallet.revalidating,
      busy,
    )) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setReview(null);
      setReviewConnection(null);
      setError((current) => current ??
        "Eternl refreshed or changed this wallet session, so Baton cleared the old unsigned action review. Nothing was signed or submitted. Prepare the action again.");
    });
    return () => { cancelled = true; };
  }, [busy, review, reviewConnection, wallet.connection, wallet.revalidating]);

  useEffect(() => {
    if (!activeReview) return;
    const delay = Math.max(
      0,
      activeReview.validTo - Date.now() - MIN_WALLET_APPROVAL_WINDOW_MS,
    );
    const timer = window.setTimeout(() => {
      setReview(null);
      setReviewConnection(null);
      setError(
        "This action review no longer has enough time to approve safely. Nothing was signed or submitted. Prepare it again from the latest confirmed plan state.",
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [activeReview]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLocalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      }
    });
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const connection = wallet.connection;
    if (!manifest || !connection || !walletReady) return;
    const creationTx = manifest.creationTx;

    void (async () => {
      try {
        const { combineWalletAssets, rolesForManifest } = await import("@/lib/plan-discovery");
        const assets = combineWalletAssets(await connection.lucid.wallet().getUtxos());
        if (!cancelled) {
          setWalletRoleResult({
            connection,
            creationTx,
            roles: rolesForManifest(manifest, connection.paymentKeyHashes, assets),
            error: null,
          });
        }
      } catch {
        if (!cancelled) {
          setWalletRoleResult({
            connection,
            creationTx,
            roles: [],
            error: "Baton could not confirm what this Eternl account can do. Reopen Eternl, confirm the selected account, and reconnect.",
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [manifest, wallet.connection, walletReady]);

  const refresh = useCallback(async (knownManifest: VaultManifest) => {
    const refreshVersion = ++refreshVersionRef.current;
    const connection = wallet.connection;
    const isCurrent = () => refreshVersionRef.current === refreshVersion;
    setLoading(true);
    setError(null);
    setHistory([]);
    setHistoryError(null);
    setHistoryLoading(true);
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
      setLoading(false);
      try {
        const { readPlanHistory } = await import("@/lib/plan-discovery");
        const nextHistory = await readPlanHistory(
          knownManifest,
          lifecycle.kind === "active"
            ? {
                kind: "active",
                txHash: lifecycle.state.utxo.txHash,
                outputIndex: lifecycle.state.utxo.outputIndex,
                sequence: lifecycle.state.sequence,
              }
            : {
                kind: "completed",
                txHash: lifecycle.state.utxo.txHash,
                outputIndex: lifecycle.state.utxo.outputIndex,
              },
        );
        if (isCurrent()) setHistory(nextHistory);
      } catch (cause) {
        if (isCurrent()) {
          setHistoryError(cardanoErrorMessage(
            cause,
            "The plan is confirmed, but its transaction history could not be verified right now.",
          ));
        }
      }
    } catch (cause) {
      if (!isCurrent()) return;
      setState(null);
      setCompleted(null);
      setError(cardanoErrorMessage(cause, "Your confirmed plan could not be read from Cardano."));
    } finally {
      if (isCurrent()) {
        setLoading(false);
        setHistoryLoading(false);
      }
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
          ? await buildPulse(
              connection.lucid,
              manifest,
              fresh,
              Date.now(),
              connection.paymentKeyHashes,
            )
          : action === "close"
            ? await buildClose(
                connection.lucid,
                manifest,
                fresh,
                Date.now(),
                connection.paymentKeyHashes,
              )
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
    const connection = wallet.connection;
    if (!activeReview || !connection || !manifest) return;
    if (walletReviewNeedsRefresh(activeReview.validTo)) {
      setReview(null);
      setReviewConnection(null);
      setError(
        "This action review no longer has enough time to approve safely. Nothing was signed or submitted. Prepare it again from the latest confirmed plan state.",
      );
      return;
    }
    const reviewed = activeReview;
    setBusy(true);
    setError(null);
    try {
      const { signAndSubmitAction } = await import("@/lib/vault-state");
      const txHash = await wallet.runWalletRequest(
        () => signAndSubmitAction(reviewed, connection),
      );
      setSubmitted(txHash);
      setReview(null);
      setReviewConnection(null);
      const confirmed = await connection.lucid.awaitTx(txHash);
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
  const sessionWalletRoleResult = resultForWalletSession(
    walletRoleResult,
    walletRoleResult?.connection,
    wallet.connection,
  );
  const currentWalletRoleResult = manifest &&
      sessionWalletRoleResult?.creationTx === manifest.creationTx
    ? sessionWalletRoleResult
    : null;
  const walletRoles = currentWalletRoleResult?.roles ?? [];
  const checkingWalletRoles = Boolean(
    wallet.revalidating ||
      (walletReady && manifest && wallet.connection && !currentWalletRoleResult),
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
  const reviewNetwork = reviewConnection
    ? isExactWalletNetwork(reviewConnection)
      ? `${CARDANO_NETWORK} verified`
      : `Cardano testnet connected · confirm ${CARDANO_NETWORK} in Eternl`
    : null;
  const planTime = (timestamp: number) => (
    <time className="time-pair" dateTime={new Date(timestamp).toISOString()}>
      <strong>{formatLocal(timestamp, localTimeZone ?? "UTC")}</strong>
      <small>Exact UTC · {formatUtc(timestamp)}</small>
    </time>
  );
  const protocolArtifact = manifest
    ? protocolArtifactFor(manifest.receiptName)
    : null;

  return (
    <div className="page-shell vault-shell">
      <header className="page-title vault-title">
        <div><p className="eyebrow">YOUR HANDOFF PLAN · {shortHash(manifest?.policyId ?? vaultId, 6).toUpperCase()}</p><h1>{loading ? "Checking Cardano…" : !manifest ? "Open your Baton plan" : completed ? "This plan is complete" : "Your Baton plan"}</h1></div>
        {manifest && <button className="button secondary" onClick={() => downloadManifest(manifest)}>Download plan file</button>}
      </header>

      {error && <ErrorBanner message={error} />}
      {loading && <div className="vault-loading" role="status"><span className="status-dot" aria-hidden="true" /><div><strong>Checking this plan on Cardano</strong><small>Reading the confirmed assets, schedule, and latest check-in.</small></div></div>}
      {!loading && !manifest && <label className="manifest-drop"><input type="file" accept="application/json,.json" aria-label="Choose a saved Baton plan file" onChange={(e) => importFile(e.target.files?.[0])} /><span className="manifest-drop-button" aria-hidden="true">Choose file</span><span className="manifest-drop-copy"><strong>Open your saved plan file</strong><small>{fileName ?? "It contains no seed phrase or private key."}</small></span></label>}

      {manifest && completed && <section className="success-box"><span>COMPLETION CONFIRMED ON CARDANO</span><h3>This handoff plan has ended.</h3><p>The active receipt was permanently retired. The completion receipt and final assets are at <span className="mono">{shortHash(completed.utxo.address, 16)}</span>.</p>{submitted && <a href={`${EXPLORER_URL}/transaction/${submitted}`} target="_blank" rel="noreferrer">View transaction {shortHash(submitted, 14)} ↗</a>}</section>}

      {manifest && state && <>
        <section className={`vault-status status-${status}`}>
          <div className="status-orbit"><span>{missed}</span><small>OF {manifest.missesToRelease}<br />MISSED</small></div>
          <div className="status-main"><span className="status-confirmation"><span>CARDANO CONFIRMED</span><span>{state.sequence} CHECK-IN{state.sequence === 1 ? "" : "S"}</span></span><h2>{statusLabels[status]}</h2><p>{status === "claimable"
            ? "The full waiting period has passed. Your chosen recipient method can now complete the handoff."
            : status === "missed"
              ? `You have missed ${missed} of ${manifest.missesToRelease} allowed check-ins. Check in now to reset the waiting period.`
              : `Check in by ${formatLocal(nextCheckIn!, localTimeZone ?? "UTC")} to stay on schedule.`}</p></div>
          {scheduleMoment && <div className="status-clock"><span>{scheduleMoment.label}</span>{planTime(scheduleMoment.at)}<small>{scheduleMoment.detail}</small></div>}
        </section>

        <section className="vault-grid">
          <div className="vault-details">
            <div><span>PLAN ID</span><strong className="mono">{shortHash(manifest.policyId, 14)}</strong></div>
            <div><span>PROTECTED ADDRESS</span><strong className="mono">{shortHash(manifest.validatorAddress, 14)}</strong></div>
            <div><span>CHECK IN</span><strong>{formatCheckInPeriod(manifest.checkInPeriodMs)}</strong></div>
            <div><span>RECIPIENT METHOD</span><strong>{manifest.releaseMode === "bearer" ? "Recovery token" : "Chosen address"}</strong></div>
            <div><span>LAST CHECK-IN</span>{planTime(state.lastCheckInAtMs)}</div>
            <div><span>CHECK-IN DEADLINE</span>{status === "claimable" ? <strong>Waiting period ended</strong> : planTime(nextCheckIn!)}</div>
            <div><span>FINAL HANDOFF TIME</span>{planTime(state.releaseAtMs)}</div>
            <div><span>WHAT IS PROTECTED</span><strong>{formatAda(state.utxo.assets.lovelace ?? 0n)} + {protectedAssetCount === 0 ? "no other assets" : `${protectedAssetCount} other asset${protectedAssetCount === 1 ? "" : "s"}`}</strong></div>
          </div>
          <div className="action-panel" data-wallet-return-focus tabIndex={-1}>
            <p className="eyebrow">WHAT YOU CAN DO NOW</p>
            {!wallet.connection ? <div className="action-guidance">
              <strong>Connect the wallet for this plan</strong>
              <p>Baton will confirm whether this account owns the plan, checks it in, or holds its recovery token. Connecting does not submit a transaction.</p>
              <button className="connect-inline" onClick={wallet.connect} disabled={wallet.connecting || wallet.availability === "detecting"}>{wallet.connectionActionLabel}</button>
            </div> : !walletReady ? <div className="action-guidance">
              <strong>{wallet.revalidating ? "Confirming this Eternl account" : `${CARDANO_NETWORK} is not verified yet`}</strong>
              <p>{wallet.revalidating ? "Wallet actions are paused until Baton confirms the selected Preprod account." : `Transactions stay locked until Baton confirms this account on ${CARDANO_NETWORK}. If the account is empty, fund it with test ADA first.`}</p>
              {!wallet.revalidating && <button className="connect-inline" onClick={() => void wallet.recheckNetwork()}>Recheck {CARDANO_NETWORK}</button>}
            </div> : checkingWalletRoles ? <div className="action-guidance" role="status">
              <strong>{wallet.revalidating ? "Confirming this Eternl account" : "Checking this Eternl account"}</strong>
              <p>{wallet.revalidating ? "Wallet actions are paused until Baton confirms the selected Preprod account." : "Baton is confirming what this wallet can do without submitting a transaction."}</p>
            </div> : status === "claimable" && manifest.releaseMode === "fixed" ? <>
              <div className="action-role">Fixed receiving address</div>
              <button className="action-release" onClick={() => prepare("release")} disabled={busy}>Review the handoff<span>Prepare an unsigned transaction to the permanent chosen address</span></button>
            </> : walletRoleError ? <div className="action-guidance action-guidance-error" role="alert">
              <strong>Wallet role could not be confirmed</strong>
              <p>{walletRoleError}</p>
            </div> : <>
              {connectedRole && <div className="action-role">{connectedRole}</div>}
              {canPulse && <button className="action-primary" onClick={() => prepare("pulse")} disabled={busy}>Review check-in<span>Prepare an unsigned check-in · no site fee</span></button>}
              {canClose && <button className="action-secondary" onClick={() => prepare("close")} disabled={busy}>Review cancellation<span>Prepare an unsigned return of the complete protected value</span></button>}
              {canRelease && <button className="action-release" onClick={() => prepare("release")} disabled={busy}>Review the handoff<span>Prepare an unsigned transfer of the recovery token and complete protected value</span></button>}
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
                      : "Switch to the owner or check-in account in Eternl, then reconnect Baton. If Eternl keeps returning to another account, disable Forced DApp Account for Baton in Eternl."}</p>
              </div>}
            </>}
          </div>
        </section>

        {activeReview && reviewConnection && <section className="action-review">
          <div>
            <p className="eyebrow">REVIEW BEFORE APPROVING</p>
            <h2>{activeReview.action === "pulse" ? "Check in" : activeReview.action === "close" ? "Cancel this plan" : "Complete the handoff"}</h2>
            <p className="action-review-intro">This is an unsigned transaction. Confirm every detail below. Eternl opens only when you choose to approve and submit it.</p>
          </div>
          <dl>
            <div><dt>Connected Eternl account</dt><dd className="mono">{reviewConnection.address}</dd></div>
            <div><dt>Cardano network</dt><dd>{reviewNetwork}</dd></div>
            <div><dt>Transaction valid until</dt><dd>{formatUtc(activeReview.validTo)}</dd></div>
            <div><dt>Transaction ID</dt><dd className="mono">{activeReview.transactionHash}</dd></div>
            <div><dt>Cardano network fee</dt><dd>{formatAda(activeReview.feeLovelace)}</dd></div>
            <div><dt>Baton site fee</dt><dd>{formatAda(activeReview.siteFeeLovelace)}</dd></div>
            <div><dt>Transaction size</dt><dd>{activeReview.transactionBytes.toLocaleString()} bytes</dd></div>
            {activeReview.action === "pulse" ? <>
              <div><dt>Missed check-ins now</dt><dd>{activeReview.currentMissedCount ?? missed} of {manifest.missesToRelease}</dd></div>
              <div><dt>After confirmation</dt><dd>0 of {manifest.missesToRelease} missed</dd></div>
              <div><dt>Protected ADA change</dt><dd>{activeReview.protectedValueEffect === "preserved" ? "0 ADA" : "Complete balance leaves the plan"}</dd></div>
              <div><dt>Protected token / NFT change</dt><dd>{activeReview.protectedValueEffect === "preserved" ? "0 units" : "Complete balance leaves the plan"}</dd></div>
              <div><dt>Handoff currently available after</dt><dd>{formatUtc(activeReview.currentReleaseAt)}</dd></div>
              <div><dt>Check-in recorded at</dt><dd>{formatUtc(activeReview.newCheckInAt!)}</dd></div>
              <div><dt>New handoff date</dt><dd>{formatUtc(activeReview.newReleaseAt!)}</dd></div>
            </> : <>
              <div><dt>Protected value</dt><dd>Complete balance leaves the plan</dd></div>
              <div><dt>Receiving address</dt><dd className="mono">{activeReview.receivingAddress}</dd></div>
              <div><dt>Handoff boundary</dt><dd>{formatUtc(activeReview.currentReleaseAt)}</dd></div>
            </>}
          </dl>
          <p className="action-review-note">Eternl will ask you to approve this exact transaction next. Compare the network and fee there—and the receiving address whenever value leaves the plan—before signing.</p>
          <div className="form-actions">
            <button className="button secondary" onClick={() => { setReview(null); setReviewConnection(null); }}>Go back</button>
            <button className="button primary" onClick={signAndSubmit} disabled={busy}>{busy ? "Waiting for Eternl…" : "Approve and submit in Eternl"}</button>
          </div>
        </section>}

        {submitted && <div className="success-box" role="status"><span>{submissionConfirmed ? "CONFIRMED ON CARDANO" : "SUBMITTED TO CARDANO"}</span><h3>{submissionConfirmed ? "Your action is complete." : "Waiting for confirmation…"}</h3><a href={`${EXPLORER_URL}/transaction/${submitted}`} target="_blank" rel="noreferrer">View transaction {shortHash(submitted, 14)} ↗</a></div>}
      </>}

      {manifest && (state || completed) && <section className="history-panel" aria-labelledby="plan-history-title">
        <div className="history-heading">
          <div><p className="eyebrow">CONFIRMED CARDANO HISTORY</p><h2 id="plan-history-title">Your plan&apos;s record</h2></div>
          <span>{historyLoading ? "CHECKING CARDANO RECORDS" : historyError ? "HISTORY UNAVAILABLE" : `${history.length} VERIFIED RECORD${history.length === 1 ? "" : "S"}`}</span>
        </div>
        <p className="history-intro">Baton checks every entry directly against Cardano and links it to this specific plan. The website cannot add, remove, or change these records.</p>
        {historyLoading && <div className="history-loading" role="status"><span className="status-dot" aria-hidden="true" />Verifying each confirmed transaction…</div>}
        {!historyLoading && historyError && <div className="history-error" role="status"><strong>Current plan state is still confirmed.</strong><span>{historyError}</span></div>}
        {!historyLoading && !historyError && <ol className="history-list">
          {[...history].reverse().map((entry) => <li key={entry.txHash}>
            <span className="history-sequence" aria-hidden="true">{entry.kind === "completed" ? "✓" : entry.sequence}</span>
            <div className="history-event">
              <strong>{entry.kind === "created" ? "Plan created" : entry.kind === "completed" ? "Plan completed" : `Check-in ${entry.sequence}`}</strong>
              <span>{entry.kind === "created" ? "Plan began with its protected assets" : entry.kind === "completed" ? "Plan ended permanently on Cardano" : "Check-in confirmed; protected assets stayed in place"}</span>
            </div>
            <div className="history-when">{planTime(entry.confirmedAtMs)}<a href={`${EXPLORER_URL}/transaction/${entry.txHash}`} target="_blank" rel="noreferrer">View {shortHash(entry.txHash, 8)} ↗</a></div>
          </li>)}
        </ol>}
      </section>}

      {manifest && protocolArtifact && (state || completed) && <section className="protocol-panel" aria-labelledby="protocol-panel-title">
        <div>
          <p className="eyebrow">OPEN CONTRACT VERIFICATION</p>
          <h2 id="protocol-panel-title">Verify what protects this plan</h2>
          <p>
            This plan reproduces the pinned {protocolArtifact.release} validator
            from its one-shot seed. The source, compiled blueprint, and release
            evidence are public and do not depend on Baton remaining online.
          </p>
        </div>
        <dl>
          <div><dt>PROTOCOL RELEASE</dt><dd>{protocolArtifact.release}</dd></div>
          <div><dt>RAW VALIDATOR HASH</dt><dd className="mono">{shortHash(protocolArtifact.validatorHash, 12)}</dd></div>
          <div><dt>APPLIED POLICY ID</dt><dd className="mono">{shortHash(manifest.policyId, 12)}</dd></div>
          <div><dt>BLUEPRINT SHA-256</dt><dd className="mono">{shortHash(protocolArtifact.blueprintSha256, 12)}</dd></div>
          <div><dt>AIKEN COMPILER</dt><dd>{protocolArtifact.compiler}</dd></div>
          <div><dt>CURRENT RECEIPT</dt><dd>{receiptDisplayName(completed ? manifest.terminalReceiptName : manifest.receiptName)}</dd></div>
        </dl>
        <div className="protocol-links">
          <a href={`${EXPLORER_URL}/address/${manifest.validatorAddress}`} target="_blank" rel="noreferrer">Applied validator ↗</a>
          {protocolArtifact.sourceUrl && <a href={protocolArtifact.sourceUrl} target="_blank" rel="noreferrer">Validator source ↗</a>}
          <a href={protocolArtifact.blueprintUrl} target="_blank" rel="noreferrer">Compiled blueprint ↗</a>
          <a href={protocolArtifact.releaseManifestUrl} target="_blank" rel="noreferrer">Release manifest ↗</a>
          <Link href="/verify">Verify the plan file →</Link>
        </div>
      </section>}
    </div>
  );
}
