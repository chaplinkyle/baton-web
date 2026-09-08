import assert from "node:assert/strict";
import test from "node:test";
import {
  BATON_DISCOVERY_LABEL,
  TREASURY_ADDRESS,
} from "../lib/config";
import {
  discoverWalletManifests,
  readPlanHistory,
  recoverManifestFromCreationTx,
  recoverManifestFromTransaction,
  rolesForManifest,
  verifyCreationTransaction,
  verifyPlanHistory,
  type KoiosAssetTransaction,
  type KoiosCreationTransaction,
} from "../lib/plan-discovery";
import { encodeVaultDatum } from "../lib/contract";
import type { LucidEvolution } from "@lucid-evolution/lucid";

const policyId = "22ddfeac47add659754b7931f49aaed2e87d93e93f7759625ae6a797";
const receiptName = "4c4153545f5349474e414c";
const ownerKeyHash = "963786b45e76384b04d0aad0a7a36cc7c22564f9a4ff7b1a18ed95c6";
const livenessKeyHash = "5640d9bfcaa869ed535cf3564107938397eaaeb7245b7520980d5112";
const recipientKeyHash = "1c533d09d6383c83f1e6f9e420a31cc6c54eadc37ce55043b0181750";

function creationTransaction(metadata: Record<string, unknown> | null = null): KoiosCreationTransaction {
  return {
    tx_hash: "bc42de36d3c901488fbe18f5e0b1e389d3ad3b93f20067f9b24c61200f86b017",
    inputs: [{
      tx_hash: "e13a2ff3b24a0ad6551603aaa529e91baaafe162be866e5693b1ea759f29e838",
      tx_index: 2,
    }],
    outputs: [{
      value: "25000000",
      payment_addr: { bech32: "addr_test1wq3dml4vg7kavkt4fdunray64mfwslvnaylhwktzttn209cqpu6ke" },
      inline_datum: {
        bytes: "d8799f01581c963786b45e76384b04d0aad0a7a36cc7c22564f9a4ff7b1a18ed95c6581c5640d9bfcaa869ed535cf3564107938397eaaeb7245b7520980d51121a240c8400041b000001a078a20458d8799fd8799fd8799f581c1c533d09d6383c83f1e6f9e420a31cc6c54eadc37ce55043b0181750ffd8799fd8799fd8799f581c351462a77840649b39db510455ecc1c81cf65e87b134d323ceb90baeffffffffd87980ff00d87a80ff",
      },
      asset_list: [{ policy_id: policyId, asset_name: receiptName, quantity: "1" }],
    }],
    assets_minted: [{ policy_id: policyId, asset_name: receiptName, quantity: "1" }],
    metadata,
  };
}

test("recovers and verifies the live Preprod plan from its creation transaction", () => {
  const manifest = recoverManifestFromTransaction(creationTransaction());
  assert.equal(manifest.policyId, policyId);
  assert.equal(manifest.ownerKeyHash, ownerKeyHash);
  assert.equal(manifest.livenessKeyHash, livenessKeyHash);
  assert.equal(manifest.checkInPeriodMs, 604_800_000);
  assert.equal(manifest.missesToRelease, 4);
  assert.equal(manifest.releaseAtMs, 1_791_149_479_000);
  assert.equal(
    manifest.destination,
    "addr_test1qqw9x0gf6cureql3umu7gg9rrnrv2n4dcd7w25zrkqvpw5p4z332w7zqvjdnnk63q327eswgrnm9apa3xnfj8n4epwhqk77frc",
  );
  assert.deepEqual(rolesForManifest(manifest, ownerKeyHash), ["owner"]);
  assert.deepEqual(rolesForManifest(manifest, livenessKeyHash), ["check-in"]);
  assert.deepEqual(rolesForManifest(manifest, recipientKeyHash), ["recipient"]);
  assert.deepEqual(
    rolesForManifest(manifest, [livenessKeyHash, ownerKeyHash]),
    ["owner", "check-in"],
  );
});

