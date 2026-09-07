import assert from "node:assert/strict";
import test from "node:test";
import { normalizeKoiosJson } from "../lib/koios-normalize";

test("normalizes Koios stringified empty collateral asset lists", () => {
  const response = [{
    outputs: [{ asset_list: [] }],
    collateral_output: { value: "1000000", asset_list: "[]" },
  }];
  assert.deepEqual(normalizeKoiosJson(response), [{
    outputs: [{ asset_list: [] }],
    collateral_output: { value: "1000000", asset_list: [] },
  }]);
});

test("normalizes Koios rendered native assets in collateral outputs", () => {
  const policyId = "13".repeat(28);
  const normalized = normalizeKoiosJson({
    collateral_output: {
      asset_list:
        `[(PolicyID {policyID = ScriptHash "${policyId}"},[("4241544f4e5f434f4d504c455445",1)])]`,
    },
  }) as { collateral_output: { asset_list: Array<Record<string, unknown>> } };
  assert.deepEqual(normalized.collateral_output.asset_list, [{
    policy_id: policyId,
    asset_name: "4241544f4e5f434f4d504c455445",
    fingerprint: "",
    decimals: 0,
    quantity: "1",
  }]);
});

test("normalizes empty and JSON-only Koios inline datums", () => {
  const response = {
    empty: { inline_datum: { bytes: null, value: null } },
    populated: {
      inline_datum: {
        bytes: null,
        value: { constructor: 0, fields: [{ int: 1 }] },
      },
    },
  };
  assert.deepEqual(normalizeKoiosJson(response), {
    empty: { inline_datum: null },
    populated: {
      inline_datum: {
        bytes: "d8798101",
        value: { constructor: 0, fields: [{ int: 1 }] },
      },
    },
  });
});

test("does not reinterpret unrelated strings or populated asset arrays", () => {
  const response = {
    note: "[]",
    asset_list: [{ policy_id: "ab", asset_name: "", quantity: "1" }],
  };
  assert.deepEqual(normalizeKoiosJson(response), response);
});
