import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import currentBlueprint from "../lib/plutus.json";
import legacyBlueprint from "../lib/plutus.rc9.json";
import { protocolArtifactFor } from "../lib/protocol-artifacts";
import {
  BATON_RECEIPT_NAMES,
  LEGACY_RC9_RECEIPT_NAMES,
  receiptDisplayName,
} from "../lib/protocol-names";

function sha256(relativePath: string) {
  return createHash("sha256")
    .update(readFileSync(new URL(relativePath, import.meta.url)))
    .digest("hex");
}

function spendingValidator(blueprint: {
  validators: Array<{ title: string; hash?: string; compiledCode: string }>;
}) {
  const validator = blueprint.validators.find(
    (candidate) => candidate.title.endsWith(".spend"),
  );
  assert.ok(validator);
  return validator;
}

test("public protocol links and summaries match the exact vendored artifacts", () => {
  const current = protocolArtifactFor("BATON");
  const currentValidator = spendingValidator(currentBlueprint);
  assert.equal(current.compiler, currentBlueprint.preamble.compiler.version);
  assert.equal(current.validatorHash, currentValidator.hash);
  assert.equal(current.compiledBytes, currentValidator.compiledCode.length / 2);
  assert.equal(current.blueprintSha256, sha256("../lib/plutus.json"));
  assert.match(current.sourceUrl ?? "", /blob\/v0\.1\.0-rc\.10\/validators\/baton\.ak$/);
  assert.match(current.blueprintUrl, /blob\/v0\.1\.0-rc\.10\/plutus\.json$/);
  assert.match(current.releaseManifestUrl, /blob\/v0\.1\.0-rc\.10\/release\/release-manifest\.json$/);

  const legacy = protocolArtifactFor("LAST_SIGNAL");
  const legacyValidator = spendingValidator(legacyBlueprint);
  assert.equal(legacy.compiler, legacyBlueprint.preamble.compiler.version);
  assert.equal(legacy.validatorHash, legacyValidator.hash);
  assert.equal(legacy.compiledBytes, legacyValidator.compiledCode.length / 2);
  assert.equal(legacy.blueprintSha256, sha256("../lib/plutus.rc9.json"));
  assert.equal(legacy.sourceUrl, null);
  assert.match(legacy.blueprintUrl, /legacy\/0\.1\.0-rc\.9\/plutus\.json$/);
});

test("unknown receipt families cannot borrow a published artifact identity", () => {
  assert.throws(
    () => protocolArtifactFor("NOT_BATON"),
    /does not have a pinned artifact/i,
  );
});

test("presents immutable rc.9 receipts as transparent Baton compatibility names", () => {
  assert.equal(receiptDisplayName(BATON_RECEIPT_NAMES.active), "BATON");
  assert.equal(
    receiptDisplayName(LEGACY_RC9_RECEIPT_NAMES.active),
    "BATON receipt · legacy LAST_SIGNAL",
  );
  assert.equal(
    receiptDisplayName(LEGACY_RC9_RECEIPT_NAMES.complete),
    "BATON complete receipt · legacy LAST_SIGNAL_DONE",
  );
});
