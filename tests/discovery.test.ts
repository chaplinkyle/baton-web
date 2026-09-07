import assert from "node:assert/strict";
import test from "node:test";
import { BATON_DISCOVERY_LABEL } from "../lib/config";
import {
  discoverWalletManifests,
  recoverManifestFromTransaction,
  rolesForManifest,
  type KoiosCreationTransaction,
} from "../lib/plan-discovery";
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
