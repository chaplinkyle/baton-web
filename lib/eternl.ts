import type { LucidEvolution, WalletApi } from "@lucid-evolution/lucid";
import { Buffer } from "buffer";
import {
  CARDANO_NETWORK,
  EXPECTED_NETWORK_ID,
  KOIOS_URL,
} from "./config";

export type EternlConnection = {
  api: WalletApi;
  lucid: LucidEvolution;
  address: string;
  paymentKeyHash: string;
  networkId: number;
};

export function isEternlAvailable() {
  return typeof window !== "undefined" && Boolean(window.cardano?.eternl);
}

export async function connectEternl(): Promise<EternlConnection> {
  // Some CIP-30 wallet code still expects Node's Buffer global. Vinext does not
  // inject Node polyfills into browser bundles, so make it available before the
  // extension's enable handshake runs.
  const browserGlobals = globalThis as typeof globalThis & {
    Buffer?: typeof Buffer;
  };
  browserGlobals.Buffer ??= Buffer;

  const provider = window.cardano?.eternl;
  if (!provider) {
    throw new Error(
      "Eternl was not detected. Install the Eternl extension or open this site in Eternl's dApp browser.",
    );
  }

  const api = await provider.enable();
  const networkId = await api.getNetworkId();
  if (networkId !== EXPECTED_NETWORK_ID) {
    throw new Error(
      `Eternl is on network ${networkId}; this release requires ${CARDANO_NETWORK}.`,
    );
  }

  const { getAddressDetails, Koios, Lucid } = await import(
    "@lucid-evolution/lucid"
  );
  const lucid = await Lucid(new Koios(KOIOS_URL), CARDANO_NETWORK);
  lucid.selectWallet.fromAPI(api);
  const address = await lucid.wallet().address();
  const paymentCredential = getAddressDetails(address).paymentCredential;
  if (!paymentCredential || paymentCredential.type !== "Key") {
    throw new Error("The selected Eternl account does not use a key payment credential.");
  }

  return {
    api,
    lucid,
    address,
    paymentKeyHash: paymentCredential.hash,
    networkId,
  };
}
