import type { NextConfig } from "next";

const frameAncestors = [
  "'self'",
  "https://eternl.io",
  "https://*.eternl.io",
  "ionic:",
  "capacitor:",
  "chrome-extension:",
  ...(process.env.NODE_ENV === "development"
    ? ["http://localhost:*", "https://localhost:*"]
    : []),
].join(" ");

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://preprod.koios.rest https://preview.koios.rest https://api.koios.rest",
  "object-src 'none'",
  "base-uri 'self'",
  `frame-ancestors ${frameAncestors}`,
  "form-action 'self'",
].join("; ");

export const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
];

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  serverExternalPackages: [
    "@anastasia-labs/cardano-multiplatform-lib-nodejs",
    "@lucid-evolution/lucid",
    "@lucid-evolution/utils",
  ],
  turbopack: { root: process.cwd() },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
