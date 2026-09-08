import assert from "node:assert/strict";
import test from "node:test";
import { wrappedFocusTarget } from "../lib/focus-trap";

const first = { name: "close" };
const middle = { name: "copy" };
const last = { name: "disconnect" };
const focusable = [first, middle, last];

test("forward tabbing wraps from the final modal control", () => {
  assert.equal(wrappedFocusTarget(focusable, last, false), first);
  assert.equal(wrappedFocusTarget(focusable, middle, false), undefined);
});

test("backward tabbing wraps from the first modal control", () => {
  assert.equal(wrappedFocusTarget(focusable, first, true), last);
  assert.equal(wrappedFocusTarget(focusable, middle, true), undefined);
});

test("focus entering from outside starts at the requested modal edge", () => {
  assert.equal(wrappedFocusTarget(focusable, null, false), first);
  assert.equal(wrappedFocusTarget(focusable, null, true), last);
  assert.equal(wrappedFocusTarget(focusable, { name: "outside" }, false), first);
});

test("a modal without controls keeps focus on its container", () => {
  assert.equal(wrappedFocusTarget([], null, false), null);
  assert.equal(wrappedFocusTarget([], null, true), null);
});
