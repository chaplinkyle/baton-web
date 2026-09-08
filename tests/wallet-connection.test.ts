import assert from "node:assert/strict";
import test from "node:test";
import { CML } from "@lucid-evolution/lucid";
import type { EternlConnection } from "../lib/eternl";

process.env.NEXT_PUBLIC_KOIOS_URL = "https://fake.koios.test/api/v1";
const { connectEternl, isExactWalletNetwork } = await import("../lib/eternl");

const OWNER_ADDRESS =
  "addr_test1qztr0p45temrsjcy6z4dpfardnruyftylxj077c6rrket3sjrc6lv8zv5re7krwmg06djl866jl3ygd9zea2cv0aydtq6fqvee";
const SECOND_ADDRESS =
  "addr_test1vptypkdle25xnm2ntne4vsg8jwpe064wkuj9kafqnqx4zysclztwf";

function toHex(address: string) {
  const decoded = CML.Address.from_bech32(address);
  try {
    return decoded.to_hex();
  } finally {
    decoded.free();
  }
}

function fakeWalletApi(networkMagic = 1) {
  return {
    getNetworkId: async () => 0,
    getExtensions: async () => [{ cip: 142 }],
    cip142: { getNetworkMagic: async () => networkMagic },
    getChangeAddress: async () => toHex(OWNER_ADDRESS),
    getUsedAddresses: async () => [toHex(OWNER_ADDRESS)],
    getUnusedAddresses: async () => [toHex(SECOND_ADDRESS)],
  };
}

const FAKE_PROTOCOL_PARAMETERS = {
  pvt_motion_no_confidence: 0.51,
  pvt_committee_normal: 0.51,
  pvt_committee_no_confidence: 0.51,
  pvt_hard_fork_initiation: 0.51,
  pvtpp_security_group: 0.51,
  dvt_motion_no_confidence: 0.67,
  dvt_committee_normal: 0.67,
  dvt_committee_no_confidence: 0.6,
  dvt_update_to_constitution: 0.75,
  dvt_hard_fork_initiation: 0.6,
  dvt_p_p_network_group: 0.67,
  dvt_p_p_economic_group: 0.67,
  dvt_p_p_technical_group: 0.67,
  dvt_p_p_gov_group: 0.75,
  dvt_treasury_withdrawal: 0.67,
  committee_min_size: 3,
  committee_max_term_length: 146,
  gov_action_lifetime: 6,
  gov_action_deposit: "1000000000",
  drep_deposit: "500000000",
  drep_activity: 20,
  min_fee_ref_script_cost_per_byte: 15,
  epoch_no: 1,
  min_fee_a: 44,
  min_fee_b: 155381,
  max_block_size: 90112,
  max_tx_size: 16384,
  max_bh_size: 1100,
  key_deposit: "2000000",
  pool_deposit: "500000000",
  max_epoch: 18,
  optimal_pool_count: 500,
  influence: 0.3,
  monetary_expand_rate: 0.003,
  treasury_growth_rate: 0.2,
  decentralisation: 0,
  extra_entropy: null,
  protocol_major: 11,
  protocol_minor: 0,
  min_utxo_value: "0",
  min_pool_cost: "75000000",
  nonce: "00".repeat(32),
  block_hash: null,
  cost_models: { PlutusV1: [], PlutusV2: [], PlutusV3: [] },
  price_mem: 0.0577,
  price_step: 0.0000721,
  max_tx_ex_mem: 17_500_000,
  max_tx_ex_steps: 10_000_000_000,
  max_block_ex_mem: 77_500_000,
  max_block_ex_steps: 20_000_000_000,
  max_val_size: 5000,
  collateral_percent: 150,
  max_collateral_inputs: 3,
  coins_per_utxo_size: "4310",
};

function installFakeEternl(
  api: ReturnType<typeof fakeWalletApi>,
  onEnable: (options: unknown) => void,
  supportedExtensions: Array<{ cip: number }> = [{ cip: 142 }],
  approval: Promise<ReturnType<typeof fakeWalletApi>> = Promise.resolve(api),
  onProviderRead: () => void = () => undefined,
) {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const provider = {
    name: "Eternl",
    apiVersion: "2.0.0-test",
    supportedExtensions,
    isEnabled: async () => true,
    enable: async (options: unknown) => {
      onEnable(options);
      return approval;
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { cardano: { eternl: provider } },
  });
  globalThis.fetch = async (input) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    if (url === "https://fake.koios.test/api/v1/epoch_params?limit=1") {
      onProviderRead();
      return Response.json([FAKE_PROTOCOL_PARAMETERS]);
    }
    throw new Error(`Unexpected wallet integration request: ${url}`);
  };

  return () => {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  };
}

