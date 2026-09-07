import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Koios,
  Lucid,
  getAddressDetails,
  type LucidEvolution,
  type TxSignBuilder,
} from "@lucid-evolution/lucid";
import {
  AUTOMATION_ROLES,
  PREPROD_KOIOS,
  loadAutomationWallets,
  type AutomationRole,
} from "./preprod-wallets";
import type { VaultManifest } from "../lib/manifest";
import type { CreationReview } from "../lib/transactions";
import type { ActionReview, ConfirmedVaultState } from "../lib/vault-state";
import { normalizeKoiosJson } from "../lib/koios-normalize";

const EXPLORER = "https://preprod.cardanoscan.io/transaction";
const MIN_OWNER_FUNDS = 250_000_000n;
const ROLE_FUNDS = 40_000_000n;
const MAX_TX_FEE = 5_000_000n;
const MAX_TX_BYTES = 16_384;
const RELEASE_PERIOD_MS = 10_000;
const BACKDATE_MS = 10 * 60_000;
const CONFIRMATION_TIMEOUT_MS = 5 * 60_000;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const siteDirectory = path.resolve(scriptDirectory, "..");
const repositoryDirectory = siteDirectory;
const runStartedAt = new Date().toISOString();
const runId = runStartedAt.replaceAll(":", "-");
const requestedEvidencePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const evidencePath = requestedEvidencePath ?? path.join(
  repositoryDirectory,
  "artifacts",
  "preprod-automation",
  `run-${runId}.json`,
);
const evidenceDirectory = path.dirname(evidencePath);

type TxRecord = {
  action: string;
  txId: string | null;
  submitterAddress: string;
  confirmedAt: string | null;
  networkFeeLovelace: string | null;
  siteFeeLovelace: string;
  transactionBytes: number;
  sequence: number;
  stateLastCheckInAt: string;
  stateReleaseAt: string;
  result: "pass";
  notes: string;
};

type LifecycleRecord = {
  path: "fixed-close" | "fixed-release" | "bearer-release";
  vaultId?: string;
  ownerAddress: string;
  livenessAddress: string;
  destinationAddress?: string;
  executorAddress?: string;
  recoveryUnit?: string;
  recoveryTokenHolderAddress?: string;
  nonHolderAddress?: string;
  periodMs: number;
  missesToRelease: number;
  lastCheckInAt?: string;
  releaseAt?: string;
  transactions: TxRecord[];
  manifest?: VaultManifest;
};

type EvidenceRecord = {
  schemaVersion: 1;
  purpose: string;
  network: "Preprod";
  startedAt: string;
  completedAt: string | null;
  result: "running" | "pass" | "fail";
  walletAddresses: Record<string, string>;
  auxiliaryTransactions: Array<{ action: string; txId: string; confirmedAt: string }>;
  runs: LifecycleRecord[];
  error?: string;
};

let evidence: EvidenceRecord = {
  schemaVersion: 1,
  purpose: "Automated Baton public-Preprod lifecycle test; contains no private keys.",
  network: "Preprod",
  startedAt: runStartedAt,
  completedAt: null,
  result: "running",
  walletAddresses: {},
  auxiliaryTransactions: [],
  runs: [],
};

async function loadResumeEvidence() {
  const parsed = JSON.parse(await readFile(evidencePath, "utf8")) as EvidenceRecord;
  if (parsed.schemaVersion !== 1 || parsed.network !== "Preprod" || !Array.isArray(parsed.runs)) {
    throw new Error("Resume evidence is not a Baton Preprod automation record.");
  }
  const allowedPaths = new Set(["fixed-close", "fixed-release", "bearer-release"]);
  if (parsed.runs.length === 0 || parsed.runs.length > allowedPaths.size) {
    throw new Error("Resume evidence must contain one to three Baton lifecycle runs.");
  }
  for (const run of parsed.runs) {
    if (!allowedPaths.has(run.path) || !run.manifest) {
      throw new Error("Resume evidence contains an unsupported or incomplete lifecycle run.");
    }
  }
  evidence = parsed;
  evidence.completedAt = null;
  evidence.result = "running";
  delete evidence.error;
}

