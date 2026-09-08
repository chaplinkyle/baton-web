import type { Network } from "@lucid-evolution/lucid";
import { BATON_RECEIPT_NAMES } from "./protocol-names";

type PublicNetwork = Exclude<Network, "Custom">;

const requestedNetwork = process.env.NEXT_PUBLIC_CARDANO_NETWORK ?? "Preprod";

if (
  requestedNetwork === "Mainnet" &&
  process.env.NEXT_PUBLIC_MAINNET_RELEASE_ACK !== "BATON_MAINNET_V1"
) {
  throw new Error(
    "Mainnet builds are locked. Set the explicit version-one mainnet release acknowledgement only after every release gate passes.",
  );
}

export const CARDANO_NETWORK: PublicNetwork =
  requestedNetwork === "Mainnet" || requestedNetwork === "Preview"
    ? requestedNetwork
    : "Preprod";

export const EXPECTED_NETWORK_ID = CARDANO_NETWORK === "Mainnet" ? 1 : 0;

// CIP-30's network ID distinguishes mainnet from testnets, but Preprod and
// Preview both use ID 0. CIP-142-capable wallets expose the network magic that
// identifies the exact chain; older wallets must prove it from a confirmed
// UTxO before Baton treats their connection as usable.
export const EXPECTED_NETWORK_MAGIC =
  CARDANO_NETWORK === "Mainnet"
    ? 764_824_073
    : CARDANO_NETWORK === "Preview"
      ? 2
      : 1;

export const KOIOS_URL =
  process.env.NEXT_PUBLIC_KOIOS_URL ?? "/api/koios";

export const PINNED_PREPROD_TREASURY_ADDRESS =
  "addr_test1qztr0p45temrsjcy6z4dpfardnruyftylxj077c6rrket3sjrc6lv8zv5re7krwmg06djl866jl3ygd9zea2cv0aydtq6fqvee";

const requestedTreasury =
  process.env.NEXT_PUBLIC_TREASURY_ADDRESS?.trim() ?? "";
const emulatorTreasuryOverride =
  process.env.NEXT_PUBLIC_TREASURY_OVERRIDE_ACK === "EMULATOR_ONLY";

export const TREASURY_ADDRESS =
  CARDANO_NETWORK === "Preprod" && !emulatorTreasuryOverride
    ? PINNED_PREPROD_TREASURY_ADDRESS
    : requestedTreasury;

export const EXPLORER_URL =
  CARDANO_NETWORK === "Mainnet"
    ? "https://cardanoscan.io"
    : CARDANO_NETWORK === "Preview"
      ? "https://preview.cardanoscan.io"
      : "https://preprod.cardanoscan.io";

export const RECEIPT_NAME = BATON_RECEIPT_NAMES.active;
export const TERMINAL_RECEIPT_NAME = BATON_RECEIPT_NAMES.complete;
export const RECOVERY_RECEIPT_NAME = BATON_RECEIPT_NAMES.recovery;

// CIP-10 reserves 65536-131071 for private-use transaction metadata labels.
// This marker makes site-created plans discoverable without a Baton database;
// every candidate is still reconstructed and verified against Cardano.
export const BATON_DISCOVERY_LABEL = 74470;

export const runtimeReadiness = {
  canCreate: TREASURY_ADDRESS.length > 0,
  missing: TREASURY_ADDRESS.length > 0 ? [] : ["operator treasury address"],
};
