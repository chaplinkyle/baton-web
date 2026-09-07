import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Koios,
  Lucid,
  generatePrivateKey,
  getAddressDetails,
  type PrivateKey,
} from "@lucid-evolution/lucid";

export const PREPROD_KOIOS = "https://preprod.koios.rest/api/v1";
export const AUTOMATION_ROLES = [
  "owner",
  "liveness",
  "beneficiary",
  "executor",
  "recovery_holder",
  "non_holder",
] as const;

export type AutomationRole = (typeof AUTOMATION_ROLES)[number];
export type AutomationWallet = {
  address: string;
  privateKey: PrivateKey;
};
export type AutomationWalletFile = {
  version: 1;
  network: "Preprod";
  warning: string;
  createdAt: string;
  wallets: Record<AutomationRole, AutomationWallet>;
};

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const siteDirectory = path.resolve(scriptsDirectory, "..");
const walletDirectory = path.join(siteDirectory, ".preprod-wallets");
export const walletFilePath = path.join(walletDirectory, "wallets.json");

function assertPreprodAddress(address: string, label: string) {
  const details = getAddressDetails(address);
  if (!address.startsWith("addr_test1") || details.networkId !== 0) {
    throw new Error(`${label} is not a Preprod/testnet address.`);
  }
}

export async function loadAutomationWallets(): Promise<AutomationWalletFile> {
  const parsed = JSON.parse(await readFile(walletFilePath, "utf8")) as AutomationWalletFile;
  if (parsed.version !== 1 || parsed.network !== "Preprod") {
    throw new Error("Automated wallet file is not explicitly locked to Preprod.");
  }
  for (const role of AUTOMATION_ROLES) {
    const wallet = parsed.wallets?.[role];
    if (!wallet?.privateKey || !wallet.address) throw new Error(`Missing automated ${role} wallet.`);
    assertPreprodAddress(wallet.address, role);
  }
  return parsed;
}

async function initialize() {
  if (
    process.env.NEXT_PUBLIC_CARDANO_NETWORK === "Mainnet" ||
    process.env.CARDANO_NETWORK === "Mainnet"
  ) {
    throw new Error("Refusing to generate automated wallets while Mainnet is selected.");
  }
  try {
    const existing = await loadAutomationWallets();
    console.log("Using the existing isolated Preprod-only software wallets:");
    for (const role of AUTOMATION_ROLES) console.log(`${role}: ${existing.wallets[role].address}`);
    return;
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw cause;
  }

  const lucid = await Lucid(new Koios(PREPROD_KOIOS), "Preprod");
  const wallets = {} as Record<AutomationRole, AutomationWallet>;
  for (const role of AUTOMATION_ROLES) {
    const privateKey = generatePrivateKey();
    lucid.selectWallet.fromPrivateKey(privateKey);
    const address = await lucid.wallet().address();
    assertPreprodAddress(address, role);
    wallets[role] = { address, privateKey };
  }
  const walletFile: AutomationWalletFile = {
    version: 1,
    network: "Preprod",
    warning: "TEST-ONLY KEYS. Test ADA has no monetary value. Never fund these addresses on Mainnet.",
    createdAt: new Date().toISOString(),
    wallets,
  };
  await mkdir(walletDirectory, { recursive: true, mode: 0o700 });
  await writeFile(walletFilePath, `${JSON.stringify(walletFile, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await chmod(walletFilePath, 0o600).catch(() => undefined);
  console.log("Created isolated Preprod-only software wallets (private keys were not printed):");
  for (const role of AUTOMATION_ROLES) console.log(`${role}: ${wallets[role].address}`);
}

async function status() {
  const walletFile = await loadAutomationWallets();
  for (const role of AUTOMATION_ROLES) {
    const wallet = walletFile.wallets[role];
    const response = await fetch(`${PREPROD_KOIOS}/address_info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _addresses: [wallet.address] }),
    });
    if (!response.ok) throw new Error(`Koios could not read the ${role} balance.`);
    const [information] = await response.json() as Array<{ balance?: string }>;
    const lovelace = BigInt(information?.balance ?? "0");
    console.log(`${role}: ${wallet.address} | ${(Number(lovelace) / 1_000_000).toFixed(6)} test ADA`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] ?? "status";
  if (command === "init") await initialize();
  else if (command === "status") await status();
  else throw new Error("Usage: npm run preprod:wallet:init or npm run preprod:wallet:status");
}
