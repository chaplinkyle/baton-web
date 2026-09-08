import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/create/page.tsx", import.meta.url), "utf8");

test("the final review exposes every wallet-bound authority exactly", () => {
  assert.match(
    source,
    /<span>CHECK-IN WALLET<\/span><code className="review-exact-value">\{livenessAddress\}<\/code>/,
  );
  assert.match(
    source,
    /<span>WHO CAN RECEIVE<\/span>\{releaseMode === "bearer"[\s\S]*?<code className="review-exact-value">\{destination\}<\/code>/,
  );
  assert.match(
    source,
    /<dt>Connected Eternl account<\/dt><dd className="mono">\{reviewConnection\.address\}<\/dd>/,
  );
  assert.match(
    source,
    /<dt>Baton fee recipient<\/dt><dd className="mono">\{TREASURY_ADDRESS\}<\/dd>/,
  );
  assert.doesNotMatch(source, /shortHash\(destination/);
  assert.doesNotMatch(source, /shortHash\(activeReview\.releaseRule\.address/);
});

test("transaction preparation is visibly separate from signing and submission", () => {
  assert.match(source, /prepares an unsigned transaction for you to inspect/);
  assert.match(source, /Eternl opens only if you then choose to approve and submit it/);
  assert.match(
    source,
    /activeReview \? <button[\s\S]*?onClick=\{submitTransaction\}[\s\S]*?"Approve and submit in Eternl"/,
  );
  assert.match(
    source,
    /: <button[\s\S]*?onClick=\{prepareTransaction\}[\s\S]*?"Prepare transaction review"/,
  );
  assert.doesNotMatch(source, /"Prepare for Eternl"/);
  assert.doesNotMatch(source, /"Approve in Eternl"/);
});

test("optional assets and file proof are exact rather than summarized", () => {
  assert.match(
    source,
    /protectedTokenUnits\.map\(\(unit\) => <li key=\{unit\}><code>\{unit\}<\/code><\/li>\)/,
  );
  assert.match(
    source,
    /<span>FILE FINGERPRINT<\/span><code className="review-exact-value">\{commitment\}<\/code>/,
  );
});
