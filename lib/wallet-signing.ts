import {
  CML,
  type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { EternlConnection } from "./eternl";

type ReviewedTransaction = {
  draft: TxSignBuilder;
  transactionHash: string;
};

const UNVERIFIED_WITNESS_MESSAGE =
  "Eternl returned a signing response Baton could not verify. Nothing was submitted.";

function canonicalBodyCbor(transaction: CML.Transaction) {
  const body = transaction.body();
  try {
    return body.to_canonical_cbor_hex();
  } finally {
    body.free();
  }
}

function bodyHashHex(transaction: CML.Transaction) {
  const body = transaction.body();
  try {
    const hash = CML.hash_transaction(body);
    try {
      return hash.to_hex().toLowerCase();
    } finally {
      hash.free();
    }
  } finally {
    body.free();
  }
}

/**
 * Verify that a CIP-30 response contains only valid key witnesses for this
 * exact transaction body. An optional required signer binds owner/check-in
 * actions to the immutable credential shown in the review.
 */
export function verifyWalletWitnessSet(
  transaction: CML.Transaction,
  witnessCbor: string,
  requiredSignerKeyHash?: string,
) {
  if (
    typeof witnessCbor !== "string" ||
    witnessCbor.length === 0 ||
    witnessCbor.length > 65_536 ||
    witnessCbor.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(witnessCbor)
  ) {
    throw new Error(UNVERIFIED_WITNESS_MESSAGE);
  }
  if (
    requiredSignerKeyHash !== undefined &&
    !/^[0-9a-f]{56}$/i.test(requiredSignerKeyHash)
  ) {
    throw new Error("Baton was given an invalid required signer credential.");
  }

  let witnessSet: CML.TransactionWitnessSet;
  try {
    witnessSet = CML.TransactionWitnessSet.from_cbor_hex(witnessCbor);
  } catch {
    throw new Error(UNVERIFIED_WITNESS_MESSAGE);
  }

  try {
    const additionalWitnesses = [
      witnessSet.bootstrap_witnesses(),
      witnessSet.native_scripts(),
      witnessSet.plutus_datums(),
      witnessSet.plutus_v1_scripts(),
      witnessSet.plutus_v2_scripts(),
      witnessSet.plutus_v3_scripts(),
      witnessSet.redeemers(),
    ];
    const hasUnexpectedWitness = additionalWitnesses.some(Boolean);
    additionalWitnesses.forEach((witness) => witness?.free());
    if (hasUnexpectedWitness) throw new Error(UNVERIFIED_WITNESS_MESSAGE);

    const witnesses = witnessSet.vkeywitnesses();
    if (!witnesses || witnesses.len() === 0 || witnesses.len() > 128) {
      witnesses?.free();
      throw new Error(UNVERIFIED_WITNESS_MESSAGE);
    }

    const transactionBody = transaction.body();
    let signedBytes: Uint8Array;
    try {
      const transactionHash = CML.hash_transaction(transactionBody);
      try {
        signedBytes = transactionHash.to_raw_bytes();
      } finally {
        transactionHash.free();
      }
    } finally {
      transactionBody.free();
    }
    const signerHashes = new Set<string>();

    try {
      for (let index = 0; index < witnesses.len(); index += 1) {
        const witness = witnesses.get(index);
        const publicKey = witness.vkey();
        const signature = witness.ed25519_signature();
        const keyHash = publicKey.hash();
        try {
          const signerHash = keyHash.to_hex().toLowerCase();
          if (
            signerHashes.has(signerHash) ||
            !publicKey.verify(signedBytes, signature)
          ) {
            throw new Error(UNVERIFIED_WITNESS_MESSAGE);
          }
          signerHashes.add(signerHash);
        } finally {
          keyHash.free();
          signature.free();
          publicKey.free();
          witness.free();
        }
      }
    } finally {
      witnesses.free();
    }

    if (
      requiredSignerKeyHash !== undefined &&
      !signerHashes.has(requiredSignerKeyHash.toLowerCase())
    ) {
      throw new Error(UNVERIFIED_WITNESS_MESSAGE);
    }

    return [...signerHashes];
  } finally {
    witnessSet.free();
  }
}

/** Request one wallet approval, verify it locally, then submit the exact body. */
export async function signAndSubmitVerified(
  review: ReviewedTransaction,
  requiredSignerKeyHash?: string,
  connection?: Pick<EternlConnection, "api" | "lucid">,
) {
  const unsignedTransaction = review.draft.toTransaction();
  if (bodyHashHex(unsignedTransaction) !== review.transactionHash.toLowerCase()) {
    throw new Error("The prepared transaction no longer matches its review.");
  }

  const witnessCbor = await review.draft.partialSign.withWallet();
  verifyWalletWitnessSet(
    unsignedTransaction,
    witnessCbor,
    requiredSignerKeyHash,
  );

  const signed = await review.draft.assemble([witnessCbor]).complete();
  const signedTransaction = signed.toTransaction();
  if (
    canonicalBodyCbor(signedTransaction) !== canonicalBodyCbor(unsignedTransaction) ||
    bodyHashHex(signedTransaction) !== review.transactionHash.toLowerCase()
  ) {
    throw new Error("The signed transaction does not match the transaction you reviewed.");
  }

  // Submit the exact encoding the wallet signed. Re-canonicalizing after
  // signing can change body bytes and invalidate an otherwise valid witness.
  const signedCbor = signed.toCBOR({ canonical: false });
  const walletSubmit = connection && typeof connection.api.submitTx === "function"
    ? connection.api.submitTx.bind(connection.api)
    : null;
  const provider = connection?.lucid.config().provider;
  const providerSubmit = provider && typeof provider.submitTx === "function"
    ? provider.submitTx.bind(provider)
    : null;
  const submittedHash = walletSubmit
    ? await walletSubmit(signedCbor)
    : providerSubmit
      ? await providerSubmit(signedCbor)
      : await signed.submit();

  if (submittedHash.toLowerCase() !== review.transactionHash.toLowerCase()) {
    throw new Error(
      "The submitted transaction ID does not match the transaction you reviewed.",
    );
  }
  return submittedHash.toLowerCase();
}