function assertAutomationEnvironment() {
  if (
    process.env.NEXT_PUBLIC_CARDANO_NETWORK === "Mainnet" ||
    process.env.CARDANO_NETWORK === "Mainnet"
  ) {
    throw new Error("Refusing to run automated signing while Mainnet is selected.");
  }
  process.env.NEXT_PUBLIC_CARDANO_NETWORK = "Preprod";
  process.env.NEXT_PUBLIC_KOIOS_URL = PREPROD_KOIOS;
  process.env.NEXT_PUBLIC_MAINNET_RELEASE_ACK = "";
}

function installKoiosResponseNormalizer() {
  const upstreamFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const response = await upstreamFetch(input, init);
    if (!url.startsWith(PREPROD_KOIOS) || !new URL(url).pathname.endsWith("/tx_info")) {
      return response;
    }

    const text = await response.text();
    try {
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(JSON.stringify(normalizeKoiosJson(JSON.parse(text))), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
  };
}

async function saveEvidence() {
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function iso(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function assertReviewBudget(review: { feeLovelace: bigint; transactionBytes: number }, label: string) {
  if (review.feeLovelace <= 0n || review.feeLovelace >= MAX_TX_FEE) {
    throw new Error(`${label} network fee is outside the automated safety ceiling.`);
  }
  if (review.transactionBytes <= 0 || review.transactionBytes >= MAX_TX_BYTES) {
    throw new Error(`${label} transaction size is outside the Cardano safety ceiling.`);
  }
}

function manifestFrom(
  creationTx: string,
  review: CreationReview,
  release: Pick<VaultManifest, "releaseMode" | "destination" | "recoveryUnit">,
): VaultManifest {
  return {
    version: 3,
    network: "Preprod",
    creationTx,
    seed: { txHash: review.seed.txHash, outputIndex: review.seed.outputIndex },
    receiptName: review.contract.receiptName,
    terminalReceiptName: review.contract.terminalReceiptName,
    recoveryReceiptName: review.contract.recoveryReceiptName,
    policyId: review.contract.policyId,
    receiptUnit: review.contract.receiptUnit,
    terminalReceiptUnit: review.contract.terminalReceiptUnit,
    validatorAddress: review.contract.address,
    ownerKeyHash: review.ownerKeyHash,
    livenessKeyHash: review.livenessKeyHash,
    checkInPeriodMs: review.checkInPeriodMs,
    missesToRelease: review.missesToRelease,
    lastCheckInAtMs: review.lastCheckInAt,
    releaseAtMs: review.releaseAt,
    payloadCommitment: review.payloadCommitment,
    ...release,
  };
}

function creationRecord(review: CreationReview, txId: string, ownerAddress: string): TxRecord {
  return {
    action: "create",
    txId,
    submitterAddress: ownerAddress,
    confirmedAt: new Date().toISOString(),
    networkFeeLovelace: review.feeLovelace.toString(),
    siteFeeLovelace: review.siteFeeLovelace.toString(),
    transactionBytes: review.transactionBytes,
    sequence: 0,
    stateLastCheckInAt: iso(review.lastCheckInAt),
    stateReleaseAt: iso(review.releaseAt),
    result: "pass",
    notes: "Created and confirmed through the official Baton 5 ADA interface-fee path.",
  };
}

function actionRecord(
  review: ActionReview,
  txId: string,
  submitterAddress: string,
  state: ConfirmedVaultState,
): TxRecord {
  const lastCheckInAt = review.newCheckInAt ?? state.lastCheckInAtMs;
  const releaseAt = review.newReleaseAt ?? state.releaseAtMs;
  return {
    action: review.action,
    txId,
    submitterAddress,
    confirmedAt: new Date().toISOString(),
    networkFeeLovelace: review.feeLovelace.toString(),
    siteFeeLovelace: "0",
    transactionBytes: review.transactionBytes,
    sequence: review.action === "pulse" ? state.sequence + 1 : state.sequence,
    stateLastCheckInAt: iso(lastCheckInAt),
    stateReleaseAt: iso(releaseAt),
    result: "pass",
    notes: `${review.action} built, signed by an isolated software wallet, submitted, and confirmed on Preprod.`,
  };
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out.`)), CONFIRMATION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function confirm(lucid: LucidEvolution, txId: string) {
  const confirmed = await withTimeout(lucid.awaitTx(txId, 5_000), `Confirmation ${txId}`);
  if (!confirmed) throw new Error(`Transaction ${txId} was not confirmed.`);
  console.log(`confirmed: ${EXPLORER}/${txId}`);
}

async function retry<T>(label: string, operation: () => Promise<T>, attempts = 20): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (cause) {
      lastError = cause;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
  throw new Error(`${label} did not become visible through Koios.`, { cause: lastError });
}

async function submitDraft(lucid: LucidEvolution, draft: TxSignBuilder, label: string) {
  const transaction = draft.toTransaction();
  const feeLovelace = BigInt(transaction.body().fee().toString());
  const transactionBytes = draft.toCBOR({ canonical: true }).length / 2;
  assertReviewBudget({ feeLovelace, transactionBytes }, label);
  const signed = await draft.sign.withWallet().complete();
  const txId = await signed.submit();
  await confirm(lucid, txId);
  return { txId, feeLovelace, transactionBytes };
}

async function totalLovelace(lucid: LucidEvolution, address: string) {
  return (await lucid.utxosAt(address)).reduce(
    (total, utxo) => total + (utxo.assets.lovelace ?? 0n),
    0n,
  );
}

async function main() {
  assertAutomationEnvironment();
  installKoiosResponseNormalizer();
  if (requestedEvidencePath) await loadResumeEvidence();
  const walletFile = await loadAutomationWallets();
  for (const role of AUTOMATION_ROLES) {
    const address = walletFile.wallets[role].address;
    if (!address.startsWith("addr_test1") || getAddressDetails(address).networkId !== 0) {
      throw new Error(`Refusing non-testnet ${role} address.`);
    }
    const recordedAddress = evidence.walletAddresses[role];
    if (requestedEvidencePath && recordedAddress && recordedAddress !== address) {
      throw new Error(`Resume evidence ${role} address does not match the isolated wallet file.`);
    }
    evidence.walletAddresses[role] = address;
  }
  await saveEvidence();

  const lucid = await Lucid(new Koios(PREPROD_KOIOS), "Preprod");
  const select = (role: AutomationRole) => {
    lucid.selectWallet.fromPrivateKey(walletFile.wallets[role].privateKey);
    return walletFile.wallets[role].address;
  };
  const ownerAddress = select("owner");
  const ownerFunds = await totalLovelace(lucid, ownerAddress);
  if (ownerFunds < MIN_OWNER_FUNDS) {
    throw new Error(
      `Automated owner needs at least 250 test ADA. Fund this Preprod address from the official faucet: ${ownerAddress}`,
    );
  }

  const fundingTargets = ["liveness", "executor", "recovery_holder"] as const;
  let fundingBuilder = lucid.newTx();
  let needsFunding = false;
  for (const role of fundingTargets) {
    const balance = await totalLovelace(lucid, walletFile.wallets[role].address);
    if (balance < ROLE_FUNDS) {
      fundingBuilder = fundingBuilder.pay.ToAddress(walletFile.wallets[role].address, {
        lovelace: ROLE_FUNDS - balance,
      });
      needsFunding = true;
    }
  }
  if (needsFunding && !requestedEvidencePath) {
    console.log("funding automated action wallets...");
    const funding = await fundingBuilder.complete();
    const submitted = await submitDraft(lucid, funding, "role funding");
    evidence.auxiliaryTransactions.push({
      action: "fund automated action wallets",
      txId: submitted.txId,
      confirmedAt: new Date().toISOString(),
    });
    await saveEvidence();
  }

  const [{ buildCreation, signAndSubmitCreation }, vaultState] = await Promise.all([
    import("../lib/transactions"),
    import("../lib/vault-state"),
  ]);
  const beneficiaryAddress = walletFile.wallets.beneficiary.address;
  const livenessAddress = walletFile.wallets.liveness.address;

  function requireRun(runPath: LifecycleRecord["path"]) {
    const run = evidence.runs.find((candidate) => candidate.path === runPath);
    if (!run?.manifest) throw new Error(`Missing ${runPath} plan in resume evidence.`);
    return { run, manifest: run.manifest };
  }

  async function submitReleaseAfterNodeBoundary(
    build: () => Promise<ActionReview>,
    label: string,
  ) {
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const review = await build();
      assertReviewBudget(review, label);
      try {
        const txId = await vaultState.signAndSubmitAction(review);
        await confirm(lucid, txId);
        return { review, txId };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (!/OutsideValidityIntervalUTxO/.test(message) || attempt === 12) throw cause;
        console.log(`${label}: waiting for the Preprod node to cross the release boundary...`);
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
    throw new Error(`${label} exhausted its release-boundary retries.`);
  }

  async function resumeExistingRuns() {
    console.log(`resuming public-Preprod evidence: ${evidencePath}`);
    const fixedClose = requireRun("fixed-close");
    const fixedRelease = requireRun("fixed-release");
    const bearerRelease = requireRun("bearer-release");

    console.log("finishing the five-pulse owner-close plan...");
    const closeLifecycle = await retry("fixed-close lifecycle", () =>
      vaultState.readVaultLifecycle(lucid, fixedClose.manifest));
    if (closeLifecycle.kind === "active") {
      let closeState = closeLifecycle.state;
      select("liveness");
      while (closeState.sequence < 5) {
        const pulseNumber = closeState.sequence + 1;
        const pulse = await vaultState.buildPulse(lucid, fixedClose.manifest, closeState);
        assertReviewBudget(pulse, `pulse ${pulseNumber}`);
        const txId = await vaultState.signAndSubmitAction(pulse);
        await confirm(lucid, txId);
        fixedClose.run.transactions.push(actionRecord(pulse, txId, livenessAddress, closeState));
        closeState = await retry(`pulse ${pulseNumber} state`, () =>
          vaultState.readConfirmedVault(lucid, fixedClose.manifest));
        if (closeState.sequence !== pulseNumber) {
          throw new Error(`Pulse ${pulseNumber} sequence did not advance.`);
        }
        fixedClose.run.lastCheckInAt = iso(closeState.lastCheckInAtMs);
        fixedClose.run.releaseAt = iso(closeState.releaseAtMs);
        await saveEvidence();
      }

      select("owner");
      const close = await vaultState.buildClose(lucid, fixedClose.manifest, closeState);
      assertReviewBudget(close, "owner close");
      const closeTx = await vaultState.signAndSubmitAction(close);
      await confirm(lucid, closeTx);
      fixedClose.run.transactions.push(actionRecord(close, closeTx, ownerAddress, closeState));
      await saveEvidence();
    }
    const closed = await retry("completed owner-close state", () =>
      vaultState.readVaultLifecycle(lucid, fixedClose.manifest));
    if (
      closed.kind !== "completed" ||
      closed.state.utxo.address !== ownerAddress ||
      closed.state.utxo.assets.lovelace !== 15_000_000n
    ) throw new Error("Owner close did not return the exact protected bundle to the owner.");
    await saveEvidence();

    console.log("releasing the expired fixed-beneficiary plan...");
    const fixedLifecycle = await retry("fixed-release lifecycle", () =>
      vaultState.readVaultLifecycle(lucid, fixedRelease.manifest));
    if (fixedLifecycle.kind === "active") {
      const fixedState = fixedLifecycle.state;
      select("executor");
      const submitted = await submitReleaseAfterNodeBoundary(
        () => vaultState.buildRelease(lucid, fixedRelease.manifest, fixedState),
        "fixed release",
      );
      fixedRelease.run.transactions.push(
        actionRecord(
          submitted.review,
          submitted.txId,
          walletFile.wallets.executor.address,
          fixedState,
        ),
      );
      await saveEvidence();
    }
    const fixedPayout = await retry("fixed beneficiary payout", () =>
      lucid.utxoByUnit(fixedRelease.manifest.terminalReceiptUnit));
    if (fixedPayout.address !== beneficiaryAddress || fixedPayout.assets.lovelace !== 15_000_000n) {
      throw new Error("Fixed release did not pay the exact protected bundle to the beneficiary.");
    }
    await saveEvidence();

    console.log("proving bearer rejection and recovery-holder release...");
    const bearerLifecycle = await retry("bearer-release lifecycle", () =>
      vaultState.readVaultLifecycle(lucid, bearerRelease.manifest));
    if (bearerLifecycle.kind === "active") {
      const bearerState = bearerLifecycle.state;
      select("non_holder");
      let rejected = false;
      try {
        await vaultState.buildRelease(lucid, bearerRelease.manifest, bearerState);
      } catch (cause) {
        rejected = /does not hold the recovery token/.test(
          cause instanceof Error ? cause.message : String(cause),
        );
      }
      if (!rejected) throw new Error("Bearer release was not rejected for the non-holder.");
      if (!bearerRelease.run.transactions.some((transaction) => transaction.action === "rejected-release")) {
        bearerRelease.run.transactions.push({
          action: "rejected-release",
          txId: null,
          submitterAddress: walletFile.wallets.non_holder.address,
          confirmedAt: null,
          networkFeeLovelace: null,
          siteFeeLovelace: "0",
          transactionBytes: 0,
          sequence: bearerState.sequence,
          stateLastCheckInAt: iso(bearerState.lastCheckInAtMs),
          stateReleaseAt: iso(bearerState.releaseAtMs),
          result: "pass",
          notes: "Off-chain construction rejected a wallet without the one-shot recovery token.",
        });
        await saveEvidence();
      }

      select("recovery_holder");
      const submitted = await submitReleaseAfterNodeBoundary(
        () => vaultState.buildRelease(lucid, bearerRelease.manifest, bearerState),
        "bearer release",
      );
      bearerRelease.run.transactions.push(
        actionRecord(
          submitted.review,
          submitted.txId,
          walletFile.wallets.recovery_holder.address,
          bearerState,
        ),
      );
      await saveEvidence();
    }
    const bearerPayout = await retry("bearer-holder payout", () =>
      lucid.utxoByUnit(bearerRelease.manifest.terminalReceiptUnit));
    if (
      bearerPayout.address !== walletFile.wallets.recovery_holder.address ||
      bearerPayout.assets.lovelace !== 15_000_000n ||
      bearerPayout.assets[bearerRelease.manifest.recoveryUnit!] !== 1n
    ) {
      throw new Error("Bearer release did not pay the exact bundle and recovery token to its holder.");
    }

    evidence.completedAt = new Date().toISOString();
    evidence.result = "pass";
    await saveEvidence();
    console.log("PASS: all three existing Baton lifecycles completed automatically on public Preprod.");
    console.log(`Evidence: ${evidencePath}`);
  }

  async function createRun(
    runPath: LifecycleRecord["path"],
    releaseRule: { kind: "fixed"; address: string } | { kind: "bearer" },
    periodMs: number,
    missesToRelease: number,
    nowMs: number,
  ) {
    select("owner");
    const review = await buildCreation(lucid, {
      protectedAssets: { lovelace: 15_000_000n },
      livenessAddress,
      checkInPeriodMs: periodMs,
      missesToRelease,
      releaseRule,
    }, nowMs);
    assertReviewBudget(review, `${runPath} creation`);
    if (review.siteFeeLovelace !== 5_000_000n) throw new Error("Creation did not contain the exact 5 ADA site fee.");
    const txId = await signAndSubmitCreation(review);
    await confirm(lucid, txId);
    const manifest = manifestFrom(
      txId,
      review,
      releaseRule.kind === "fixed"
        ? { releaseMode: "fixed", destination: releaseRule.address }
        : { releaseMode: "bearer", recoveryUnit: review.contract.recoveryReceiptUnit },
    );
    const run: LifecycleRecord = {
      path: runPath,
      vaultId: manifest.receiptUnit,
      ownerAddress,
      livenessAddress,
      periodMs,
      missesToRelease,
      lastCheckInAt: iso(review.lastCheckInAt),
      releaseAt: iso(review.releaseAt),
      transactions: [creationRecord(review, txId, ownerAddress)],
      manifest,
    };
    evidence.runs.push(run);
    await saveEvidence();
    const state = await retry(`${runPath} state`, () => vaultState.readConfirmedVault(lucid, manifest));
    if (state.sequence !== 0 || state.utxo.assets.lovelace !== 15_000_000n) {
      throw new Error(`${runPath} creation state does not match the protected bundle.`);
    }
    return { run, manifest, state };
  }

  if (requestedEvidencePath) {
    let fixedRelease = evidence.runs.find((run) => run.path === "fixed-release");
    if (!fixedRelease) {
      console.log("creating missing short-expiry fixed-release plan...");
      fixedRelease = (await createRun(
        "fixed-release",
        { kind: "fixed", address: beneficiaryAddress },
        RELEASE_PERIOD_MS,
        1,
        Date.now() - BACKDATE_MS,
      )).run;
    }
    fixedRelease.destinationAddress = beneficiaryAddress;
    fixedRelease.executorAddress = walletFile.wallets.executor.address;

    let bearerRelease = evidence.runs.find((run) => run.path === "bearer-release");
    if (!bearerRelease) {
      console.log("creating missing short-expiry bearer-release plan...");
      bearerRelease = (await createRun(
        "bearer-release",
        { kind: "bearer" },
        RELEASE_PERIOD_MS,
        1,
        Date.now() - BACKDATE_MS,
      )).run;
    }
    bearerRelease.recoveryUnit = bearerRelease.manifest!.recoveryUnit;
    bearerRelease.recoveryTokenHolderAddress = walletFile.wallets.recovery_holder.address;
    bearerRelease.nonHolderAddress = walletFile.wallets.non_holder.address;

    const recoveryUnit = bearerRelease.manifest!.recoveryUnit!;
    const recoveryToken = await retry("recovery token lookup", () => lucid.utxoByUnit(recoveryUnit));
    if (recoveryToken.address !== walletFile.wallets.recovery_holder.address) {
      if (recoveryToken.address !== ownerAddress) {
        throw new Error("Recovery token is held by an unexpected address; refusing to move it.");
      }
      select("owner");
      const transfer = await lucid
        .newTx()
        .pay.ToAddress(walletFile.wallets.recovery_holder.address, { [recoveryUnit]: 1n })
        .complete();
      const submitted = await submitDraft(lucid, transfer, "recovery token transfer");
      evidence.auxiliaryTransactions.push({
        action: "transfer one-shot recovery token",
        txId: submitted.txId,
        confirmedAt: new Date().toISOString(),
      });
      const transferred = await retry("recovery token transfer", () =>
        lucid.utxoByUnit(recoveryUnit));
      if (transferred.address !== walletFile.wallets.recovery_holder.address) {
        throw new Error("Recovery token did not reach the designated holder.");
      }
    }

    if (!evidence.runs.some((run) => run.path === "fixed-close")) {
      console.log("creating missing five-pulse owner-close plan...");
      await createRun(
        "fixed-close",
        { kind: "fixed", address: beneficiaryAddress },
        86_400_000,
        2,
        Date.now(),
      );
    }
    await saveEvidence();
    await resumeExistingRuns();
    return;
  }

  console.log("creating short-expiry fixed-release plan...");
  const fixedRelease = await createRun(
    "fixed-release",
    { kind: "fixed", address: beneficiaryAddress },
    RELEASE_PERIOD_MS,
    1,
    Date.now() - BACKDATE_MS,
  );
  fixedRelease.run.destinationAddress = beneficiaryAddress;
  fixedRelease.run.executorAddress = walletFile.wallets.executor.address;

  console.log("creating short-expiry bearer-release plan...");
  const bearerRelease = await createRun(
    "bearer-release",
    { kind: "bearer" },
    RELEASE_PERIOD_MS,
    1,
    Date.now() - BACKDATE_MS,
  );
  bearerRelease.run.recoveryUnit = bearerRelease.manifest.recoveryUnit;
  bearerRelease.run.recoveryTokenHolderAddress = walletFile.wallets.recovery_holder.address;
  bearerRelease.run.nonHolderAddress = walletFile.wallets.non_holder.address;

  select("owner");
  const transfer = await lucid
    .newTx()
    .pay.ToAddress(walletFile.wallets.recovery_holder.address, {
      [bearerRelease.manifest.recoveryUnit!]: 1n,
    })
    .complete();
  const transferResult = await submitDraft(lucid, transfer, "recovery token transfer");
  evidence.auxiliaryTransactions.push({
    action: "transfer one-shot recovery token",
    txId: transferResult.txId,
    confirmedAt: new Date().toISOString(),
  });
  const tokenUtxo = await retry("recovery token transfer", () => lucid.utxoByUnit(bearerRelease.manifest.recoveryUnit!));
  if (tokenUtxo.address !== walletFile.wallets.recovery_holder.address) {
    throw new Error("Recovery token did not reach the designated automated holder.");
  }
  await saveEvidence();

  console.log("creating five-pulse owner-close plan...");
  const fixedClose = await createRun(
    "fixed-close",
    { kind: "fixed", address: beneficiaryAddress },
    86_400_000,
    2,
    Date.now(),
  );
  let closeState = fixedClose.state;
  select("liveness");
  for (let pulseNumber = 1; pulseNumber <= 5; pulseNumber += 1) {
    const pulse = await vaultState.buildPulse(lucid, fixedClose.manifest, closeState);
    assertReviewBudget(pulse, `pulse ${pulseNumber}`);
    const txId = await vaultState.signAndSubmitAction(pulse);
    await confirm(lucid, txId);
    fixedClose.run.transactions.push(actionRecord(pulse, txId, livenessAddress, closeState));
    closeState = await retry(`pulse ${pulseNumber} state`, () =>
      vaultState.readConfirmedVault(lucid, fixedClose.manifest));
    if (closeState.sequence !== pulseNumber) throw new Error(`Pulse ${pulseNumber} sequence did not advance.`);
    fixedClose.run.lastCheckInAt = iso(closeState.lastCheckInAtMs);
    fixedClose.run.releaseAt = iso(closeState.releaseAtMs);
    await saveEvidence();
  }
  select("owner");
  const close = await vaultState.buildClose(lucid, fixedClose.manifest, closeState);
  assertReviewBudget(close, "owner close");
  const closeTx = await vaultState.signAndSubmitAction(close);
  await confirm(lucid, closeTx);
  fixedClose.run.transactions.push(actionRecord(close, closeTx, ownerAddress, closeState));
  const closed = await retry("completed owner-close state", () =>
    vaultState.readVaultLifecycle(lucid, fixedClose.manifest));
  if (closed.kind !== "completed" || closed.state.utxo.address !== ownerAddress) {
    throw new Error("Owner close did not return the protected bundle and completion receipt to the owner.");
  }
  await saveEvidence();

  const releaseBoundary = Math.max(fixedRelease.state.releaseAtMs, bearerRelease.state.releaseAtMs);
  if (Date.now() < releaseBoundary) {
    console.log(`waiting for on-chain release boundary ${iso(releaseBoundary)}...`);
    await new Promise((resolve) => setTimeout(resolve, releaseBoundary - Date.now() + 3_000));
  }

  select("executor");
  const fixed = await vaultState.buildRelease(lucid, fixedRelease.manifest, fixedRelease.state);
  assertReviewBudget(fixed, "fixed release");
  const fixedTx = await vaultState.signAndSubmitAction(fixed);
  await confirm(lucid, fixedTx);
  fixedRelease.run.transactions.push(
    actionRecord(fixed, fixedTx, walletFile.wallets.executor.address, fixedRelease.state),
  );
  const fixedPayout = await retry("fixed beneficiary payout", () => lucid.utxoByUnit(fixedRelease.manifest.terminalReceiptUnit));
  if (fixedPayout.address !== beneficiaryAddress || fixedPayout.assets.lovelace !== 15_000_000n) {
    throw new Error("Fixed release did not pay the exact protected bundle to the beneficiary.");
  }
  await saveEvidence();

  select("non_holder");
  let rejected = false;
  try {
    await vaultState.buildRelease(lucid, bearerRelease.manifest, bearerRelease.state);
  } catch (cause) {
    rejected = /does not hold the recovery token/.test(cause instanceof Error ? cause.message : String(cause));
  }
  if (!rejected) throw new Error("Bearer release was not rejected for the non-holder.");
  bearerRelease.run.transactions.push({
    action: "rejected-release",
    txId: null,
    submitterAddress: walletFile.wallets.non_holder.address,
    confirmedAt: null,
    networkFeeLovelace: null,
    siteFeeLovelace: "0",
    transactionBytes: 0,
    sequence: bearerRelease.state.sequence,
    stateLastCheckInAt: iso(bearerRelease.state.lastCheckInAtMs),
    stateReleaseAt: iso(bearerRelease.state.releaseAtMs),
    result: "pass",
    notes: "Off-chain transaction construction rejected a wallet that did not hold the one-shot recovery token.",
  });
  await saveEvidence();

  select("recovery_holder");
  const bearer = await vaultState.buildRelease(lucid, bearerRelease.manifest, bearerRelease.state);
  assertReviewBudget(bearer, "bearer release");
  const bearerTx = await vaultState.signAndSubmitAction(bearer);
  await confirm(lucid, bearerTx);
  bearerRelease.run.transactions.push(
    actionRecord(bearer, bearerTx, walletFile.wallets.recovery_holder.address, bearerRelease.state),
  );
  const bearerPayout = await retry("bearer-holder payout", () => lucid.utxoByUnit(bearerRelease.manifest.terminalReceiptUnit));
  if (
    bearerPayout.address !== walletFile.wallets.recovery_holder.address ||
    bearerPayout.assets.lovelace !== 15_000_000n ||
    bearerPayout.assets[bearerRelease.manifest.recoveryUnit!] !== 1n
  ) {
    throw new Error("Bearer release did not pay the exact bundle and recovery token to its holder.");
  }

  evidence.completedAt = new Date().toISOString();
  evidence.result = "pass";
  await saveEvidence();
  console.log(`PASS: all three Baton lifecycles completed automatically on public Preprod.`);
  console.log(`Evidence: ${evidencePath}`);
}

try {
  await main();
} catch (cause) {
  evidence.completedAt = new Date().toISOString();
  evidence.result = "fail";
  evidence.error = cause instanceof Error ? cause.message : String(cause);
  await saveEvidence();
  throw cause;
}
