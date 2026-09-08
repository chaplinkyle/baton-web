import assert from "node:assert/strict";
import test from "node:test";
import { CML, type TxSignBuilder } from "@lucid-evolution/lucid";
import {
  signAndSubmitVerified,
  verifyWalletWitnessSet,
} from "../lib/wallet-signing";

const TEST_ADDRESS =
  "addr_test1qztr0p45temrsjcy6z4dpfardnruyftylxj077c6rrket3sjrc6lv8zv5re7krwmg06djl866jl3ygd9zea2cv0aydtq6fqvee";

function sampleTransaction(inputIndex = 0n) {
  const inputs = CML.TransactionInputList.new();
  inputs.add(CML.TransactionInput.new(
    CML.TransactionHash.from_hex("01".repeat(32)),
    inputIndex,
  ));
  const outputs = CML.TransactionOutputList.new();
  outputs.add(CML.TransactionOutput.new(
    CML.Address.from_bech32(TEST_ADDRESS),
    CML.Value.from_coin(2_000_000n),
  ));
  const body = CML.TransactionBody.new(inputs, outputs, 170_000n);
  return CML.Transaction.new(body, CML.TransactionWitnessSet.new(), true);
}

function transactionHash(transaction: CML.Transaction) {
  const body = transaction.body();
  const hash = CML.hash_transaction(body);
  try {
    return hash.to_hex();
  } finally {
    hash.free();
    body.free();
  }
}

function reviewedTransaction(
  unsigned: CML.Transaction,
  signed: CML.Transaction,
  witnessCbor: string,
  onSign: () => void,
) {
  const draft = {
    partialSign: {
      withWallet: async () => {
        onSign();
        return witnessCbor;
      },
    },
    assemble: (witnesses: string[]) => {
      assert.deepEqual(witnesses, [witnessCbor]);
      return draft;
    },
    complete: async () => ({
      toTransaction: () => signed,
      toHash: () => transactionHash(signed),
      toCBOR: ({ canonical }: { canonical: boolean }) => canonical
        ? signed.to_canonical_cbor_hex()
        : signed.to_cbor_hex(),
      submit: async () => transactionHash(signed),
    }),
    toTransaction: () => unsigned,
    toHash: () => transactionHash(unsigned),
  } as unknown as TxSignBuilder;
  return { draft, transactionHash: transactionHash(unsigned) };
}

function witnessSetFor(
  transaction: CML.Transaction,
  publicKeyOwner: CML.PrivateKey,
  signatureOwner = publicKeyOwner,
) {
  const body = transaction.body();
  const hash = CML.hash_transaction(body);
  const publicKey = publicKeyOwner.to_public();
  const signature = signatureOwner.sign(hash.to_raw_bytes());
  const witness = CML.Vkeywitness.new(publicKey, signature);
  const witnesses = CML.VkeywitnessList.new();
  witnesses.add(witness);
  const set = CML.TransactionWitnessSet.new();
  set.set_vkeywitnesses(witnesses);
  return set.to_cbor_hex();
}

function duplicateWitnessSetFor(
  transaction: CML.Transaction,
  signer: CML.PrivateKey,
) {
  const body = transaction.body();
  const hash = CML.hash_transaction(body);
  const publicKey = signer.to_public();
  const signature = signer.sign(hash.to_raw_bytes());
  const witnesses = CML.VkeywitnessList.new();
  witnesses.add(CML.Vkeywitness.new(publicKey, signature));
  witnesses.add(CML.Vkeywitness.new(publicKey, signature));
  const set = CML.TransactionWitnessSet.new();
  set.set_vkeywitnesses(witnesses);
  return set.to_cbor_hex();
}

test("accepts a valid wallet witness for the reviewed body and required signer", () => {
  const transaction = sampleTransaction();
  const signer = CML.PrivateKey.generate_ed25519();
  const signerHash = signer.to_public().hash().to_hex();
  assert.deepEqual(
    verifyWalletWitnessSet(
      transaction,
      witnessSetFor(transaction, signer),
      signerHash,
    ),
    [signerHash],
  );
});

