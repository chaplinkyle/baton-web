import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("the desktop wallet panel shares the content edge when a scrollbar is present", () => {
  const walletPanelRule = css.match(/\.wallet-panel\s*\{([^}]+)\}/)?.[1];
  assert.ok(walletPanelRule, "wallet panel rule should exist");
  assert.match(walletPanelRule, /position:\s*absolute/);
  assert.match(walletPanelRule, /top:\s*calc\(100% \+ 10px\)/);
  assert.match(walletPanelRule, /right:\s*0/);
  assert.doesNotMatch(walletPanelRule, /right:[^;]*(?:100vw|100%)/);
});
