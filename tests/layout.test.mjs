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

test("navigation and disclosure controls keep mobile-sized hit targets", () => {
  const brandRule = css.match(/\.brand\s*\{([^}]+)\}/)?.[1];
  const navLinkRule = css.match(/\.site-header nav a\s*\{([^}]+)\}/)?.[1];
  const footerLinkRule = css.match(/\.footer-links a\s*\{([^}]+)\}/)?.[1];
  const fieldHelpRule = css.match(/\.field-help summary\s*\{([^}]+)\}/)?.[1];
  const textLinkRule = css.match(/\.text-link\s*\{([^}]+)\}/)?.[1];

  for (const [label, rule] of [
    ["brand", brandRule],
    ["navigation link", navLinkRule],
    ["footer link", footerLinkRule],
    ["field disclosure", fieldHelpRule],
    ["inline safety link", textLinkRule],
  ]) {
    assert.ok(rule, `${label} rule should exist`);
    assert.match(rule, /min-height:\s*44px/, `${label} should be at least 44px tall`);
  }

  assert.match(navLinkRule, /min-width:\s*44px/);
  assert.match(footerLinkRule, /min-width:\s*44px/);
});