test("the complete Eternl handshake requests and proves exact Preprod access", async () => {
  let enableOptions: unknown;
  const restoreWindow = installFakeEternl(
    fakeWalletApi(),
    (options) => { enableOptions = options; },
  );

  try {
    const connection = await connectEternl();

    assert.deepEqual(enableOptions, { extensions: [{ cip: 142 }] });
    assert.equal(connection.walletName, "Eternl");
    assert.equal(connection.apiVersion, "2.0.0-test");
    assert.equal(connection.address, OWNER_ADDRESS);
    assert.equal(connection.networkId, 0);
    assert.equal(connection.networkMagic, 1);
    assert.equal(isExactWalletNetwork(connection), true);
    assert.deepEqual(connection.paymentKeyHashes, [
      "5640d9bfcaa869ed535cf3564107938397eaaeb7245b7520980d5112",
      "963786b45e76384b04d0aad0a7a36cc7c22564f9a4ff7b1a18ed95c6",
    ]);
  } finally {
    restoreWindow();
  }
});

test("an empty legacy Eternl account connects without transaction authority", async () => {
  const api = {
    ...fakeWalletApi(),
    getExtensions: undefined,
    cip142: undefined,
    getUtxos: async () => [],
  };
  let enableOptions: unknown = "not called";
  const restoreWindow = installFakeEternl(
    api as ReturnType<typeof fakeWalletApi>,
    (options) => { enableOptions = options; },
    [],
  );

  try {
    const connection = await connectEternl();

    assert.equal(enableOptions, undefined);
    assert.equal(connection.address, OWNER_ADDRESS);
    assert.equal(connection.networkId, 0);
    assert.equal(connection.networkMagic, null);
    assert.equal(isExactWalletNetwork(connection), false);
  } finally {
    restoreWindow();
  }
});

test("the complete Eternl handshake rejects Preview before exposing an account", async () => {
  let changeAddressReads = 0;
  const api = {
    ...fakeWalletApi(2),
    getChangeAddress: async () => {
      changeAddressReads += 1;
      return toHex(OWNER_ADDRESS);
    },
  };
  const restoreWindow = installFakeEternl(api, () => undefined);

  try {
    await assert.rejects(
      connectEternl(),
      /network magic 2.*requires Preprod/i,
    );
    assert.equal(changeAddressReads, 0);
  } finally {
    restoreWindow();
  }
});

test("a successful handshake returns a reusable wallet connection", async () => {
  const api = fakeWalletApi();
  const restoreWindow = installFakeEternl(api, () => undefined);

  try {
    const connection: EternlConnection = await connectEternl();
    assert.equal(connection.api, api);
    assert.equal(typeof connection.lucid.wallet().address, "function");
    assert.equal(await connection.lucid.wallet().address(), OWNER_ADDRESS);
  } finally {
    restoreWindow();
  }
});

test("concurrent connection attempts share one Eternl approval and handshake", async () => {
  const api = fakeWalletApi();
  let enableCalls = 0;
  let releaseApproval: ((value: typeof api) => void) | undefined;
  const approval = new Promise<typeof api>((resolve) => {
    releaseApproval = resolve;
  });
  const restoreWindow = installFakeEternl(
    api,
    () => { enableCalls += 1; },
    [{ cip: 142 }],
    approval,
  );

  try {
    let firstApproved = 0;
    let secondApproved = 0;
    const first = connectEternl(() => { firstApproved += 1; });
    const second = connectEternl(() => { secondApproved += 1; });

    assert.equal(enableCalls, 1);
    releaseApproval?.(api);
    const [firstConnection, secondConnection] = await Promise.all([first, second]);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    assert.equal(enableCalls, 1);
    assert.equal(firstApproved, 1);
    assert.equal(secondApproved, 1);
    assert.equal(firstConnection, secondConnection);
  } finally {
    restoreWindow();
  }
});

test("loads public Cardano parameters while Eternl approval is pending", async () => {
  const api = fakeWalletApi();
  let providerReads = 0;
  let releaseApproval: ((value: typeof api) => void) | undefined;
  const approval = new Promise<typeof api>((resolve) => {
    releaseApproval = resolve;
  });
  const restoreWindow = installFakeEternl(
    api,
    () => undefined,
    [{ cip: 142 }],
    approval,
    () => { providerReads += 1; },
  );

  try {
    const connection = connectEternl();
    for (let attempt = 0; attempt < 50 && providerReads === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(providerReads, 1);
    releaseApproval?.(api);
    assert.equal((await connection).networkMagic, 1);
  } finally {
    restoreWindow();
  }
});
