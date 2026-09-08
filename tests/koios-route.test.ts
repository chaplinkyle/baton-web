import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/koios/[...path]/route";

test("proxies paginated asset history without broadening the endpoint allowlist", async () => {
  const originalFetch = globalThis.fetch;
  const originalUpstream = process.env.KOIOS_UPSTREAM_URL;
  let capturedUrl = "";
  let capturedRange = "";

  process.env.KOIOS_UPSTREAM_URL = "https://koios.test/api/v1";
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedRange = new Headers(init?.headers).get("range") ?? "";
    return new Response("[]", {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Range": "0-0/1",
      },
    });
  };

  try {
    const response = await GET(
      new Request(
        "https://baton.test/api/koios/asset_txs?_asset_policy=aa&_asset_name=bb&_history=true",
        { headers: { Range: "0-999" } },
      ),
      { params: Promise.resolve({ path: ["asset_txs"] }) },
    );

    assert.equal(response.status, 200);
    assert.equal(
      capturedUrl,
      "https://koios.test/api/v1/asset_txs?_asset_policy=aa&_asset_name=bb&_history=true",
    );
    assert.equal(capturedRange, "0-999");
    assert.equal(response.headers.get("content-range"), "0-0/1");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), []);

    const rejected = await GET(
      new Request("https://baton.test/api/koios/unsupported"),
      { params: Promise.resolve({ path: ["unsupported"] }) },
    );
    assert.equal(rejected.status, 404);
    assert.deepEqual(await rejected.json(), { error: "Unsupported Koios endpoint." });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUpstream === undefined) delete process.env.KOIOS_UPSTREAM_URL;
    else process.env.KOIOS_UPSTREAM_URL = originalUpstream;
  }
});

test("caches only public epoch parameters for faster wallet startup", async () => {
  const originalFetch = globalThis.fetch;
  const originalUpstream = process.env.KOIOS_UPSTREAM_URL;

  process.env.KOIOS_UPSTREAM_URL = "https://koios.test/api/v1";
  globalThis.fetch = async () => Response.json([{ epoch_no: 123 }]);

  try {
    const response = await GET(
      new Request("https://baton.test/api/koios/epoch_params?limit=1"),
      { params: Promise.resolve({ path: ["epoch_params"] }) },
    );

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("cache-control"),
      "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    );
    assert.deepEqual(await response.json(), [{ epoch_no: 123 }]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUpstream === undefined) delete process.env.KOIOS_UPSTREAM_URL;
    else process.env.KOIOS_UPSTREAM_URL = originalUpstream;
  }
});
