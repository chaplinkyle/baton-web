import assert from "node:assert/strict";
import test from "node:test";
import { Lucid } from "@lucid-evolution/lucid";
import {
  Emulator,
  generateEmulatorAccountFromPrivateKey,
} from "@lucid-evolution/provider";
import type { VaultManifest } from "../lib/manifest";

test("creation, pulse, close, fixed release, and bearer release execute end to end", async () => {
  const protectedNft = `${"66".repeat(28)}01`;
  const protectedToken = `${"66".repeat(28)}02`;
  const owner = generateEmulatorAccountFromPrivateKey({
    lovelace: 1_000_000_000n,
    [protectedNft]: 1n,
    [protectedToken]: 1_000_000n,
  });
  const liveness = generateEmulatorAccountFromPrivateKey({ lovelace: 300_000_000n });
  const fixedOwner = generateEmulatorAccountFromPrivateKey({ lovelace: 1_000_000_000n });
  const fixedLiveness = generateEmulatorAccountFromPrivateKey({ lovelace: 300_000_000n });
  const bearerOwner = generateEmulatorAccountFromPrivateKey({ lovelace: 1_000_000_000n });
  const bearerLiveness = generateEmulatorAccountFromPrivateKey({ lovelace: 300_000_000n });
  const recoveryHolder = generateEmulatorAccountFromPrivateKey({ lovelace: 300_000_000n });
  const executor = generateEmulatorAccountFromPrivateKey({ lovelace: 300_000_000n });
  const treasury = generateEmulatorAccountFromPrivateKey({ lovelace: 0n });
  const beneficiary = generateEmulatorAccountFromPrivateKey({ lovelace: 0n });
  const emulator = new Emulator([
    owner,
    liveness,
    fixedOwner,
    fixedLiveness,
    bearerOwner,
    bearerLiveness,
    recoveryHolder,
    executor,
    treasury,
    beneficiary,
  ]);

  process.env.NEXT_PUBLIC_CARDANO_NETWORK = "Preprod";
  process.env.NEXT_PUBLIC_TREASURY_ADDRESS = treasury.address;
  process.env.NEXT_PUBLIC_TREASURY_OVERRIDE_ACK = "EMULATOR_ONLY";

  const [{ buildCreation, buildDirectCreation, signAndSubmitCreation }, vaultState, vaultContract] = await Promise.all([
    import("../lib/transactions"),
    import("../lib/vault-state"),
    import("../lib/contract"),
  ]);
  const lucid = await Lucid(emulator, "Custom");
  const assertTransactionBudget = (
    review: { transactionBytes: number; feeLovelace: bigint },
    label: string,
  ) => {
    assert.ok(review.transactionBytes < 16_384, `${label} exceeds the 16 KiB transaction ceiling`);
    assert.ok(review.feeLovelace < 5_000_000n, `${label} network fee exceeds the local 5 ADA safety ceiling`);
  };
  const assertActionReviewIntegrity = (
    review: Awaited<ReturnType<typeof vaultState.buildPulse>>,
    label: string,
  ) => {
    const ttl = review.draft.toTransaction().body().ttl();
    assert.notEqual(ttl, undefined, `${label} must have a finite upper validity bound`);
    assert.equal(
      review.validTo,
      lucid.slotToUnixTime(Number(ttl)),
      `${label} review expiry must match the transaction body`,
    );
    assert.equal(review.siteFeeLovelace, 0n, `${label} must not add a Baton action fee`);
    assert.match(
      review.requiredSignerKeyHash ?? "",
      /^[0-9a-f]{56}$/,
      `${label} must bind its wallet approval to one key credential`,
    );
  };
  const assertCreationReviewIntegrity = (
    review: Awaited<ReturnType<typeof buildCreation>>,
    label: string,
  ) => {
    const ttl = review.draft.toTransaction().body().ttl();
    assert.notEqual(ttl, undefined, `${label} must have a finite upper validity bound`);
    assert.equal(
      review.validTo,
      lucid.slotToUnixTime(Number(ttl)),
      `${label} review expiry must match the transaction body`,
    );
    assert.equal(review.validTo, review.lastCheckInAt);
    assert.ok(review.minimumAdaLovelace > 0n, `${label} minimum ADA must be positive`);
    assert.ok(
      review.minimumAdaLovelace <= (review.protectedAssets.lovelace ?? 0n),
      `${label} must protect enough ADA for its canonical output`,
    );
  };

  function manifestFrom(
    creationTx: string,
    review: Awaited<ReturnType<typeof buildCreation>>,
    release: Pick<VaultManifest, "releaseMode" | "destination" | "recoveryUnit">,
    periodMs: number,
    missesToRelease: number,
  ): VaultManifest {
    return {
      version: 3,
      network: "Preprod",
      creationTx,
      seed: { txHash: review.seed.txHash, outputIndex: review.seed.outputIndex },
      receiptName: "BATON",
      terminalReceiptName: "BATON_COMPLETE",
      recoveryReceiptName: "BATON_RECOVERY",
      policyId: review.contract.policyId,
      receiptUnit: review.contract.receiptUnit,
      terminalReceiptUnit: review.contract.terminalReceiptUnit,
      validatorAddress: review.contract.address,
      ownerKeyHash: review.ownerKeyHash,
      livenessKeyHash: review.livenessKeyHash,
      checkInPeriodMs: periodMs,
      missesToRelease,
      lastCheckInAtMs: review.lastCheckInAt,
      releaseAtMs: review.releaseAt,
      ...release,
    };
  }

  lucid.selectWallet.fromPrivateKey(owner.privateKey);
  const validRequest = {
    protectedAssets: { lovelace: 20_000_000n },
    livenessAddress: liveness.address,
    checkInPeriodMs: 1_000,
    missesToRelease: 1,
    releaseRule: { kind: "fixed" as const, address: beneficiary.address },
  };
  await assert.rejects(
    buildCreation(lucid, { ...validRequest, checkInPeriodMs: 0 }, emulator.now()),
    /positive whole number/,
  );
  await assert.rejects(
    buildCreation(lucid, { ...validRequest, missesToRelease: 0 }, emulator.now()),
    /from 1 through 1,000/,
  );
  await assert.rejects(
    buildCreation(lucid, { ...validRequest, missesToRelease: 1_001 }, emulator.now()),
    /from 1 through 1,000/,
  );
  await assert.rejects(
    buildCreation(lucid, {
      ...validRequest,
      payloadCommitment: "not-a-sha256-hash",
    }, emulator.now()),
    /one SHA-256 hash/,
  );
  await assert.rejects(
    buildCreation(lucid, {
      ...validRequest,
      protectedAssets: { ["ab"]: 1n },
    }, emulator.now()),
    /positive lovelace/,
  );
  await assert.rejects(
    buildCreation(lucid, {
      ...validRequest,
      protectedAssets: { lovelace: 20_000_000n, malformed: 1n },
    }, emulator.now()),
    /native-asset unit is malformed/,
  );

  const directReview = await buildDirectCreation(lucid, validRequest, emulator.now());
  assertCreationReviewIntegrity(directReview, "direct no-fee creation");
  assert.equal(directReview.siteFeeLovelace, 0n);
  assert.equal(directReview.checkInPeriodMs, validRequest.checkInPeriodMs);
  assert.equal(directReview.missesToRelease, validRequest.missesToRelease);
  assert.deepEqual(directReview.releaseRule, validRequest.releaseRule);
  assertTransactionBudget(directReview, "direct no-fee creation");
  const directCreationTx = await signAndSubmitCreation(directReview);
  emulator.awaitBlock(1);
  const directManifest = manifestFrom(
    directCreationTx,
    directReview,
    { releaseMode: "fixed", destination: beneficiary.address },
    validRequest.checkInPeriodMs,
    validRequest.missesToRelease,
  );
  const directState = await vaultState.readConfirmedVault(lucid, directManifest);
  const directClose = await vaultState.buildClose(
    lucid,
    directManifest,
    directState,
    emulator.now(),
  );
  await vaultState.signAndSubmitAction(directClose);
  emulator.awaitBlock(1);
  assert.equal(
    (await emulator.getUtxos(treasury.address))
      .reduce((sum, utxo) => sum + (utxo.assets.lovelace ?? 0n), 0n),
    0n,
  );

  // Live path: create, pulse with the separate liveness key, then owner close.
  lucid.selectWallet.fromPrivateKey(owner.privateKey);
  const periodMs = 7 * 24 * 60 * 60 * 1000;
  const liveReview = await buildCreation(lucid, {
    protectedAssets: {
      lovelace: 50_000_000n,
      [protectedNft]: 1n,
      [protectedToken]: 1_000_000n,
    },
    livenessAddress: liveness.address,
    checkInPeriodMs: periodMs,
    missesToRelease: 4,
    releaseRule: { kind: "fixed", address: beneficiary.address },
  }, emulator.now());
  assertCreationReviewIntegrity(liveReview, "fixed creation with native assets");
  assert.equal(liveReview.siteFeeLovelace, 5_000_000n);
  assert.equal(liveReview.checkInPeriodMs, periodMs);
  assert.equal(liveReview.missesToRelease, 4);
  assert.deepEqual(liveReview.releaseRule, {
    kind: "fixed",
    address: beneficiary.address,
  });
  assertTransactionBudget(liveReview, "creation");
  const liveCreationTx = await signAndSubmitCreation(liveReview);
  emulator.awaitBlock(1);
  const liveManifest = manifestFrom(
    liveCreationTx,
    liveReview,
    { releaseMode: "fixed", destination: beneficiary.address },
    periodMs,
    4,
  );
  const createdState = await vaultState.readConfirmedVault(lucid, liveManifest);
  assert.equal(createdState.sequence, 0);
  assert.equal(createdState.utxo.assets.lovelace, 50_000_000n);
  assert.equal(createdState.utxo.assets[protectedNft], 1n);
  assert.equal(createdState.utxo.assets[protectedToken], 1_000_000n);

  // Eternl accounts can control more than one HD payment address. Baton must
  // prepare an action when the required key belongs to the verified account,
  // even if the wallet's current change address uses another account key.
  const alternateAddressPulse = await vaultState.buildPulse(
    lucid,
    liveManifest,
    createdState,
    emulator.now(),
    [liveManifest.ownerKeyHash, liveManifest.livenessKeyHash],
  );
  assertTransactionBudget(alternateAddressPulse, "alternate account-address pulse");
  assertActionReviewIntegrity(alternateAddressPulse, "alternate account-address pulse");
  await assert.rejects(
    vaultState.signAndSubmitAction(alternateAddressPulse),
    "the ledger must still reject a wallet that cannot produce the liveness signature",
  );

  // Prepare the first real check-in after two elapsed periods so the review
  // must report the actual missed count and the confirmed transaction must
  // reset it without changing the protected bundle.
  emulator.awaitSlot(
    Math.ceil(
      (createdState.lastCheckInAtMs + periodMs * 2 - emulator.now()) / 1_000,
    ) + 1,
  );
  lucid.selectWallet.fromPrivateKey(liveness.privateKey);
  let pulsedState = createdState;
  for (let expectedSequence = 1; expectedSequence <= 5; expectedSequence += 1) {
    const previous = pulsedState;
    const pulseReview = await vaultState.buildPulse(
      lucid,
      liveManifest,
      previous,
      emulator.now(),
    );
    const pulseTx = await vaultState.signAndSubmitAction(pulseReview);
    assertTransactionBudget(pulseReview, `pulse ${expectedSequence}`);
    assertActionReviewIntegrity(pulseReview, `pulse ${expectedSequence}`);
    assert.equal(pulseReview.protectedValueEffect, "preserved");
    assert.equal(pulseReview.receivingAddress, undefined);
    assert.equal(pulseReview.currentMissedCount, expectedSequence === 1 ? 2 : 0);
    assert.equal(pulseReview.validTo, pulseReview.newCheckInAt);
    assert.equal(
      pulseReview.newReleaseAt,
      pulseReview.newCheckInAt! + liveManifest.checkInPeriodMs * liveManifest.missesToRelease,
    );
    emulator.awaitBlock(1);
    pulsedState = await vaultState.readConfirmedVault(lucid, liveManifest);
    assert.equal(pulsedState.sequence, expectedSequence);
    assert.deepEqual(pulsedState.utxo.assets, createdState.utxo.assets);
    assert.ok(pulsedState.releaseAtMs > previous.releaseAtMs);
    assert.equal(await emulator.awaitTx(pulseTx), true);
  }

  lucid.selectWallet.fromPrivateKey(owner.privateKey);
  const closeReview = await vaultState.buildClose(
    lucid,
    liveManifest,
    pulsedState,
    emulator.now(),
  );
  assertTransactionBudget(closeReview, "owner close");
  assertActionReviewIntegrity(closeReview, "owner close");
  assert.equal(closeReview.protectedValueEffect, "released");
  assert.equal(closeReview.receivingAddress, owner.address);
  await vaultState.signAndSubmitAction(closeReview);
  emulator.awaitBlock(1);
  assert.equal(await emulator.getUtxoByUnit(liveManifest.receiptUnit), undefined);
  const closedReceipt = await emulator.getUtxoByUnit(liveManifest.terminalReceiptUnit);
  assert.equal(closedReceipt.address, owner.address);
  assert.equal(closedReceipt.assets.lovelace, 50_000_000n);
  assert.equal(closedReceipt.assets[protectedNft], 1n);
  assert.equal(closedReceipt.assets[protectedToken], 1_000_000n);

  // Even if the completion receipt is deliberately sent back to the script
  // with a plausible datum, it can never recreate the burned active identity.
  const forgedDatum = vaultContract.encodeVaultDatum({
    ownerKeyHash: liveManifest.ownerKeyHash,
    livenessKeyHash: liveManifest.livenessKeyHash,
    checkInPeriodMs: liveManifest.checkInPeriodMs,
    missesToRelease: liveManifest.missesToRelease,
    lastCheckInAtMs: pulsedState.lastCheckInAtMs,
    releaseRule: { kind: "fixed", address: beneficiary.address },
    sequence: pulsedState.sequence,
  });
  const replayDraft = await lucid
    .newTx()
    .collectFrom([closedReceipt])
    .pay.ToContract(
      liveManifest.validatorAddress,
      { kind: "inline", value: forgedDatum },
      closedReceipt.assets,
    )
    .complete();
  await replayDraft.sign.withWallet().complete().then((signed) => signed.submit());
  emulator.awaitBlock(1);
  assert.equal(await emulator.getUtxoByUnit(liveManifest.receiptUnit), undefined);
  await assert.rejects(vaultState.readConfirmedVault(lucid, liveManifest));
  const completedLifecycle = await vaultState.readVaultLifecycle(lucid, liveManifest);
  assert.equal(completedLifecycle.kind, "completed");
  assert.equal(completedLifecycle.state.utxo.address, liveManifest.validatorAddress);

  // Fixed release path: anyone pays the fee; the contract pins the beneficiary.
  lucid.selectWallet.fromPrivateKey(fixedOwner.privateKey);
  const fixedReview = await buildCreation(lucid, {
    protectedAssets: { lovelace: 60_000_000n },
    livenessAddress: fixedLiveness.address,
    checkInPeriodMs: 1_000,
    missesToRelease: 1,
    releaseRule: { kind: "fixed", address: beneficiary.address },
  }, emulator.now());
  assertCreationReviewIntegrity(fixedReview, "fixed release creation");
  const fixedCreationTx = await signAndSubmitCreation(fixedReview);
  emulator.awaitBlock(1);
  const fixedManifest = manifestFrom(
    fixedCreationTx,
    fixedReview,
    { releaseMode: "fixed", destination: beneficiary.address },
    1_000,
    1,
  );
  const fixedState = await vaultState.readConfirmedVault(lucid, fixedManifest);
  emulator.awaitSlot(901);
  lucid.selectWallet.fromPrivateKey(executor.privateKey);
  const fixedRelease = await vaultState.buildRelease(
    lucid,
    fixedManifest,
    fixedState,
    emulator.now(),
  );
  assertTransactionBudget(fixedRelease, "fixed release");
  assertActionReviewIntegrity(fixedRelease, "fixed release");
  assert.equal(fixedRelease.protectedValueEffect, "released");
  assert.equal(fixedRelease.receivingAddress, beneficiary.address);
  await vaultState.signAndSubmitAction(fixedRelease);
  emulator.awaitBlock(1);
  assert.equal(await emulator.getUtxoByUnit(fixedManifest.receiptUnit), undefined);
  const fixedPayout = await emulator.getUtxoByUnit(fixedManifest.terminalReceiptUnit);
  assert.equal(fixedPayout.address, beneficiary.address);
  assert.equal(fixedPayout.assets.lovelace, 60_000_000n);

  // No-beneficiary path: creation mints the unique recovery token to the owner,
  // who can transfer it to the future recipient without changing the vault.
  lucid.selectWallet.fromPrivateKey(bearerOwner.privateKey);
  const bearerReview = await buildCreation(lucid, {
    protectedAssets: { lovelace: 70_000_000n },
    livenessAddress: bearerLiveness.address,
    checkInPeriodMs: 1_000,
    missesToRelease: 1,
    releaseRule: { kind: "bearer" },
  }, emulator.now());
  assertCreationReviewIntegrity(bearerReview, "bearer creation");
  const recoveryUnit = bearerReview.contract.recoveryReceiptUnit;
  assert.deepEqual(bearerReview.releaseRule, {
    kind: "bearer",
    policyId: bearerReview.contract.policyId,
    assetName: recoveryUnit.slice(56),
  });
  const bearerCreationTx = await signAndSubmitCreation(bearerReview);
  emulator.awaitBlock(1);
  const mintedRecovery = await emulator.getUtxoByUnit(recoveryUnit);
  assert.equal(mintedRecovery.address, bearerOwner.address);
  assert.equal(mintedRecovery.assets[recoveryUnit], 1n);
  assert.equal(mintedRecovery.assets[bearerReview.contract.receiptUnit] ?? 0n, 0n);
  const bearerManifest = manifestFrom(
    bearerCreationTx,
    bearerReview,
    { releaseMode: "bearer", recoveryUnit },
    1_000,
    1,
  );
  const bearerState = await vaultState.readConfirmedVault(lucid, bearerManifest);
  assert.equal(bearerState.utxo.assets[recoveryUnit] ?? 0n, 0n);
  const transferDraft = await lucid
    .newTx()
    .pay.ToAddress(recoveryHolder.address, { [recoveryUnit]: 1n })
    .complete();
  await transferDraft.sign.withWallet().complete().then((signed) => signed.submit());
  emulator.awaitBlock(1);
  assert.equal((await emulator.getUtxoByUnit(recoveryUnit)).address, recoveryHolder.address);
  emulator.awaitSlot(901);
  lucid.selectWallet.fromPrivateKey(executor.privateKey);
  await assert.rejects(
    vaultState.buildRelease(lucid, bearerManifest, bearerState, emulator.now()),
    /does not hold the recovery token/,
  );
  lucid.selectWallet.fromPrivateKey(recoveryHolder.privateKey);
  const bearerRelease = await vaultState.buildRelease(
    lucid,
    bearerManifest,
    bearerState,
    emulator.now(),
  );
  assertTransactionBudget(bearerRelease, "bearer release");
  assertActionReviewIntegrity(bearerRelease, "bearer release");
  assert.equal(bearerRelease.protectedValueEffect, "released");
  assert.equal(bearerRelease.receivingAddress, recoveryHolder.address);
  await vaultState.signAndSubmitAction(bearerRelease);
  emulator.awaitBlock(1);
  assert.equal(await emulator.getUtxoByUnit(bearerManifest.receiptUnit), undefined);
  const bearerPayout = await emulator.getUtxoByUnit(bearerManifest.terminalReceiptUnit);
  assert.equal(bearerPayout.address, recoveryHolder.address);
  assert.equal(bearerPayout.assets.lovelace, 70_000_000n);
  assert.equal(bearerPayout.assets[recoveryUnit], 1n);

  // Generated schedule agreement: random period/miss combinations must reject
  // off-chain release before the derived boundary and execute at that boundary.
  let randomState = 0x51a7c0de;
  const nextRandom = () => {
    randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
    return randomState;
  };
  const generatedCases = 12;
  for (let index = 0; index < generatedCases; index += 1) {
    const generatedPeriod = 1_000 + nextRandom() % 10_000;
    const generatedMisses = 1 + nextRandom() % 12;
    lucid.selectWallet.fromPrivateKey(fixedOwner.privateKey);
    const generatedReview = await buildCreation(lucid, {
      protectedAssets: { lovelace: 20_000_000n },
      livenessAddress: fixedLiveness.address,
      checkInPeriodMs: generatedPeriod,
      missesToRelease: generatedMisses,
      releaseRule: { kind: "fixed", address: beneficiary.address },
    }, emulator.now());
    assertCreationReviewIntegrity(generatedReview, `generated creation ${index}`);
    assertTransactionBudget(generatedReview, `generated creation ${index}`);
    const creationTx = await signAndSubmitCreation(generatedReview);
    emulator.awaitBlock(1);
    const manifest = manifestFrom(
      creationTx,
      generatedReview,
      { releaseMode: "fixed", destination: beneficiary.address },
      generatedPeriod,
      generatedMisses,
    );
    const state = await vaultState.readConfirmedVault(lucid, manifest);
    assert.equal(
      state.releaseAtMs,
      state.lastCheckInAtMs + generatedPeriod * generatedMisses,
    );
    lucid.selectWallet.fromPrivateKey(executor.privateKey);
    await assert.rejects(
      vaultState.buildRelease(lucid, manifest, state, state.releaseAtMs - 1),
      /not valid before the final missed boundary/,
    );
    const slotsToBoundary = Math.max(
      1,
      Math.ceil((state.releaseAtMs - emulator.now()) / 1_000) + 1,
    );
    emulator.awaitSlot(slotsToBoundary);
    const release = await vaultState.buildRelease(
      lucid,
      manifest,
      state,
      emulator.now(),
    );
    assertTransactionBudget(release, `generated release ${index}`);
    await vaultState.signAndSubmitAction(release);
    emulator.awaitBlock(1);
    assert.equal(await emulator.getUtxoByUnit(manifest.receiptUnit), undefined);
    const payout = await emulator.getUtxoByUnit(manifest.terminalReceiptUnit);
    assert.equal(payout.address, beneficiary.address);
    assert.equal(payout.assets.lovelace, 20_000_000n);
  }

  const treasuryUtxos = await emulator.getUtxos(treasury.address);
  assert.equal(
    treasuryUtxos.reduce((sum, utxo) => sum + (utxo.assets.lovelace ?? 0n), 0n),
    BigInt(3 + generatedCases) * 5_000_000n,
    "every successful creation must pay 5 ADA and no later action may add a site fee",
  );
});
