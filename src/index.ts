import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer, VERSION } from "./server";
import { ArchiveHttp, boundedText } from "./upstream";
// Optional secret bindings are deliberately not configured for the public preview.
export interface Env {
  RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  SAVE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  MCP_TOKEN?: string;
  IA_ACCESS_KEY?: string;
  IA_SECRET_KEY?: string;
}
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, MCP-Protocol-Version, MCP-Session-Id",
  "Access-Control-Expose-Headers": "MCP-Session-Id, Retry-After",
  "X-Content-Type-Options": "nosniff",
};
async function authorized(request: Request, secret: string) {
  const digest = async (s: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    );
  const a = await digest(request.headers.get("authorization") ?? ""),
    b = await digest(`Bearer ${secret}`);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });
    if (path === "/health")
      return Response.json(
        { ok: true, version: VERSION, service: "archivedotorg-mcp-unofficial" },
        { headers: cors },
      );
    if (path === "/")
      return new Response(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Internet Archive MCP · Unofficial</title><style>body{font:18px/1.65 system-ui;max-width:760px;margin:70px auto;padding:24px;background:#f6f3eb;color:#222}code{background:#e5e1d7;padding:4px 8px}h1{line-height:1.2}a{color:#125b75}</style><h1>Internet Archive MCP</h1><p>Unofficial Wayback Machine tools for AI assistants · v${VERSION}</p><p>Connect using Streamable HTTP at <code>/mcp</code>.</p><p>Search captures, read archived pages, compare dates, explore timelines and submit public pages to Save Page Now.</p><p>This public preview uses anonymous Internet Archive access. Archive restrictions, rate limits and authentication requirements still apply.</p><p><a href="https://github.com/defcron/archivedotorg-mcp-unofficial">Source, setup guide, tool list and limitations</a></p><p>Not affiliated with or endorsed by the Internet Archive.</p></html>`,
        {
          headers: {
            ...cors,
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy":
              "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
          },
        },
      );
    if (path !== "/mcp")
      return new Response("Not found", { status: 404, headers: cors });
    const origin = request.headers.get("origin");
    if (
      origin &&
      ![
        new URL(request.url).origin,
        "https://chatgpt.com",
        "https://chat.openai.com",
        "https://claude.ai",
      ].includes(origin)
    )
      return new Response("Origin not allowed", { status: 403, headers: cors });
    if (env.MCP_TOKEN && !(await authorized(request, env.MCP_TOKEN)))
      return new Response("Unauthorized", {
        status: 401,
        headers: { ...cors, "WWW-Authenticate": "Bearer" },
      });
    if (
      (env.IA_ACCESS_KEY || env.IA_SECRET_KEY) &&
      (!env.MCP_TOKEN || !env.IA_ACCESS_KEY || !env.IA_SECRET_KEY)
    )
      return new Response("Server authentication configuration is incomplete", {
        status: 503,
        headers: cors,
      });
    if (
      env.RATE_LIMITER &&
      !(
        await env.RATE_LIMITER.limit({
          key: request.headers.get("CF-Connecting-IP") ?? "unknown",
        })
      ).success
    )
      return new Response("Rate limit exceeded", {
        status: 429,
        headers: { ...cors, "Retry-After": "60" },
      });
    let parsedBody: unknown;
    if (request.method === "POST") {
      if (!request.headers.get("content-type")?.includes("application/json"))
        return new Response("Expected application/json", {
          status: 415,
          headers: cors,
        });
      try {
        const { text } = await boundedText(request, 65536);
        parsedBody = JSON.parse(text);
      } catch {
        return new Response("Invalid or oversized JSON body", {
          status: 400,
          headers: cors,
        });
      }
      const body = parsedBody as {
        method?: string;
        params?: { name?: string };
      } | null;
      if (
        body?.method === "tools/call" &&
        body.params?.name === "wayback_save_page" &&
        env.SAVE_LIMITER &&
        !(await env.SAVE_LIMITER.limit({ key: "save-global" })).success
      )
        return new Response("Save submission rate limit exceeded", {
          status: 429,
          headers: { ...cors, "Retry-After": "60" },
        });
    }
    const server = createServer(
      new ArchiveHttp(
        fetch,
        env.IA_ACCESS_KEY
          ? `LOW ${env.IA_ACCESS_KEY}:${env.IA_SECRET_KEY}`
          : undefined,
      ),
      !!env.IA_ACCESS_KEY,
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const result = await transport.handleRequest(request, { parsedBody });
      const headers = new Headers(result.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(result.body, { status: result.status, headers });
    } catch {
      return Response.json(
        { error: "MCP transport error" },
        { status: 500, headers: cors },
      );
    } finally {
      await server.close();
    }
  },
};
