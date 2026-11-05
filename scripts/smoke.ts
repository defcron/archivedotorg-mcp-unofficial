import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const endpoint =
  process.env.MCP_URL ??
  "https://archivedotorg-mcp-unofficial.defcronyke.workers.dev/mcp";
const client = new Client({ name: "archive-release-smoke", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
const tools = await client.listTools();
console.log(JSON.stringify({ test: "tools/list", count: tools.tools.length }));
const calls: [string, Record<string, unknown>][] = [
  ["wayback_capabilities", {}],
  ["wayback_available", { url: "https://example.com/", timestamp: "20200101" }],
  [
    "wayback_search_captures",
    { url: "https://example.com/", from: "2020", to: "2020", limit: 2 },
  ],
  [
    "wayback_read_capture",
    { url: "https://example.com/", timestamp: "20200101", maxChars: 1000 },
  ],
  [
    "wayback_compare_captures",
    {
      url: "https://example.com/",
      before: "2010",
      after: "2020",
      maxChars: 1000,
    },
  ],
  ["wayback_timeline", { url: "https://example.com/" }],
  ["wayback_calendar", { url: "https://example.com/", date: "2020" }],
  ["wayback_changes", { url: "https://example.com/", year: 2020, limit: 2 }],
  [
    "wayback_memento_timemap",
    { url: "https://example.com/", from: "2020", to: "2020", limit: 2 },
  ],
  ["wayback_save_service_status", { scope: "system" }],
];
let failed = 0;
for (const [name, args] of calls) {
  const start = Date.now();
  try {
    const r = await client.callTool({ name, arguments: args }, undefined, {
      timeout: 90000,
    });
    if (r.isError) failed++;
    console.log(
      JSON.stringify({
        test: name,
        ok: !r.isError,
        ms: Date.now() - start,
        result: r.structuredContent ?? r.content,
      }),
    );
  } catch (e) {
    failed++;
    console.log(JSON.stringify({ test: name, ok: false, error: String(e) }));
  }
}
if (process.env.TEST_SAVE_URL) {
  const r = await client.callTool(
    {
      name: "wayback_save_page",
      arguments: {
        url: process.env.TEST_SAVE_URL,
        if_not_archived_within: "1d",
      },
    },
    undefined,
    { timeout: 90000 },
  );
  console.log(
    JSON.stringify({
      test: "wayback_save_page",
      ok: !r.isError,
      result: r.structuredContent ?? r.content,
    }),
  );
}
await client.close();
if (failed) process.exitCode = 1;
