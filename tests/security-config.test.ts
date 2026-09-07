import assert from "node:assert/strict";
import test from "node:test";
import nextConfig, { securityHeaders } from "../next.config";

test("applies restrictive security headers to every route", async () => {
  assert.equal(nextConfig.poweredByHeader, false);
  assert.equal(typeof nextConfig.headers, "function");
  const rules = await nextConfig.headers!();
  assert.equal(rules[0].source, "/:path*");
  const headers = new Map(securityHeaders.map(({ key, value }) => [key, value]));
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.match(headers.get("Content-Security-Policy") ?? "", /frame-ancestors 'none'/);
  assert.match(headers.get("Permissions-Policy") ?? "", /camera=\(\)/);
});
