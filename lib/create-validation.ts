import { getAddressDetails } from "@lucid-evolution/lucid";
import { CARDANO_NETWORK, EXPECTED_NETWORK_ID } from "./config";

export type CreateField =
  | "wallet"
  | "ada"
  | "period"
  | "misses"
  | "liveness"
  | "destination";

export type CreateValidationIssue = {
  step: 1 | 2;
  field: CreateField;
  message: string;
};

type ProtectValues = {
  connected: boolean;
  ownerPaymentKeyHashes?: readonly string[];
  ada: string;
  periodDays: number;
  misses: number;
  livenessAddress: string;
};

type RecipientValues = {
  releaseMode: "fixed" | "bearer";
  destination: string;
};

function addressIssue(
  address: string,
  field: "liveness" | "destination",
  label: string,
  requireKey: boolean,
): CreateValidationIssue | null {
  let details: ReturnType<typeof getAddressDetails>;
  try {
    details = getAddressDetails(address);
  } catch {
    return {
      step: field === "liveness" ? 1 : 2,
      field,
      message: `${label} is not a valid Cardano address.`,
    };
  }
  if (details.networkId !== EXPECTED_NETWORK_ID) {
    return {
      step: field === "liveness" ? 1 : 2,
      field,
      message: `${label} must be a ${CARDANO_NETWORK} address.`,
    };
  }
  if (requireKey && details.paymentCredential?.type !== "Key") {
    return {
      step: 1,
      field,
      message: `${label} must belong to a wallet, not a smart contract.`,
    };
  }
  return null;
}

export function validateProtectStep(values: ProtectValues): CreateValidationIssue | null {
  if (!values.connected || !values.ownerPaymentKeyHashes?.length) {
    return {
      step: 1,
      field: "wallet",
      message: "Connect your Preprod Eternl wallet to continue.",
    };
  }

  const ada = Number(values.ada);
  if (!values.ada.trim() || !Number.isFinite(ada) || ada < 5) {
    return { step: 1, field: "ada", message: "Enter at least 5 ADA to protect." };
  }
  const lovelace = ada * 1_000_000;
  if (!Number.isSafeInteger(lovelace)) {
    return {
      step: 1,
      field: "ada",
      message: "Use an ADA amount with no more than six decimal places.",
    };
  }
  if (
    !Number.isInteger(values.periodDays) ||
    values.periodDays < 1 ||
    values.periodDays > 3_650
  ) {
    return {
      step: 1,
      field: "period",
      message: "Choose a whole number from 1 through 3,650 days.",
    };
  }
  if (
    !Number.isInteger(values.misses) ||
    values.misses < 1 ||
    values.misses > 1_000
  ) {
    return {
      step: 1,
      field: "misses",
      message: "Choose a whole number from 1 through 1,000 missed check-ins.",
    };
  }
  if (!values.livenessAddress) {
    return {
      step: 1,
      field: "liveness",
      message: "Enter the Preprod wallet address you will use to check in.",
    };
  }
  const issue = addressIssue(
    values.livenessAddress,
    "liveness",
    "Check-in wallet",
    true,
  );
  if (issue) return issue;

  const credential = getAddressDetails(values.livenessAddress).paymentCredential;
  if (
    credential?.type === "Key" &&
    values.ownerPaymentKeyHashes.includes(credential.hash)
  ) {
    return {
      step: 1,
      field: "liveness",
      message: "Choose a check-in address from a different Eternl account. This address belongs to the account creating the plan.",
    };
  }
  return null;
}

export function validateRecipientStep(values: RecipientValues): CreateValidationIssue | null {
  if (values.releaseMode === "bearer") return null;
  if (!values.destination) {
    return {
      step: 2,
      field: "destination",
      message: "Enter the Preprod address that will receive the protected assets.",
    };
  }
  return addressIssue(values.destination, "destination", "Receiving address", false);
}
