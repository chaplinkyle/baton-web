"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Buffer } from "buffer";
import { useWallet } from "@/app/providers";
import { cardanoErrorMessage } from "@/lib/cardano-errors";
import {
  parseManifest,
  storeManifest,
  storedManifests,
  type VaultManifest,
} from "@/lib/manifest";
import type { PlanRole } from "@/lib/plan-discovery";
import { formatAda, formatUtc, shortHash, vaultStatus } from "@/lib/product";
import type { VaultLifecycle } from "@/lib/vault-state";
import type { Assets, UTxO } from "@lucid-evolution/lucid";

type LoadedPlan = {
  manifest: VaultManifest;
  roles: PlanRole[];
  lifecycle?: VaultLifecycle;
  error?: string;
  foundThroughWallet: boolean;
};

const roleLabels: Record<PlanRole, string> = {
  owner: "You created it",
  "check-in": "You check in",
  recipient: "You can receive it",
  "recovery holder": "You hold the recovery token",
};

const statusLabels = {
  active: "Protected",
  due: "Check-in due soon",
  missed: "Check-in missed",
  claimable: "Handoff available",
};

function combineAssets(utxos: UTxO[]) {
  return utxos.reduce<Assets>((all, utxo) => {
    for (const [unit, quantity] of Object.entries(utxo.assets)) {
      all[unit] = (all[unit] ?? 0n) + quantity;
    }
    return all;
  }, {});
}

