"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Assets } from "@lucid-evolution/lucid";
import Link from "next/link";
import { useWallet } from "@/app/providers";
import {
  type CreateField,
  type CreateValidationIssue,
  validateProtectStep,
  validateRecipientStep,
} from "@/lib/create-validation";
import {
  type EternlConnection,
  isExactWalletNetwork,
  isWalletSessionReady,
  reviewForWalletSession,
  walletErrorMessage,
} from "@/lib/eternl";
import {
  CARDANO_NETWORK,
  EXPLORER_URL,
  runtimeReadiness,
} from "@/lib/config";
import type { CreationReview } from "@/lib/transactions";
import {
  DAY_MS,
  formatAda,
  formatUtc,
  releaseAt,
  shortHash,
  SITE_FEE_LOVELACE,
} from "@/lib/product";
import {
  downloadManifest,
  storeManifest,
  type VaultManifest,
} from "@/lib/manifest";

type ReleaseMode = "fixed" | "bearer";
type WalletAsset = { unit: string; quantity: bigint };

export default function CreateVault() {
  const wallet = useWallet();
  const [step, setStep] = useState(1);
  const panelRef = useRef<HTMLElement>(null);
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    const heading = panelRef.current?.querySelector("h2");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    const headerBottom = document
      .querySelector<HTMLElement>(".site-header")
      ?.getBoundingClientRect().bottom ?? 0;
    const headingBox = heading.getBoundingClientRect();
    if (
      headingBox.top < headerBottom + 24 ||
      headingBox.bottom > window.innerHeight - 24
    ) {
      window.scrollTo({
        top: window.scrollY + headingBox.top - headerBottom - 24,
        behavior: "auto",
      });
    }
  }, [step]);
  const [periodDays, setPeriodDays] = useState(7);
  const [misses, setMisses] = useState(4);
  const [ada, setAda] = useState("25");
  const [livenessAddress, setLivenessAddress] = useState("");
  const [releaseMode, setReleaseMode] = useState<ReleaseMode>("fixed");
  const [destination, setDestination] = useState("");
  const [commitment, setCommitment] = useState("");
  const [walletAssets, setWalletAssets] = useState<WalletAsset[]>([]);
  const [protectedTokenUnits, setProtectedTokenUnits] = useState<string[]>([]);
  const [review, setReview] = useState<CreationReview | null>(null);
  const [reviewKey, setReviewKey] = useState("");
  const [reviewConnection, setReviewConnection] =
    useState<EternlConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepIssue, setStepIssue] = useState<CreateValidationIssue | null>(null);
  const [submittedHash, setSubmittedHash] = useState<string | null>(null);
  const [createdManifest, setCreatedManifest] = useState<VaultManifest | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const walletReady = isWalletSessionReady(
    wallet.connection,
    wallet.revalidating,
  );
  const visibleStepIssue =
    stepIssue?.field === "wallet" && walletReady ? null : stepIssue;

  useEffect(() => {
    if (!visibleStepIssue) return;
    const frame = window.requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        `[data-create-field="${visibleStepIssue.field}"]`,
      );
      if (!target) return;
      target.focus({ preventScroll: true });
      const headerBottom = document
        .querySelector<HTMLElement>(".site-header")
        ?.getBoundingClientRect().bottom ?? 0;
      const targetBox = target.getBoundingClientRect();
      if (
        targetBox.top < headerBottom + 24 ||
        targetBox.bottom > window.innerHeight - 80
      ) {
        window.scrollTo({
          top: window.scrollY + targetBox.top - headerBottom - 24,
          behavior: "auto",
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step, visibleStepIssue]);

  useEffect(() => {
    let cancelled = false;
    if (!wallet.connection) {
      return;
    }
    wallet.connection.lucid.wallet().getUtxos().then((utxos) => {
      const totals = new Map<string, bigint>();
      for (const utxo of utxos) {
        for (const [unit, quantity] of Object.entries(utxo.assets)) {
          if (unit !== "lovelace") {
            totals.set(unit, (totals.get(unit) ?? 0n) + quantity);
          }
        }
      }
      if (!cancelled) {
        setWalletAssets(
          [...totals].map(([unit, quantity]) => ({ unit, quantity })),
        );
      }
    }).catch(() => {
      if (!cancelled) setWalletAssets([]);
    });
    return () => { cancelled = true; };
  }, [wallet.connection]);

  const periodMs = periodDays * DAY_MS;
  const expectedRelease = releaseAt(clock, periodMs, misses);
  const selectedAssets = useMemo<Assets>(() => {
    const adaNumber = Number(ada || 0);
    const lovelaceNumber = Math.round(adaNumber * 1_000_000);
    const assets: Assets = {
      lovelace:
        Number.isFinite(lovelaceNumber) && Number.isSafeInteger(lovelaceNumber)
          ? BigInt(Math.max(0, lovelaceNumber))
          : 0n,
    };
    for (const unit of protectedTokenUnits) {
      const asset = walletAssets.find((candidate) => candidate.unit === unit);
      if (asset) assets[unit] = asset.quantity;
    }
    return assets;
  }, [ada, protectedTokenUnits, walletAssets]);
  const configurationKey = useMemo(
    () => JSON.stringify([
      periodDays,
      misses,
      livenessAddress,
      releaseMode,
      destination,
      commitment,
      Object.entries(selectedAssets).map(([unit, quantity]) => [unit, quantity.toString()]),
    ]),
    [
      commitment,
      destination,
      livenessAddress,
      misses,
      periodDays,
      releaseMode,
      selectedAssets,
    ],
  );
  const activeReview = reviewKey === configurationKey && walletReady
    ? reviewForWalletSession(review, reviewConnection, wallet.connection)
    : null;
  const protectValues = {
    connected: walletReady,
    ownerPaymentKeyHashes: walletReady
      ? wallet.connection?.paymentKeyHashes
      : undefined,
    ada,
    periodDays,
    misses,
    livenessAddress,
  };
  const recipientValues = { releaseMode, destination };
  const protectIssue = validateProtectStep(protectValues);
  const recipientIssue = validateRecipientStep(recipientValues);
  const furthestAvailableStep = protectIssue ? 1 : recipientIssue ? 2 : 3;

  function clearStepIssue(field: CreateField) {
    setStepIssue((current) => current?.field === field ? null : current);
  }

  function goToStep(nextStep: number) {
    if (nextStep > 1) {
      const issue = validateProtectStep(protectValues);
      if (issue) {
        setStepIssue(issue);
        setStep(1);
        return;
      }
    }
    if (nextStep > 2) {
      const issue = validateRecipientStep(recipientValues);
      if (issue) {
        setStepIssue(issue);
        setStep(2);
        return;
      }
    }
    setStepIssue(null);
    setError(null);
    if (nextStep === 3) setClock(Date.now());
    setStep(nextStep);
  }

  function invalidateReview() {
    setReview(null);
    setReviewKey("");
    setReviewConnection(null);
  }

  async function hashFile(file: File | undefined) {
    if (!file) return;
    invalidateReview();
    const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    setCommitment(
      [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    );
  }

  async function prepareTransaction() {
    const issue = validateProtectStep(protectValues) ?? validateRecipientStep(recipientValues);
    if (issue) {
      setStepIssue(issue);
      setStep(issue.step);
      return;
    }
    const connection = wallet.connection;
    if (!connection) {
      setError("Connect Eternl before constructing the transaction.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { buildCreation } = await import("@/lib/transactions");
      const rule = releaseMode === "fixed"
        ? { kind: "fixed" as const, address: destination }
        : { kind: "bearer" as const };
      const built = await buildCreation(connection.lucid, {
        protectedAssets: selectedAssets,
        livenessAddress,
        checkInPeriodMs: periodMs,
        missesToRelease: misses,
        releaseRule: rule,
        payloadCommitment: commitment || undefined,
      });
      setReview(built);
      setReviewKey(configurationKey);
      setReviewConnection(connection);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Transaction construction failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitTransaction() {
    if (!activeReview || !wallet.connection) return;
    const reviewed = activeReview;
    setBusy(true);
    setError(null);
    try {
      const { signAndSubmitCreation } = await import("@/lib/transactions");
      const txHash = await signAndSubmitCreation(reviewed);
      setSubmittedHash(txHash);
      invalidateReview();
      const reviewedMode = reviewed.releaseRule.kind;
      const created: VaultManifest = {
        version: 3,
        network: CARDANO_NETWORK,
        creationTx: txHash,
        seed: { txHash: reviewed.seed.txHash, outputIndex: reviewed.seed.outputIndex },
        receiptName: reviewed.contract.receiptName,
        terminalReceiptName: reviewed.contract.terminalReceiptName,
        recoveryReceiptName: reviewed.contract.recoveryReceiptName,
        policyId: reviewed.contract.policyId,
        receiptUnit: reviewed.contract.receiptUnit,
        terminalReceiptUnit: reviewed.contract.terminalReceiptUnit,
        validatorAddress: reviewed.contract.address,
        ownerKeyHash: reviewed.ownerKeyHash,
        livenessKeyHash: reviewed.livenessKeyHash,
        checkInPeriodMs: reviewed.checkInPeriodMs,
        missesToRelease: reviewed.missesToRelease,
        lastCheckInAtMs: reviewed.lastCheckInAt,
        releaseAtMs: reviewed.releaseAt,
        releaseMode: reviewedMode,
        destination:
          reviewed.releaseRule.kind === "fixed"
            ? reviewed.releaseRule.address
            : undefined,
        recoveryUnit:
          reviewed.releaseRule.kind === "bearer"
            ? `${reviewed.releaseRule.policyId}${reviewed.releaseRule.assetName}`
            : undefined,
        payloadCommitment: reviewed.payloadCommitment,
      };
      // Save immediately after submission. If the user opens the explorer or
      // closes the tab while confirmation is pending, the plan can still be
      // reopened and verified from Cardano.
      storeManifest(created);
      const confirmed = await wallet.connection.lucid.awaitTx(txHash);
      if (!confirmed) throw new Error("Transaction was submitted but confirmation was not observed.");
      setCreatedManifest(created);
    } catch (cause) {
      setError(
        walletErrorMessage(
          cause,
          "Eternl did not submit the transaction.",
          "transaction",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleProtected(unit: string) {
    invalidateReview();
    setProtectedTokenUnits((current) =>
      current.includes(unit)
        ? current.filter((candidate) => candidate !== unit)
        : [...current, unit],
    );
  }

  function walletConnectionTitle() {
    if (wallet.revalidating) return "Confirming your selected account…";
    if (wallet.connection) return shortHash(wallet.connection.address, 12);
    if (wallet.connectionActivity === "requesting") return "Waiting for your approval…";
    if (wallet.connectionActivity === "checking") return "Checking your wallet network…";
    if (wallet.connectionActivity === "switching") return "Updating to your selected account…";
    if (wallet.connectionActivity === "restoring") return "Restoring your account…";
    if (wallet.availability === "detecting") return "Looking for Eternl…";
    return wallet.available ? "Ready to connect" : "Eternl not detected";
  }

  const exactWalletNetwork = wallet.connection
    ? isExactWalletNetwork(wallet.connection)
    : false;

  return (
    <div className="create-shell page-shell">
      <header className="page-title compact-title">
        <p className="eyebrow">CREATE A HANDOFF PLAN · {CARDANO_NETWORK.toUpperCase()}</p>
        <h1>Decide what happens if you stop checking in.</h1>
        <p>Choose what to protect, how often you will check in, and how it can be received later. You will review every detail before Eternl asks you to approve anything.</p>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="wizard-layout">
        <aside className="wizard-nav" aria-label="Creation steps">
          {["Protect", "Choose recipient", "Review"].map((label, index) => (
            <button
              key={label}
              aria-current={step === index + 1 ? "step" : undefined}
              className={step === index + 1 ? "active" : step > index + 1 ? "complete" : ""}
              disabled={index + 1 > furthestAvailableStep || busy || Boolean(submittedHash)}
              title={index + 1 > furthestAvailableStep ? "Complete the previous step first" : undefined}
              onClick={() => goToStep(index + 1)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>{label}
            </button>
          ))}
          <div className="network-plate">
            <span>CARDANO NETWORK</span><strong>{CARDANO_NETWORK}</strong>
            <small>{runtimeReadiness.canCreate ? "Ready to create plans" : "Review mode only"}</small>
            <span className="plate-rule">ONE-TIME SETUP</span><strong>5 ADA</strong>
            <span className="plate-rule">LATER CHECK-INS</span><strong>No site fee</strong>
            <small>Normal Cardano network fees still apply.</small>
          </div>
        </aside>

        <section className="wizard-panel" ref={panelRef}>
          {step === 1 && (
            <div className="form-section">
              <div className="form-heading"><span>01</span><div><h2>What do you want to protect?</h2><p>Choose your assets and the wallet you will use for regular check-ins.</p></div></div>
              <div className="connection-card" data-create-field="wallet" tabIndex={-1} aria-busy={wallet.revalidating || undefined}>
                <div>
                  <span>YOUR ETERNL WALLET</span>
                  <strong>{walletConnectionTitle()}</strong>
                  <small>{wallet.revalidating
                    ? "Wallet actions are paused until this session is confirmed"
                    : wallet.connection
                      ? exactWalletNetwork
                        ? "Preprod verified for this browser session"
                        : "Testnet connected · confirm Preprod in Eternl"
                      : "Your wallet approves every transaction and keeps your keys."}</small>
                </div>
                {!wallet.connection && <button type="button" className="button secondary" onClick={() => { clearStepIssue("wallet"); void wallet.connect(); }} disabled={wallet.connecting || wallet.availability === "detecting"}>{wallet.connectionActionLabel}</button>}
                {wallet.connection && <span className={`ready-chip ${exactWalletNetwork && !wallet.revalidating ? "" : "manual"}`}>{wallet.revalidating ? "CHECKING ACCOUNT" : exactWalletNetwork ? `${CARDANO_NETWORK.toUpperCase()} VERIFIED` : `CHECK ${CARDANO_NETWORK.toUpperCase()}`}</span>}
              </div>
              {visibleStepIssue?.field === "wallet" && <p className="field-error wizard-field-error" role="alert">{visibleStepIssue.message}</p>}
              <div className="field-grid">
                <label className="field"><span>ADA to protect</span><div className="input-suffix"><input data-create-field="ada" type="number" min="5" step="0.000001" value={ada} aria-invalid={visibleStepIssue?.field === "ada" || undefined} onChange={(e) => { invalidateReview(); setAda(e.target.value); clearStepIssue("ada"); }} /><b>ADA</b></div><small>The 5 ADA site fee and network fee are additional.</small>{visibleStepIssue?.field === "ada" && <small className="field-error" role="alert">{visibleStepIssue.message}</small>}</label>
                <label className="field"><span>Check in every</span><div className="input-suffix"><input data-create-field="period" type="number" min="1" max="3650" value={periodDays} aria-invalid={visibleStepIssue?.field === "period" || undefined} onChange={(e) => { invalidateReview(); setPeriodDays(Number(e.target.value)); clearStepIssue("period"); }} /><b>DAYS</b></div>{visibleStepIssue?.field === "period" && <small className="field-error" role="alert">{visibleStepIssue.message}</small>}</label>
                <label className="field"><span>How many check-ins may be missed?</span><div className="input-suffix"><input data-create-field="misses" type="number" min="1" max="1000" value={misses} aria-invalid={visibleStepIssue?.field === "misses" || undefined} onChange={(e) => { invalidateReview(); setMisses(Number(e.target.value)); clearStepIssue("misses"); }} /><b>MISSES</b></div><small>Your handoff becomes available after the {misses}{misses === 1 ? "st" : misses === 2 ? "nd" : misses === 3 ? "rd" : "th"} missed check-in.</small>{visibleStepIssue?.field === "misses" && <small className="field-error" role="alert">{visibleStepIssue.message}</small>}</label>
                <label className="field"><span>Wallet used to check in</span><input data-create-field="liveness" value={livenessAddress} aria-invalid={visibleStepIssue?.field === "liveness" || undefined} onChange={(e) => { invalidateReview(); setLivenessAddress(e.target.value.trim()); clearStepIssue("liveness"); }} placeholder="addr_test1… from another Eternl account" /><small>For safety, use a different account from the one creating the plan. This wallet can check in but cannot take your assets.</small>{visibleStepIssue?.field === "liveness" && <small className="field-error" role="alert">{visibleStepIssue.message}</small>}</label>
              </div>

              {walletAssets.length > 0 && <div className="asset-picker"><div><h3>Tokens and NFTs</h3><p>Select any other Cardano assets you want to protect.</p></div><div className="asset-list">{walletAssets.map((asset) => <label key={asset.unit}><input type="checkbox" checked={protectedTokenUnits.includes(asset.unit)} onChange={() => toggleProtected(asset.unit)} /><span className="mono">{shortHash(asset.unit, 10)}</span><strong>{asset.quantity.toString()}</strong></label>)}</div></div>}

              <label className="file-commit"><input className="visually-hidden" type="file" onChange={(event) => hashFile(event.target.files?.[0])} /><span className="file-picker-action">{commitment ? "Choose another file" : "Choose a file"}</span><span><strong>Add proof of a file (optional)</strong><small>The file never leaves your device. Only a fingerprint is recorded so someone can later prove that an unchanged copy existed. This plan does not store or deliver the file.</small></span>{commitment && <code aria-live="polite">{shortHash(commitment, 12)}</code>}</label>
              <div className="form-actions"><span /><button className="button primary" disabled={wallet.revalidating} onClick={() => goToStep(2)}>Choose who can receive it</button></div>
            </div>
          )}

          {step === 2 && (
            <div className="form-section">
              <div className="form-heading"><span>02</span><div><h2>Choose one receiving method</h2><p>Each plan uses exactly one method. It cannot use both or switch methods later.</p></div></div>
              <div className="mode-selector">
                <button type="button" aria-pressed={releaseMode === "fixed"} className={releaseMode === "fixed" ? "selected" : ""} onClick={() => { invalidateReview(); setReleaseMode("fixed"); clearStepIssue("destination"); }}><span>OPTION 1 · ADDRESS CHOSEN NOW</span><strong>Fixed destination</strong><p>After the waiting period, the assets can only go to the exact Cardano address you enter. Recommended for most family plans.</p></button>
                <button type="button" aria-pressed={releaseMode === "bearer"} className={releaseMode === "bearer" ? "selected" : ""} onClick={() => { invalidateReview(); setReleaseMode("bearer"); clearStepIssue("destination"); }}><span>OPTION 2 · NO ADDRESS CHOSEN NOW</span><strong>Recovery token</strong><p>After the waiting period, whoever holds the unique token chooses the receiving address.</p></button>
              </div>
              {releaseMode === "bearer" ? (
                <div className="field full-field"><div className="field"><span>Your Baton recovery token</span><strong>Created automatically with this plan</strong><small>It will be placed in your wallet, outside the protected plan. Give it to someone you trust; whoever holds it after the waiting period can receive the assets.</small></div></div>
              ) : (
                <div className="field full-field"><label className="field"><span>Receiving Cardano address</span><input data-create-field="destination" value={destination} aria-invalid={visibleStepIssue?.field === "destination" || undefined} onChange={(e) => { invalidateReview(); setDestination(e.target.value.trim()); clearStepIssue("destination"); }} placeholder="addr_test1…" /><small>Check this carefully. The plan cannot replace or repair this address later.</small>{visibleStepIssue?.field === "destination" && <small className="field-error" role="alert">{visibleStepIssue.message}</small>}</label></div>
              )}
              <div className="risk-box"><strong>Choose enough time</strong><p>If you miss {misses} check-ins in a row, your handoff becomes available after {periodDays * misses} days—even if you are alive, traveling, ill, or unable to reach your check-in wallet.</p></div>
              <div className="form-actions"><button className="button secondary" onClick={() => goToStep(1)}>Back</button><button className="button primary" onClick={() => goToStep(3)}>Review my plan</button></div>
            </div>
          )}

          {step === 3 && (
            <div className="form-section">
              <div className="form-heading"><span>03</span><div><h2>Review your handoff plan</h2><p>Read each choice carefully. Eternl will not open until you ask to prepare the transaction.</p></div></div>
              <div className="review-ledger">
                <div><span>PROTECTED NOW</span><strong>{ada || "0"} ADA + {protectedTokenUnits.length} native asset{protectedTokenUnits.length === 1 ? "" : "s"}</strong></div>
                <div><span>CHECK-IN PERIOD</span><strong>Every {periodDays} days</strong></div>
                <div><span>ALLOWED MISSES</span><strong>{misses}</strong></div>
                <div><span>EXPECTED HANDOFF DATE IF CREATED NOW</span><strong>{formatUtc(expectedRelease)}</strong></div>
                <div><span>WHO CAN RECEIVE</span><strong>{releaseMode === "bearer" ? "Holder of the recovery token" : shortHash(destination || "Not entered", 12)}</strong></div>
                <div><span>ONE-TIME SITE FEE</span><strong>{formatAda(SITE_FEE_LOVELACE)}</strong></div>
                <div><span>LATER SITE FEES</span><strong>None</strong></div>
                <div><span>CAN THIS SITE TAKE YOUR ASSETS?</span><strong>No</strong></div>
              </div>

              {!runtimeReadiness.canCreate && <div className="launch-block"><span>REVIEW VERSION</span><strong>Creating a real plan is not enabled yet.</strong><p>You can review the full experience now. Signing will be enabled after the testnet setup and independent safety review are complete.</p></div>}

              {activeReview && <div className="tx-review"><div className="tx-review-head"><span>READY FOR YOUR APPROVAL</span><strong>{shortHash(activeReview.transactionHash, 12)}</strong></div><dl><div><dt>Plan identity</dt><dd className="mono">{shortHash(activeReview.contract.policyId, 12)}</dd></div><div><dt>Protected Cardano address</dt><dd className="mono">{shortHash(activeReview.contract.address, 14)}</dd></div><div><dt>Exactly what will be protected</dt><dd>{formatAda(activeReview.protectedAssets.lovelace ?? 0n)} + {Object.keys(activeReview.protectedAssets).filter((unit) => unit !== "lovelace").length} other asset(s)</dd></div><div><dt>Check in every</dt><dd>{activeReview.checkInPeriodMs / DAY_MS} days</dd></div><div><dt>Misses allowed</dt><dd>{activeReview.missesToRelease}</dd></div><div><dt>Who can receive</dt><dd>{activeReview.releaseRule.kind === "fixed" ? shortHash(activeReview.releaseRule.address, 12) : `Recovery token ${shortHash(`${activeReview.releaseRule.policyId}${activeReview.releaseRule.assetName}`, 12)}`}</dd></div><div><dt>Plan starts</dt><dd>{formatUtc(activeReview.lastCheckInAt)}</dd></div><div><dt>Handoff available after</dt><dd>{formatUtc(activeReview.releaseAt)}</dd></div><div><dt>One-time site fee</dt><dd>{formatAda(activeReview.siteFeeLovelace)}</dd></div><div><dt>Cardano network fee</dt><dd>{formatAda(activeReview.feeLovelace)}</dd></div><div><dt>Transaction size</dt><dd>{activeReview.transactionBytes.toLocaleString()} bytes</dd></div><div><dt>Assets moved during check-in</dt><dd>None</dd></div></dl></div>}

              {submittedHash ? <div className="success-box"><span>{createdManifest ? "CONFIRMED ON" : "PENDING ON"} {CARDANO_NETWORK.toUpperCase()}</span><h3>{createdManifest ? "Your handoff plan is protected." : "Waiting for confirmation…"}</h3><a href={`${EXPLORER_URL}/transaction/${submittedHash}`} target="_blank" rel="noreferrer">View Cardano transaction {shortHash(submittedHash, 12)} ↗</a>{createdManifest && <div className="success-actions"><button className="button secondary" onClick={() => downloadManifest(createdManifest)}>Download my plan file</button><Link className="button primary" href={`/vault/${submittedHash}`}>Open my handoff plan</Link></div>}<p>Keep the plan file in more than one safe place. It contains no private key or seed phrase, but it helps you return to and independently check this plan.</p></div> : <div className="form-actions"><button className="button secondary" onClick={() => { goToStep(2); invalidateReview(); }}>Back</button>{activeReview ? <button className="button primary" disabled={busy} onClick={submitTransaction}>{busy ? "Waiting for Eternl…" : "Approve in Eternl"}</button> : <button className="button primary" disabled={busy || wallet.revalidating || !runtimeReadiness.canCreate} onClick={prepareTransaction}>{busy ? "Preparing…" : wallet.revalidating ? "Checking account…" : "Prepare for Eternl"}</button>}</div>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
