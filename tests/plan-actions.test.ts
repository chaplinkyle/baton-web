import assert from "node:assert/strict";
import test from "node:test";
import { availablePlanActions } from "../lib/plan-actions";

test("a disconnected plan never presents a transaction action", () => {
  assert.deepEqual(
    availablePlanActions("active", "fixed", ["owner", "check-in"], false),
    [],
  );
});

test("before handoff, each wallet sees only the action its key authorizes", () => {
  assert.deepEqual(availablePlanActions("active", "fixed", ["owner"], true), ["close"]);
  assert.deepEqual(availablePlanActions("missed", "fixed", ["check-in"], true), ["pulse"]);
  assert.deepEqual(availablePlanActions("due", "fixed", ["recipient"], true), []);
  assert.deepEqual(availablePlanActions("active", "fixed", [], true), []);
});

test("a fixed handoff can be executed by any connected wallet after expiry", () => {
  assert.deepEqual(availablePlanActions("claimable", "fixed", [], true), ["release"]);
});

test("a recovery-token handoff is presented only to its token holder", () => {
  assert.deepEqual(availablePlanActions("claimable", "bearer", [], true), []);
  assert.deepEqual(
    availablePlanActions("claimable", "bearer", ["recovery holder"], true),
    ["release"],
  );
});
