import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const CURRENT_SHA256 = "b0809a00186e40ffca51511dbd81086d642be7149b6d1852fe127fc1822d22fc";
const LEGACY_RC9_SHA256 = "fabc367f2f0c329ad0259d69c8bf46338473f517976bb730d0dbe10d30ab5800";

const currentPath = fileURLToPath(new URL("../lib/plutus.json", import.meta.url));
const legacyPath = fileURLToPath(new URL("../lib/plutus.rc9.json", import.meta.url));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const [current, legacy] = await Promise.all([readFile(currentPath), readFile(legacyPath)]);
if (sha256(current) !== CURRENT_SHA256) {
  throw new Error("The Baton rc.10 blueprint differs from its pinned SHA-256.");
}
if (sha256(legacy) !== LEGACY_RC9_SHA256) {
  throw new Error("The frozen rc.9 compatibility blueprint differs from its pinned SHA-256.");
}

const currentBlueprint = JSON.parse(current.toString("utf8"));
if (!currentBlueprint.validators.some((validator) => validator.title === "baton.baton.spend")) {
  throw new Error("The Baton spending validator is missing from the rc.10 blueprint.");
}

console.log("Verified current and legacy Baton blueprint hashes.");
