import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { Miniflare } from "miniflare";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import worker from "../src/index";
import { readFileSync } from "node:fs";
let mf: Miniflare, client: Client;
const config = JSON.parse(readFileSync("deployment.json", "utf8"));
beforeAll(async () => {
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: "archive-test",
          compatibilityDate: config.metadata.compatibility_date,
          compatibilityFlags: config.metadata.compatibility_flags,
          manifest: {
            mainModule: "worker.js",
            modules: {
              "worker.js": {
                type: "esm",
                contents: readFileSync("dist/worker.js", "utf8"),
              },
            },
          },
        },
      },
    ],
  });
  const base = await mf.ready;
  client = new Client({ name: "integration-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", base)),
  );
});
afterAll(async () => {
  await client?.close();
  await mf?.dispose();
});
describe("actual Worker + official MCP client", () => {
  it("initializes and discovers all tools with correct write annotations", async () => {
    const r = await client.listTools();
    expect(r.tools).toHaveLength(17);
    expect(
      r.tools.find((t) => t.name === "wayback_save_page")?.annotations
        ?.readOnlyHint,
    ).toBe(false);
    expect(r.tools.every((t) => t.inputSchema.type === "object")).toBe(true);
  });
  it("calls tools on separate stateless requests", async () => {
    const r = await client.callTool({
      name: "wayback_capabilities",
      arguments: {},
    });
    expect(r.isError).not.toBe(true);
    const link = await client.callTool({
      name: "wayback_links",
      arguments: { url: "https://example.com/", timestamp: "2020" },
    });
    expect(JSON.stringify(link)).toContain(
      "https://web.archive.org/web/2020/https://example.com/",
    );
  });
  it("rejects invalid input and unsafe URLs", async () => {
    const invalid = await client.callTool({
      name: "wayback_search_captures",
      arguments: { url: "https://example.com", limit: 99999 },
    });
    expect(invalid.isError).toBe(true);
    const unsafe = await client.callTool({
      name: "wayback_links",
      arguments: { url: "http://127.0.0.1/" },
    });
    expect(unsafe.isError).toBe(true);
  });
  it("serves guide and prompt", async () => {
    expect((await client.listResources()).resources).toHaveLength(1);
    expect(
      (await client.readResource({ uri: "wayback://guide" })).contents,
    ).toHaveLength(1);
    expect(
      (
        await client.getPrompt({
          name: "research_url_history",
          arguments: { url: "https://example.com" },
        })
      ).messages,
    ).toHaveLength(1);
  });
  it("does not serve an old SSE endpoint accidentally", async () => {
    expect((await mf.dispatchFetch("https://worker.test/sse")).status).toBe(
      404,
    );
  });
});
describe("HTTP boundary", () => {
  const req = (body: string, headers: Record<string, string> = {}) =>
    new Request("https://worker.example/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body,
    });
  it("rejects untrusted browser origins", async () =>
    expect(
      (await worker.fetch(req("{}", { Origin: "https://evil.example" }), {}))
        .status,
    ).toBe(403));
  it("rejects oversized and malformed requests", async () => {
    expect((await worker.fetch(req("!"), {})).status).toBe(400);
    expect((await worker.fetch(req("a".repeat(65537)), {})).status).toBe(400);
  });
  it("fails closed for configured secrets without MCP protection", async () =>
    expect(
      (
        await worker.fetch(req("{}"), {
          IA_ACCESS_KEY: "key",
          IA_SECRET_KEY: "secret",
        })
      ).status,
    ).toBe(503));
  it("requires correct bearer token", async () => {
    expect(
      (await worker.fetch(req("{}"), { MCP_TOKEN: "secret" })).status,
    ).toBe(401);
  });
  it("enforces read rate limits", async () => {
    expect(
      (
        await worker.fetch(req("{}"), {
          RATE_LIMITER: { limit: async () => ({ success: false }) },
        })
      ).status,
    ).toBe(429);
  });
  it("enforces save submission limits before upstream access", async () => {
    const limiter = vi.fn(async () => ({ success: false }));
    const r = await worker.fetch(
      req(
        JSON.stringify({
          method: "tools/call",
          params: { name: "wayback_save_page" },
        }),
      ),
      { SAVE_LIMITER: { limit: limiter } },
    );
    expect(r.status).toBe(429);
    expect(limiter).toHaveBeenCalledOnce();
  });
});