test("verifies creation, check-in, and completion through the canonical receipt chain", () => {
  const created = creationTransaction();
  created.outputs[0].tx_hash = created.tx_hash;
  created.outputs[0].tx_index = 0;
  const manifest = recoverManifestFromTransaction(created);
  const pulseHash = "aa".repeat(32);
  const completeHash = "bb".repeat(32);
  const receipt = [{
    policy_id: manifest.policyId,
    asset_name: manifest.receiptUnit.slice(56),
    quantity: "1",
  }, {
    policy_id: "ab".repeat(28),
    asset_name: Buffer.from("FAMILY_TOKEN").toString("hex"),
    quantity: "7",
  }];
  created.outputs[0].asset_list = structuredClone(receipt);
  const pulse: KoiosCreationTransaction = {
    tx_hash: pulseHash,
    inputs: [{
      tx_hash: created.tx_hash,
      tx_index: 0,
      value: "25000000",
      payment_addr: { bech32: manifest.validatorAddress },
      asset_list: structuredClone(receipt),
    }],
    outputs: [{
      tx_hash: pulseHash,
      tx_index: 0,
      value: "25000000",
      payment_addr: { bech32: manifest.validatorAddress },
      inline_datum: {
        bytes: encodeVaultDatum({
          ownerKeyHash: manifest.ownerKeyHash,
          livenessKeyHash: manifest.livenessKeyHash,
          checkInPeriodMs: manifest.checkInPeriodMs,
          missesToRelease: manifest.missesToRelease,
          lastCheckInAtMs: manifest.lastCheckInAtMs + 1_000,
          releaseRule: { kind: "fixed", address: manifest.destination! },
          sequence: 1,
        }),
      },
      asset_list: structuredClone(receipt),
    }],
    assets_minted: [],
    metadata: null,
  };
  const completed: KoiosCreationTransaction = {
    tx_hash: completeHash,
    inputs: [{
      tx_hash: pulseHash,
      tx_index: 0,
      value: "25000000",
      payment_addr: { bech32: manifest.validatorAddress },
      asset_list: structuredClone(receipt),
    }],
    outputs: [{
      tx_hash: completeHash,
      tx_index: 0,
      value: "25000000",
      payment_addr: { bech32: manifest.destination! },
      inline_datum: null,
      asset_list: [{
        policy_id: manifest.policyId,
        asset_name: manifest.terminalReceiptUnit.slice(56),
        quantity: "1",
      }, structuredClone(receipt[1])],
    }],
    assets_minted: [{
      policy_id: manifest.policyId,
      asset_name: manifest.receiptUnit.slice(56),
      quantity: "-1",
    }, {
      policy_id: manifest.policyId,
      asset_name: manifest.terminalReceiptUnit.slice(56),
      quantity: "1",
    }],
    metadata: null,
  };
  // Indexers do not expose a transaction index here. Deliberately put every
  // transition in one block and reverse the rows; verification must follow
  // consumed output references instead of trusting presentation order.
  const rows: KoiosAssetTransaction[] = [
    { tx_hash: completeHash, block_height: 1, block_time: 1_789_000_030 },
    { tx_hash: pulseHash, block_height: 1, block_time: 1_789_000_020 },
    { tx_hash: created.tx_hash, block_height: 1, block_time: 1_789_000_010 },
  ];

  assert.deepEqual(
    verifyPlanHistory(manifest, rows, [completed, created, pulse], {
      kind: "completed",
      txHash: completeHash,
      outputIndex: 0,
    }),
    [
      { kind: "created", txHash: created.tx_hash, confirmedAtMs: 1_789_000_010_000, sequence: 0 },
      { kind: "check-in", txHash: pulseHash, confirmedAtMs: 1_789_000_020_000, sequence: 1 },
      { kind: "completed", txHash: completeHash, confirmedAtMs: 1_789_000_030_000, sequence: 1 },
    ],
  );

  assert.deepEqual(
    verifyPlanHistory(manifest, rows.slice(1), [created, pulse], {
      kind: "active",
      txHash: pulseHash,
      outputIndex: 0,
      sequence: 1,
    }).map((entry) => [entry.kind, entry.sequence]),
    [["created", 0], ["check-in", 1]],
  );

  const brokenPulse = structuredClone(pulse);
  brokenPulse.inputs[0].tx_hash = "cc".repeat(32);
  assert.throws(
    () => verifyPlanHistory(manifest, rows, [created, brokenPulse, completed], {
      kind: "completed",
      txHash: completeHash,
      outputIndex: 0,
    }),
    /does not form one unambiguous canonical receipt chain/,
  );

  const changedAdaPulse = structuredClone(pulse);
  changedAdaPulse.outputs[0].value = "24999999";
  assert.throws(
    () => verifyPlanHistory(manifest, rows.slice(1), [created, changedAdaPulse], {
      kind: "active",
      txHash: pulseHash,
      outputIndex: 0,
      sequence: 1,
    }),
    /changed the protected ADA or native-asset bundle/,
  );

  const changedTokenPulse = structuredClone(pulse);
  changedTokenPulse.outputs[0].asset_list[1].quantity = "6";
  assert.throws(
    () => verifyPlanHistory(manifest, rows.slice(1), [created, changedTokenPulse], {
      kind: "active",
      txHash: pulseHash,
      outputIndex: 0,
      sequence: 1,
    }),
    /changed the protected ADA or native-asset bundle/,
  );

  const droppedValueCompletion = structuredClone(completed);
  droppedValueCompletion.outputs[0].asset_list.pop();
  assert.throws(
    () => verifyPlanHistory(
      manifest,
      rows,
      [created, pulse, droppedValueCompletion],
      { kind: "completed", txHash: completeHash, outputIndex: 0 },
    ),
    /invalid completion transition/,
  );
});