export default function PlansPage() {
  const wallet = useWallet();
  const [plans, setPlans] = useState<LoadedPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState("");
  const [adding, setAdding] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const refreshVersionRef = useRef(0);
  const waitingForWallet = wallet.connectionActivity !== "idle";
  const waitingForApproval = wallet.connectionActivity === "requesting";
  const checkingPreprod = wallet.connectionActivity === "checking";
  const plansArePending = loading || waitingForWallet;
  const walletProgressTitle = waitingForApproval
    ? "Waiting for Eternl…"
    : checkingPreprod
      ? "Checking your wallet network…"
      : "Restoring your wallet…";
  const walletProgressCopy = waitingForApproval
    ? "Approve or decline the connection in Eternl. Baton will search only after you approve it."
    : checkingPreprod
      ? "Eternl is approved. Baton is checking the network and preparing confirmed Cardano data; nothing is being signed or submitted."
      : "Baton is reconnecting to the account you already approved. No new approval is required.";

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = useCallback(async () => {
    const refreshVersion = ++refreshVersionRef.current;
    const connection = wallet.connection;
    const isCurrent = () => refreshVersionRef.current === refreshVersion;
    const browserGlobals = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
    browserGlobals.Buffer ??= Buffer;
    const [{ discoverWalletManifests, rolesForManifest }, { readOnlyLucid, readVaultLifecycle }] =
      await Promise.all([import("@/lib/plan-discovery"), import("@/lib/vault-state")]);
    setLoading(true);
    setError(null);
    const local = storedManifests();
    const merged = new Map<string, { manifest: VaultManifest; roles: PlanRole[]; foundThroughWallet: boolean }>();

    let walletAssets: Assets = {};
    if (connection) {
      try {
        walletAssets = combineAssets(await connection.lucid.wallet().getUtxos());
        const discovered = await discoverWalletManifests(
          connection.lucid,
          connection.paymentKeyHash,
        );
        if (!isCurrent()) return;
        for (const plan of discovered) {
          merged.set(plan.manifest.creationTx, {
            ...plan,
            foundThroughWallet: true,
          });
          storeManifest(plan.manifest);
        }
      } catch (cause) {
        if (!isCurrent()) return;
        setError(cardanoErrorMessage(cause, "Baton could not read this wallet's plans. Reopen Eternl and try again."));
      }
    }

    if (!isCurrent()) return;
    for (const manifest of local) {
      const existing = merged.get(manifest.creationTx);
      const roles = connection
        ? rolesForManifest(manifest, connection.paymentKeyHash, walletAssets)
        : [];
      merged.set(manifest.creationTx, {
        manifest,
        roles: existing?.roles.length ? existing.roles : roles,
        foundThroughWallet: existing?.foundThroughWallet ?? false,
      });
    }

    if (merged.size === 0) {
      if (!isCurrent()) return;
      setPlans([]);
      setLoading(false);
      return;
    }

    try {
      const lucid = connection?.lucid ?? await readOnlyLucid();
      if (!isCurrent()) return;
      const loaded = await Promise.all(
        [...merged.values()].map(async (plan): Promise<LoadedPlan> => {
          try {
            return {
              ...plan,
              lifecycle: await readVaultLifecycle(lucid, plan.manifest),
            };
          } catch (cause) {
            return {
              ...plan,
              error: cardanoErrorMessage(cause, "Plan status could not be read from Cardano."),
            };
          }
        }),
      );
      if (!isCurrent()) return;
      loaded.sort((left, right) => right.manifest.lastCheckInAtMs - left.manifest.lastCheckInAtMs);
      setPlans(loaded);
    } catch (cause) {
      if (!isCurrent()) return;
      setPlans([]);
      setError(cardanoErrorMessage(cause, "Baton could not read plans from Cardano."));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [wallet.connection]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timer);
      refreshVersionRef.current += 1;
    };
  }, [refresh]);

  async function addByTransaction() {
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      const { recoverManifestFromCreationTx } = await import("@/lib/plan-discovery");
      const manifest = await recoverManifestFromCreationTx(transactionId);
      storeManifest(manifest);
      setTransactionId("");
      setNotice("Plan verified on Cardano and added to this device.");
      await refresh();
    } catch (cause) {
      setError(cardanoErrorMessage(cause, "That plan could not be added."));
    } finally {
      setAdding(false);
    }
  }

  async function importPlan(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNotice(null);
    try {
      const manifest = parseManifest(await file.text());
      storeManifest(manifest);
      setNotice("Plan file verified and added to this device.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That plan file could not be opened.");
    }
  }

  return (
    <div className="page-shell plans-shell">
      <header className="page-title plans-title">
        <div>
          <p className="eyebrow">YOUR BATON PLANS</p>
          <h1>{wallet.connection ? "Everything connected to this wallet." : "Your saved Baton plans."}</h1>
          <p>{wallet.connection
            ? "See plans you created, plans you keep active, and handoffs you may receive. Every result is checked against Cardano before it appears."
            : "Connect Eternl to find plans tied to that account. Plans saved on this device stay visible, and every result is checked against Cardano."}</p>
        </div>
        <Link className="button primary" href="/create">Create a plan</Link>
      </header>

      <section className="plans-account">
        <div>
          <span>ETERNL WALLET</span>
          <strong>{wallet.connection
            ? shortHash(wallet.connection.address, 12)
            : waitingForApproval
              ? "Waiting for your approval"
              : checkingPreprod
                ? "Checking your wallet network"
              : wallet.connectionActivity === "restoring"
                ? "Restoring your account"
                : wallet.availability === "detecting"
                  ? "Looking for Eternl…"
                  : "Connect Eternl to find your plans"}</strong>
          <small>{wallet.connection
            ? loading
              ? "Searching Cardano and this device"
              : `${plans.length} verified plan${plans.length === 1 ? "" : "s"} found`
            : waitingForApproval
              ? "Approve Baton in Eternl; no transaction is being submitted"
              : checkingPreprod
                ? "Eternl is approved; nothing is being signed or submitted"
              : wallet.connectionActivity === "restoring"
                ? "Using the wallet access you already approved"
                : "Saved plans on this device remain visible"}</small>
        </div>
        {!wallet.connection && <button type="button" className="button secondary" onClick={() => void wallet.connect()} disabled={wallet.connecting || wallet.availability === "detecting"}>{wallet.connectionActionLabel}</button>}
        {wallet.connection && <button className="button secondary" onClick={() => void refresh()} disabled={loading}>{loading ? "Checking…" : "Refresh"}</button>}
      </section>

      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="plans-notice" role="status">{notice}</div>}

      <section className="plans-overview" aria-live="polite">
        <div><span>PLANS FOUND</span><strong>{plansArePending ? "—" : plans.length}</strong></div>
        <div><span>YOU CREATED</span><strong>{plansArePending ? "—" : plans.filter((plan) => plan.roles.includes("owner")).length}</strong></div>
        <div><span>YOU CHECK IN</span><strong>{plansArePending ? "—" : plans.filter((plan) => plan.roles.includes("check-in")).length}</strong></div>
        <div><span>YOU CAN RECEIVE</span><strong>{plansArePending ? "—" : plans.filter((plan) => plan.roles.includes("recipient") || plan.roles.includes("recovery holder")).length}</strong></div>
      </section>

      <section className="plans-list">
        {waitingForWallet && <div className="plans-empty" role="status"><span aria-hidden="true">B</span><h2>{walletProgressTitle}</h2><p>{walletProgressCopy}</p></div>}
        {!waitingForWallet && loading && <div className="plans-empty" role="status"><span aria-hidden="true">B</span><h2>Checking your plans…</h2><p>Baton is comparing locally saved records with confirmed Cardano state.</p></div>}
        {!waitingForWallet && !loading && plans.length === 0 && <div className="plans-empty"><span aria-hidden="true">B</span><h2>No plans found yet</h2><p>Connect the relevant Eternl account, create a plan, or add an older plan below using its transaction ID.</p></div>}
        {!waitingForWallet && !loading && plans.map((plan) => {
          const active = plan.lifecycle?.kind === "active" ? plan.lifecycle.state : null;
          const status = active
            ? vaultStatus(clock, active.lastCheckInAtMs, plan.manifest.checkInPeriodMs, plan.manifest.missesToRelease)
            : null;
          return (
            <article className={`plan-card ${status ? `plan-${status}` : ""}`} key={plan.manifest.creationTx}>
              <div className="plan-card-head">
                <div>
                  <span className="plan-id">PLAN {shortHash(plan.manifest.creationTx, 7).toUpperCase()}</span>
                  <h2>{plan.lifecycle?.kind === "completed" ? "Completed plan" : status ? statusLabels[status] : "Saved plan"}</h2>
                </div>
                <div className="plan-roles">
                  {plan.roles.length > 0
                    ? plan.roles.map((role) => <span key={role}>{roleLabels[role]}</span>)
                    : <span>Saved on this device</span>}
                </div>
              </div>
              {plan.error ? <p className="plan-error">{plan.error}</p> : <div className="plan-facts">
                <div><span>PROTECTED</span><strong>{active ? formatAda(active.utxo.assets.lovelace ?? 0n) : "Plan complete"}</strong></div>
                <div><span>CHECK-IN SCHEDULE</span><strong>Every {plan.manifest.checkInPeriodMs / 86_400_000} days · {plan.manifest.missesToRelease} misses</strong></div>
                <div><span>HANDOFF</span><strong>{active ? formatUtc(active.releaseAtMs) : "Completed on Cardano"}</strong></div>
                <div><span>RECEIVING METHOD</span><strong>{plan.manifest.releaseMode === "fixed" ? "Chosen address" : "Recovery token"}</strong></div>
              </div>}
              <div className="plan-card-foot">
                <span>{plan.foundThroughWallet ? "Found through this wallet" : "Saved on this device"}</span>
                <Link className="button secondary" href={`/vault/${plan.manifest.creationTx}`}>Open plan</Link>
              </div>
            </article>
          );
        })}
      </section>

      <section className="add-plan-panel">
        <div>
          <p className="eyebrow">ADD AN OLDER PLAN</p>
          <h2>Have a plan that is not listed?</h2>
          <p>Paste its creation transaction ID or choose its Baton plan file. Baton reconstructs the contract and rejects records that do not match the chain.</p>
        </div>
        <div className="add-plan-controls">
          <label className="field">
            <span>Creation transaction ID</span>
            <input value={transactionId} onChange={(event) => setTransactionId(event.target.value.trim())} placeholder="64-character transaction ID" />
          </label>
          <button className="button primary" onClick={addByTransaction} disabled={adding || transactionId.length === 0}>{adding ? "Checking Cardano…" : "Add this plan"}</button>
          <label className="plan-file-button">
            <input type="file" accept="application/json,.json" onChange={(event) => void importPlan(event.target.files?.[0])} />
            <span>Or choose a Baton plan file</span>
          </label>
        </div>
      </section>
    </div>
  );
}
