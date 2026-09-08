import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/create/page.tsx", import.meta.url), "utf8");
const dashboardSource = readFileSync(
  new URL("../app/vault/[vaultId]/vault-dashboard.tsx", import.meta.url),
  "utf8",
);

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
  assert.match(source, /wallet\.runWalletRequest\([\s\S]*?signAndSubmitCreation/);
  assert.match(source, /cleared the old unsigned review/);
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

test("every existing-plan action keeps preparation separate from approval", () => {
  assert.match(dashboardSource, />Review check-in<span>Prepare an unsigned check-in/);
  assert.match(dashboardSource, />Review cancellation<span>Prepare an unsigned return/);
  assert.match(dashboardSource, />Review the handoff<span>Prepare an unsigned/);
  assert.match(dashboardSource, /This is an unsigned transaction/);
  assert.match(dashboardSource, /Eternl opens only when you choose to approve and submit it/);
  assert.match(dashboardSource, /"Approve and submit in Eternl"/);
  assert.doesNotMatch(dashboardSource, /"Approve in Eternl"/);
  assert.match(dashboardSource, /wallet\.runWalletRequest\([\s\S]*?signAndSubmitAction/);
  assert.match(dashboardSource, /cleared the old unsigned action review/);
});

test("existing-plan reviews expose exact wallet, transaction, and receiving addresses", () => {
  assert.match(
    dashboardSource,
    /<dt>Connected Eternl account<\/dt><dd className="mono">\{reviewConnection\.address\}<\/dd>/,
  );
  assert.match(
    dashboardSource,
    /<dt>Transaction ID<\/dt><dd className="mono">\{activeReview\.transactionHash\}<\/dd>/,
  );
  assert.match(
    dashboardSource,
    /<dt>Receiving address<\/dt><dd className="mono">\{activeReview\.receivingAddress\}<\/dd>/,
  );
  assert.doesNotMatch(dashboardSource, /shortHash\(reviewConnection\.address/);
  assert.doesNotMatch(dashboardSource, /shortHash\(activeReview\.transactionHash/);
  assert.doesNotMatch(dashboardSource, /shortHash\(manifest\.destination/);
});