test("wallet discovery searches the history of every account payment credential", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("tx_by_metalabel")) return Response.json([]);
    if (url.endsWith("/credential_txs")) {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        _payment_credentials: [livenessKeyHash, ownerKeyHash],
      });
      return Response.json([{ tx_hash: creationTransaction().tx_hash }]);
    }
    if (url.endsWith("/tx_info")) return Response.json([creationTransaction()]);
    return Response.json({ error: "unexpected test request" }, { status: 500 });
  };
  const lucid = {
    wallet: () => ({ getUtxos: async () => [] }),
  } as unknown as LucidEvolution;

  try {
    const discovered = await discoverWalletManifests(
      lucid,
      [livenessKeyHash, ownerKeyHash],
    );
    assert.deepEqual(discovered[0]?.roles, ["owner", "check-in"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("wallet discovery reuses an existing UTxO request", async () => {
  const originalFetch = globalThis.fetch;
  let additionalWalletReads = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("tx_by_metalabel")) return Response.json([]);
    if (url.endsWith("/credential_txs")) return Response.json([]);
    return Response.json({ error: "unexpected test request" }, { status: 500 });
  };
  const lucid = {
    wallet: () => ({
      getUtxos: async () => {
        additionalWalletReads += 1;
        return [];
      },
    }),
  } as unknown as LucidEvolution;

  try {
    const existingWalletRead = Promise.resolve([]);
    assert.deepEqual(
      await discoverWalletManifests(
        lucid,
        ownerKeyHash,
        { walletUtxos: existingWalletRead },
      ),
      [],
    );
    assert.equal(additionalWalletReads, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("wallet discovery retries a temporary Koios rate limit", async () => {
  const originalFetch = globalThis.fetch;
  let metadataCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("tx_by_metalabel")) {
      metadataCalls += 1;
      return metadataCalls === 1
        ? Response.json({ error: "rate limited" }, { status: 429 })
        : Response.json([]);
    }
    if (url.endsWith("/credential_txs")) return Response.json([]);
    return Response.json({ error: "unexpected test request" }, { status: 500 });
  };
  const lucid = {
    wallet: () => ({ getUtxos: async () => [] }),
  } as unknown as LucidEvolution;

  try {
    assert.deepEqual(
      await discoverWalletManifests(lucid, ownerKeyHash),
      [],
    );
    assert.equal(metadataCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("recovers the live plan from Koios JSON datum when CBOR bytes are omitted", () => {
  const transaction = creationTransaction();
  transaction.outputs[0].inline_datum = {
    bytes: null,
    value: {
      constructor: 0,
      fields: [
        { int: 1 },
        { bytes: ownerKeyHash },
        { bytes: livenessKeyHash },
        { int: 604_800_000 },
        { int: 4 },
        { int: 1_788_730_279_000 },
        {
          constructor: 0,
          fields: [
            {
              constructor: 0,
              fields: [
                { constructor: 0, fields: [{ bytes: recipientKeyHash }] },
                {
                  constructor: 0,
                  fields: [{ constructor: 0, fields: [{ constructor: 0, fields: [{ bytes: "351462a77840649b39db510455ecc1c81cf65e87b134d323ceb90bae" }] }] }],
                },
              ],
            },
            { constructor: 0, fields: [] },
          ],
        },
        { int: 0 },
        { constructor: 1, fields: [] },
      ],
    },
  };
  assert.equal(recoverManifestFromTransaction(transaction).policyId, policyId);
});

test("automatic discovery requires the Baton metadata marker", () => {
  assert.throws(
    () => recoverManifestFromTransaction(creationTransaction(), true),
    /discovery marker/i,
  );
  const marked = creationTransaction({
    [BATON_DISCOVERY_LABEL]: { app: "baton", version: 1 },
  });
  assert.equal(recoverManifestFromTransaction(marked, true).policyId, policyId);
});

test("creation verification distinguishes the exact interface fee from direct use", async () => {
  const originalFetch = globalThis.fetch;
  const transaction = creationTransaction({
    [BATON_DISCOVERY_LABEL]: { app: "baton", version: 1 },
  });
  transaction.tx_timestamp = 1_789_000_010;
  transaction.outputs.push({
    value: "5000000",
    payment_addr: { bech32: TREASURY_ADDRESS },
    inline_datum: null,
    asset_list: [],
  });
  const manifest = recoverManifestFromTransaction(transaction);
  globalThis.fetch = async (input) => {
    assert.match(String(input), /\/tx_info$/);
    return Response.json([transaction]);
  };

  try {
    assert.deepEqual(await verifyCreationTransaction(manifest), {
      txHash: transaction.tx_hash,
      confirmedAtMs: 1_789_000_010_000,
      discoveryMarker: true,
      siteFee: "verified",
      siteFeeLovelace: 5_000_000n,
    });

    transaction.outputs.pop();
    assert.equal(
      (await verifyCreationTransaction(manifest)).siteFee,
      "not-found",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a completion receipt cannot be minted during plan creation", () => {
  const transaction = creationTransaction();
  transaction.assets_minted.push({
    policy_id: policyId,
    asset_name: Buffer.from("LAST_SIGNAL_DONE").toString("hex"),
    quantity: "1",
  });
  assert.throws(
    () => recoverManifestFromTransaction(transaction),
    /not a supported Baton creation transaction/i,
  );
});

test("a public metadata marker cannot make an unrelated transaction look like a plan", () => {
  const forged = creationTransaction({
    [BATON_DISCOVERY_LABEL]: { app: "baton", version: 1 },
  });
  forged.outputs[0].payment_addr = { bech32: "addr_test1wzq6a0unknown" };
  assert.throws(
    () => recoverManifestFromTransaction(forged, true),
    /not a supported Baton creation transaction/i,
  );
});

test("wallet discovery finds a verified legacy plan through credential history", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("tx_by_metalabel")) {
      return Response.json([]);
    }
    if (url.endsWith("/credential_txs")) {
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        _payment_credentials: [ownerKeyHash],
      });
      return Response.json([{ tx_hash: creationTransaction().tx_hash }]);
    }
    if (url.endsWith("/tx_info")) {
      return Response.json([creationTransaction()]);
    }
    return Response.json({ error: "unexpected test request" }, { status: 500 });
  };

  const lucid = {
    wallet: () => ({ getUtxos: async () => [] }),
  } as unknown as LucidEvolution;

  try {
    const discovered = await discoverWalletManifests(lucid, ownerKeyHash);
    assert.equal(discovered.length, 1);
    assert.deepEqual(discovered[0].roles, ["owner"]);
    assert.equal(discovered[0].manifest.receiptName, "LAST_SIGNAL");
    assert.ok(requested.some((url) => url.endsWith("/credential_txs")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("live Preprod credential discovery finds the public legacy plan", {
  timeout: 30_000,
}, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("tx_by_metalabel")) {
      return Response.json([]);
    }
    if (url.startsWith("/api/koios/")) {
      return originalFetch(
        url.replace("/api/koios", "https://preprod.koios.rest/api/v1"),
        init,
      );
    }
    return originalFetch(input, init);
  };

  const lucid = {
    wallet: () => ({ getUtxos: async () => [] }),
  } as unknown as LucidEvolution;

  try {
    const discovered = await discoverWalletManifests(lucid, ownerKeyHash);
    const legacy = discovered.find(
      (plan) => plan.manifest.creationTx === creationTransaction().tx_hash,
    );
    assert.ok(legacy, "Known public legacy plan was not discovered.");
    assert.deepEqual(legacy.roles, ["owner"]);
    assert.equal(legacy.manifest.receiptName, "LAST_SIGNAL");

    const completedManifest = await recoverManifestFromCreationTx(
      "5ac5cee8ef48845c86fb63b9f349f8ef18adef4175b544a4561e2d4b796d5b80",
    );
    const history = await readPlanHistory(completedManifest, {
      kind: "completed",
      txHash: "7aba10c461f6886568a577fff89fba6e3e9b9b235bdb7856709439d968c7b69b",
      outputIndex: 0,
    });
    assert.equal(history.length, 7);
    assert.deepEqual(
      history.map((entry) => [entry.kind, entry.sequence]),
      [
        ["created", 0],
        ["check-in", 1],
        ["check-in", 2],
        ["check-in", 3],
        ["check-in", 4],
        ["check-in", 5],
        ["completed", 5],
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
