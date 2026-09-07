import { CARDANO_NETWORK } from "@/lib/config";
import { normalizeKoiosJson } from "@/lib/koios-normalize";

const ALLOWED_ENDPOINTS = new Set([
  "account_info",
  "address_info",
  "asset_addresses",
  "credential_txs",
  "datum_info",
  "epoch_params",
  "ogmios",
  "submittx",
  "totals",
  "tx_by_metalabel",
  "tx_info",
  "tx_status",
]);

const DEFAULT_UPSTREAM =
  CARDANO_NETWORK === "Mainnet"
    ? "https://api.koios.rest/api/v1"
    : CARDANO_NETWORK === "Preview"
      ? "https://preview.koios.rest/api/v1"
      : "https://preprod.koios.rest/api/v1";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

async function proxyKoios(request: Request, context: RouteContext) {
  const { path } = await context.params;
  const endpoint = path.join("/");

  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return Response.json({ error: "Unsupported Koios endpoint." }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const upstreamBase = process.env.KOIOS_UPSTREAM_URL?.trim() || DEFAULT_UPSTREAM;
  const upstreamUrl = new URL(`${upstreamBase.replace(/\/$/, "")}/${endpoint}`);
  upstreamUrl.search = requestUrl.search;

  const headers = new Headers({ Accept: "application/json" });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  const range = request.headers.get("range");
  if (range) headers.set("Range", range);
  const token = process.env.KOIOS_API_TOKEN?.trim();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
      cache: "no-store",
    });

    const responseHeaders = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    });
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) responseHeaders.set("Content-Range", contentRange);

    if (endpoint === "tx_info") {
      const text = await upstream.text();
      try {
        return new Response(JSON.stringify(normalizeKoiosJson(JSON.parse(text))), {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: responseHeaders,
        });
      } catch {
        return new Response(text, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: responseHeaders,
        });
      }
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { error: "The Cardano network provider could not be reached." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = proxyKoios;
export const POST = proxyKoios;
