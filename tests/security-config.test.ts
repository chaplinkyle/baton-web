import assert from "node:assert/strict";
import test from "node:test";
import nextConfig, { securityHeaders } from "../next.config";

test("restricts every route while allowing Eternl's embedded dApp browser", async () => {
  assert.equal(nextConfig.poweredByHeader, false);
  assert.equal(typeof nextConfig.headers, "function");
  const rules = await nextConfig.headers!();
  assert.equal(rules[0].source, "/:path*");
  const headers = new Map(securityHeaders.map(({ key, value }) => [key, value]));
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.has("X-Frame-Options"), false);
  assert.equal(headers.get("Cross-Origin-Embedder-Policy"), "require-corp");
  assert.equal(headers.get("Cross-Origin-Opener-Policy"), "same-origin");
  assert.equal(headers.get("Cross-Origin-Resource-Policy"), "cross-origin");
  const policy = headers.get("Content-Security-Policy") ?? "";
  assert.match(
    policy,
    /frame-ancestors 'self' https:\/\/eternl\.io https:\/\/\*\.eternl\.io ionic: capacitor: chrome-extension:/,
  );
  assert.doesNotMatch(policy, /frame-ancestors \*/);
  assert.match(headers.get("Permissions-Policy") ?? "", /camera=\(\)/);
});