test("rejects missing, unauthorized, malformed, duplicate, and invalid wallet witnesses", () => {
  const transaction = sampleTransaction();
  const signer = CML.PrivateKey.generate_ed25519();
  const other = CML.PrivateKey.generate_ed25519();
  const empty = CML.TransactionWitnessSet.new().to_cbor_hex();

  assert.throws(
    () => verifyWalletWitnessSet(transaction, empty),
    /could not verify/,
  );
  assert.throws(
    () => verifyWalletWitnessSet(transaction, "not-cbor"),
    /could not verify/,
  );
  assert.throws(
    () => verifyWalletWitnessSet(
      transaction,
      witnessSetFor(transaction, signer),
      other.to_public().hash().to_hex(),
    ),
    /could not verify/,
  );
  assert.throws(
    () => verifyWalletWitnessSet(
      transaction,
      witnessSetFor(transaction, signer, other),
    ),
    /could not verify/,
  );
  assert.throws(
    () => verifyWalletWitnessSet(
      transaction,
      duplicateWitnessSetFor(transaction, signer),
    ),
    /could not verify/,
  );
  assert.throws(
    () => verifyWalletWitnessSet(transaction, "00".repeat(32_769)),
    /could not verify/,
  );
});

test("requests one signature, preserves the reviewed body, and prefers Eternl submission", async () => {
  const transaction = sampleTransaction();
  const signer = CML.PrivateKey.generate_ed25519();
  const witnessCbor = witnessSetFor(transaction, signer);
  const signed = CML.Transaction.new(
    transaction.body(),
    CML.TransactionWitnessSet.from_cbor_hex(witnessCbor),
    true,
  );
  let signRequests = 0;
  let walletSubmissions = 0;
  let providerSubmissions = 0;
  let submittedCbor = "";
  const review = reviewedTransaction(
    transaction,
    signed,
    witnessCbor,
    () => { signRequests += 1; },
  );
  const expectedHash = review.transactionHash;

  assert.equal(await signAndSubmitVerified(
    review,
    signer.to_public().hash().to_hex(),
    {
      api: {
        submitTx: async (signedCbor: string) => {
          walletSubmissions += 1;
          submittedCbor = signedCbor;
          return expectedHash;
        },
      },
      lucid: {
        config: () => ({
          provider: {
            submitTx: async () => {
              providerSubmissions += 1;
              return expectedHash;
            },
          },
        }),
      },
    } as never,
  ), expectedHash);
  assert.equal(signRequests, 1);
  assert.equal(walletSubmissions, 1);
  assert.equal(providerSubmissions, 0);
  assert.equal(submittedCbor, signed.to_cbor_hex());
});

test("uses the signed-provider fallback only when wallet submission is unavailable", async () => {
  const transaction = sampleTransaction();
  const signer = CML.PrivateKey.generate_ed25519();
  const witnessCbor = witnessSetFor(transaction, signer);
  const signed = CML.Transaction.new(
    transaction.body(),
    CML.TransactionWitnessSet.from_cbor_hex(witnessCbor),
    true,
  );
  let providerSubmissions = 0;
  const review = reviewedTransaction(transaction, signed, witnessCbor, () => undefined);
  const expectedHash = review.transactionHash;

  assert.equal(await signAndSubmitVerified(review, undefined, {
    api: {},
    lucid: {
      config: () => ({
        provider: {
          submitTx: async () => {
            providerSubmissions += 1;
            return expectedHash;
          },
        },
      }),
    },
  } as never), expectedHash);
  assert.equal(providerSubmissions, 1);
});

test("stops before submission if the assembled transaction body changes", async () => {
  const transaction = sampleTransaction();
  const altered = sampleTransaction(1n);
  const signer = CML.PrivateKey.generate_ed25519();
  const witnessCbor = witnessSetFor(transaction, signer);
  const signedAltered = CML.Transaction.new(
    altered.body(),
    CML.TransactionWitnessSet.from_cbor_hex(witnessCbor),
    true,
  );
  let submissions = 0;

  await assert.rejects(
    signAndSubmitVerified(
      reviewedTransaction(transaction, signedAltered, witnessCbor, () => undefined),
      undefined,
      {
        api: {
          submitTx: async () => {
            submissions += 1;
            return transactionHash(altered);
          },
        },
        lucid: { config: () => ({}) },
      } as never,
    ),
    /does not match the transaction you reviewed/,
  );
  assert.equal(submissions, 0);
});
