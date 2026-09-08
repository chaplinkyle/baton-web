"use client";

import { useRef, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { cardanoErrorMessage } from "@/lib/cardano-errors";
import { CARDANO_NETWORK, EXPLORER_URL } from "@/lib/config";
import { parseManifest } from "@/lib/manifest";
import type { PlanVerificationReport } from "@/lib/plan-verification";
import { formatAda, formatUtc, shortHash } from "@/lib/product";

function ReportRow({
  label,
  value,
  detail,
  href,
}: {
  label: string;
  value: string;
  detail: string;
  href?: string;
}) {
  return (
    <div className="verification-row">
      <i aria-hidden="true">✓</i>
      <div>
        <span>{label}</span>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">{value} ↗</a>
        ) : (
          <strong>{value}</strong>
        )}
        <small>{detail}</small>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  const [text, setText] = useState("");
  const [report, setReport] = useState<PlanVerificationReport | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const verificationVersion = useRef(0);

  async function verify(raw = text) {
    const version = ++verificationVersion.current;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const parsed = parseManifest(raw);
      const { verifyPlan } = await import("@/lib/plan-verification");
      const nextReport = await verifyPlan(parsed);
      if (verificationVersion.current === version) setReport(nextReport);
    } catch (cause) {
      if (verificationVersion.current === version) {
        setError(cardanoErrorMessage(cause, "This plan could not be checked."));
      }
    } finally {
      if (verificationVersion.current === version) setBusy(false);
    }
  }

  function editText(value: string) {
    verificationVersion.current += 1;
    setText(value);
    setReport(null);
    setError(null);
    setBusy(false);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    const raw = await file.text();
    setText(raw);
    await verify(raw);
  }

  const lifecycle = report?.lifecycle;
  const currentUtxo = lifecycle?.state.utxo;
  const releaseRule = report?.manifest.releaseMode === "fixed"
    ? `Chosen address · ${shortHash(report.manifest.destination!, 12)}`
    : report
      ? `Recovery token · ${shortHash(report.manifest.recoveryUnit!, 12)}`
      : "";
  const feeValue = report?.creation.siteFee === "verified"
    ? formatAda(report.creation.siteFeeLovelace)
    : "No Baton setup-fee output";
  const feeDetail = report?.creation.siteFee === "verified"
    ? "One exact ADA-only output to the pinned Baton treasury was found."
    : "This can be valid direct contract use; the official interface fee was not present.";

  return (
    <div className="page-shell verify-shell">
      <header className="page-title compact-title">
        <p className="eyebrow">CHECK A PLAN</p>
        <h1>Confirm a handoff plan directly from Cardano.</h1>
        <p>
          Choose the plan file downloaded during setup. No account, wallet
          connection, or trust in this site is required.
        </p>
      </header>
      <div className="verify-grid">
        <section className="verify-input">
          <label className="manifest-drop">
            <input
              type="file"
              accept="application/json,.json"
              aria-label="Choose a Baton plan file"
              disabled={busy}
              onChange={(event) => void upload(event.target.files?.[0])}
            />
            <span className="manifest-drop-button" aria-hidden="true">Choose file</span>
            <span className="manifest-drop-copy">
              <strong>Open a Baton plan file</strong>
              <small>{fileName ?? "JSON file downloaded when the plan was created"}</small>
            </span>
          </label>
          <details>
            <summary>Or paste the plan file contents</summary>
            <textarea
              aria-label="Plan file contents"
              spellCheck={false}
              value={text}
              onChange={(event) => editText(event.target.value)}
              placeholder={'{\n  "version": 3,\n  "network": "Preprod"\n}'}
            />
          </details>
          <button
            className="button primary"
            onClick={() => void verify()}
            disabled={busy || !text}
          >
            {busy ? "Checking Cardano…" : "Check this plan"}
          </button>
        </section>
        <section className="verify-results" aria-live="polite" aria-busy={busy}>
          <div className="verification-heading">
            <div>
              <p className="eyebrow">PLAN CHECK</p>
              <h2>{report ? "Every required check passed" : "Independent verification"}</h2>
            </div>
            {report && <span>VERIFIED</span>}
          </div>
          {error && <ErrorBanner message={error} />}
          {!error && !report && (
            <div className="empty-report">
              <span aria-hidden="true">✓</span>
              <p>
                Baton will verify the contract, creation transaction, complete
                receipt history, current state, schedule, recipient method, and
                setup-fee evidence.
              </p>
            </div>
          )}
          {report && lifecycle && currentUtxo && (
            <div className="verification-report">
              <ReportRow
                label="Cardano network"
                value={`${report.manifest.network} · network magic ${CARDANO_NETWORK === "Preprod" ? 1 : CARDANO_NETWORK === "Preview" ? 2 : 764_824_073}`}
                detail="The manifest and applied validator address match this verifier's pinned network."
              />
              <ReportRow
                label="Pinned contract release"
                value={report.artifact.release}
                detail={`Raw validator ${shortHash(report.artifact.validatorHash, 12)} · ${report.artifact.compiler} · ${report.artifact.compiledBytes.toLocaleString()} compiled bytes · blueprint ${shortHash(report.artifact.blueprintSha256, 12)}`}
                href={report.artifact.blueprintUrl}
              />
              <ReportRow
                label="Applied validator"
                value={shortHash(report.manifest.policyId, 12)}
                detail={`The one-shot seed reproduces ${shortHash(report.manifest.validatorAddress, 14)} exactly.`}
                href={`${EXPLORER_URL}/address/${report.manifest.validatorAddress}`}
              />
              <ReportRow
                label="Receipt identities"
                value={`${report.manifest.receiptName} / ${report.manifest.terminalReceiptName}`}
                detail="The active and permanent completion NFTs both derive from the applied validator policy."
              />
              <ReportRow
                label="Creation transaction"
                value={shortHash(report.creation.txHash, 12)}
                detail={report.creation.confirmedAtMs
                  ? `Confirmed ${formatUtc(report.creation.confirmedAtMs)}; its datum reproduces the complete plan file.`
                  : "Confirmed creation datum reproduces the complete plan file."}
                href={`${EXPLORER_URL}/transaction/${report.creation.txHash}`}
              />
              <ReportRow
                label="Baton setup fee"
                value={feeValue}
                detail={feeDetail}
              />
              <ReportRow
                label="Current lifecycle output"
                value={`${lifecycle.kind === "active" ? "Active receipt" : "Completion receipt"} · ${shortHash(currentUtxo.txHash, 10)}#${currentUtxo.outputIndex}`}
                detail={lifecycle.kind === "active"
                  ? `Inline datum verified at sequence ${lifecycle.state.sequence}.`
                  : "The active receipt is retired and the completion receipt is final."}
                href={`${EXPLORER_URL}/transaction/${currentUtxo.txHash}`}
              />
              <ReportRow
                label="Schedule and datum"
                value={lifecycle.kind === "active"
                  ? `Handoff after ${formatUtc(lifecycle.state.releaseAtMs)}`
                  : `Final after ${report.history.length} confirmed records`}
                detail={`${report.manifest.missesToRelease} missed check-in${report.manifest.missesToRelease === 1 ? "" : "s"} × ${(report.manifest.checkInPeriodMs / 86_400_000).toLocaleString("en")} day period; immutable keys and payload commitment match.`}
              />
              <ReportRow
                label="Configured recipient method"
                value={releaseRule}
                detail={report.manifest.releaseMode === "fixed"
                  ? "After expiry, the protected value can only be released to the address committed at creation; a pre-expiry owner close remains separate."
                  : "The holder of the unique BATON_RECOVERY token chooses the receiving account after expiry."}
              />
              <ReportRow
                label="Canonical history"
                value={`${report.history.length} verified record${report.history.length === 1 ? "" : "s"}`}
                detail="Every check-in and completion transition forms one contiguous receipt-UTxO chain from creation to the current output."
              />
              <div className="verification-links">
                {report.artifact.sourceUrl && (
                  <a href={report.artifact.sourceUrl} target="_blank" rel="noreferrer">Validator source ↗</a>
                )}
                <a href={report.artifact.blueprintUrl} target="_blank" rel="noreferrer">Compiled blueprint ↗</a>
                <a href={report.artifact.releaseManifestUrl} target="_blank" rel="noreferrer">Release manifest ↗</a>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
