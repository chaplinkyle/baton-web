import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const walletSource = readFileSync(
  new URL("../components/WalletButton.tsx", import.meta.url),
  "utf8",
);
const providerSource = readFileSync(
  new URL("../app/providers.tsx", import.meta.url),
  "utf8",
);
const createSource = readFileSync(
  new URL("../app/create/page.tsx", import.meta.url),
  "utf8",
);
const plansSource = readFileSync(
  new URL("../app/plans/page.tsx", import.meta.url),
  "utf8",
);
const vaultSource = readFileSync(
  new URL("../app/vault/[vaultId]/vault-dashboard.tsx", import.meta.url),
  "utf8",
);

test("the desktop wallet panel shares the content edge when a scrollbar is present", () => {
  const walletPanelRule = css.match(/\.wallet-panel\s*\{([^}]+)\}/)?.[1];
  assert.ok(walletPanelRule, "wallet panel rule should exist");
  assert.match(walletPanelRule, /position:\s*absolute/);
  assert.match(walletPanelRule, /top:\s*calc\(100% \+ 10px\)/);
  assert.match(walletPanelRule, /right:\s*0/);
  assert.match(
    walletPanelRule,
    /max-height:\s*calc\(100dvh - 100% - 26px\)/,
  );
  assert.doesNotMatch(walletPanelRule, /right:[^;]*(?:100vw|100%)/);
  assert.doesNotMatch(
    css.slice(css.indexOf("@media (max-width: 920px)")),
    /\.wallet-panel\s*\{[^}]*max-height/,
  );
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

test("form fields collapse according to available content width", () => {
  const fieldGridRule = css.match(/\.field-grid\s*\{([^}]+)\}/)?.[1];
  assert.ok(fieldGridRule, "field grid rule should exist");
  assert.match(
    fieldGridRule,
    /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*20rem\),\s*1fr\)\)/,
  );
});

test("the compact header adapts to enlarged text without page overflow", () => {
  const compactHeader = css.slice(css.lastIndexOf("@media (max-width: 620px)"));
  assert.match(
    compactHeader,
    /\.site-header nav\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*4rem\),\s*1fr\)\)/,
  );
  assert.match(compactHeader, /\.wallet-slot\s*\{[^}]*max-width:\s*48vw/);
  assert.match(compactHeader, /\.wallet-button\s*\{[^}]*max-width:\s*48vw/);
  assert.match(
    compactHeader,
    /\.site-header nav a\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*nowrap/,
  );
  assert.match(compactHeader, /\.site-header nav\s*\{[^}]*gap:\s*0/);
  assert.match(compactHeader, /\.fee-hero strong\s*\{[^}]*font-size:\s*3rem/);
  assert.match(
    css,
    /\.wallet-button > span:not\(\.status-dot\)\s*\{[^}]*text-overflow:\s*ellipsis/,
  );
  assert.match(
    css,
    /\.recipient-section > \*, \.recipient-grid article[^}]*\{ min-width:\s*0/,
  );
  assert.match(
    compactHeader,
    /\.wallet-backdrop\s*\{[^}]*top:\s*calc\(100% \+ 1px\)[^}]*height:\s*calc\(100dvh - 100% - 1px\)/,
  );
  assert.doesNotMatch(compactHeader, /\.wallet-backdrop\s*\{[^}]*107px/);
});

test("dense grids can shrink or stack under enlarged text", () => {
  assert.match(
    css,
    /\.wizard-nav > button\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/,
  );
  assert.match(
    css,
    /\.wizard-nav\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(
    css,
    /\.network-plate\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*6rem\),\s*1fr\)\)/,
  );
  assert.match(css, /\.field-help\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.legal-shell > \*[^}]*\{ min-width:\s*0/);
});

test("the mobile wallet sheet keeps the brand visible but non-interactive", () => {
  assert.match(
    walletSource,
    /"main, \.site-footer, \.site-header nav"/,
  );
  assert.doesNotMatch(
    walletSource,
    /"main, \.site-footer, \.site-header \.brand, \.site-header nav"/,
  );
  assert.match(walletSource, /brand\?\.setAttribute\("tabindex", "-1"\)/);
  assert.match(walletSource, /brand\?\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(css, /\.brand\[aria-hidden="true"\]\s*\{\s*pointer-events:\s*none/);
});

test("the wallet dialog receives focus on desktop and mobile", () => {
  const panelFocus = walletSource.indexOf(
    "(closeButtonRef.current ?? panelRef.current)?.focus()",
  );
  const mobileOnlyBranch = walletSource.indexOf("if (!mobileSheet)", panelFocus);

  assert.notEqual(panelFocus, -1, "wallet panel should receive opening focus");
  assert.ok(
    mobileOnlyBranch > panelFocus,
    "opening focus should happen before mobile-only background handling",
  );
});

test("authorized wallet restoration stays quiet without trapping the user", () => {
  assert.match(
    walletSource,
    /connectionPending\s*&&\s*wallet\.connectionActivity\s*!==\s*"restoring"/,
  );
  assert.match(
    walletSource,
    /wallet\.connecting\s*&&\s*wallet\.connectionActivity\s*!==\s*"restoring"/,
  );
  assert.match(
    providerSource,
    /mode === "account-change"[\s\S]+?"switching"[\s\S]+?: "restoring"/,
  );
  assert.match(
    walletSource,
    /wallet\.availability === "missing"\) && \(/,
  );
});

test("foreground wallet connection returns focus to its stable page region", () => {
  assert.match(
    walletSource,
    /closest<HTMLElement>\("\[data-wallet-return-focus\]"\)/,
  );
  assert.match(
    providerSource,
    /dispatchEvent\(new Event\(WALLET_FOREGROUND_REQUEST_EVENT\)\)/,
  );
  assert.match(providerSource, /refreshConnection\(connection, true\)/);
  assert.match(walletSource, /target\?\.focus\(\{ preventScroll: true \}\)/);
  for (const [label, source] of [
    ["create", createSource],
    ["plans", plansSource],
    ["vault", vaultSource],
  ]) {
    assert.match(
      source,
      /data-wallet-return-focus[^>]+tabIndex=\{-1\}/,
      `${label} should expose a stable focus return region`,
    );
  }
});
