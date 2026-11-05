# Internet Archive MCP — unofficial

A remote MCP server running on Cloudflare Workers. **v0.1.0 is a Wayback-first preview**, with 17 agent-oriented tools. This project is not affiliated with or endorsed by the Internet Archive.

**Live endpoint:** https://archivedotorg-mcp-unofficial.defcronyke.workers.dev/mcp

**Transport:** Streamable HTTP

**Authentication for the public preview:** None

## Connect and test

In [ChatGPT Plugins](https://chatgpt.com/plugins), use **+ → Add custom MCP server**, enter the endpoint above, choose **No authentication**, and create the plugin. Availability depends on your account/workspace permissions. See [OpenAI's current setup guide](https://developers.openai.com/api/docs/guides/custom-mcp-server).

Other clients supporting remote Streamable HTTP MCP can use the same endpoint. For clients with JSON configuration:

```json
{
  "mcpServers": {
    "internet-archive": {
      "url": "https://archivedotorg-mcp-unofficial.defcronyke.workers.dev/mcp"
    }
  }
}
```

Some clients require `"type": "http"`; use that client's format. This is not the deprecated `/sse` transport. No API key is needed for archive research.

Try:

- “Find a January 2020 capture of example.com, read it, and cite the actual capture date.”
- “List archived HTML URLs under https://example.com/ and explain how to retrieve the next page.”
- “Compare example.com in 2010 and 2020. Tell me if Wayback selected different dates.”
- “Show the capture timeline and calendar for https://example.com/ in 2020.”
- “Save this public page to the Wayback Machine, then check its job status.”

## Tools

| Tool                           | Purpose                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `wayback_capabilities`         | Limits, authentication state, supported scope                                                                 |
| `wayback_available`            | Closest/latest available snapshot                                                                             |
| `wayback_available_batch`      | Up to five sequential lookups with per-URL errors                                                             |
| `wayback_search_captures`      | CDX date/status/MIME filters, exact/prefix/host/domain queries, adjacent deduplication, resume-key pagination |
| `wayback_list_urls`            | Discover URL inventory beneath a path or domain                                                               |
| `wayback_read_capture`         | Archived readable text, HTML or links; binary download links                                                  |
| `wayback_compare_captures`     | Bounded text changes with before/after citations                                                              |
| `wayback_timeline`             | Year/month capture counts from Wayback's sparkline interface                                                  |
| `wayback_calendar`             | Year/day capture buckets                                                                                      |
| `wayback_changes`              | Content-change candidates from adjacent CDX digests                                                           |
| `wayback_memento_timemap`      | Bounded Memento-style records derived from CDX; native timemap link                                           |
| `wayback_links`                | Browser replay, raw response, calendar, URL inventory, visual comparison and save links                       |
| `wayback_save_page`            | Public Save Page Now submission with capture options                                                          |
| `wayback_save_status`          | Asynchronous capture job status                                                                               |
| `wayback_save_outlinks_status` | Outlink job statuses                                                                                          |
| `wayback_save_service_status`  | Service health or configured-account quota                                                                    |
| `wayback_verify_capture`       | Exact-timestamp CDX verification                                                                              |

The server also provides the `wayback://guide` resource and `research_url_history` prompt.

## Scope and honesty about “all features”

This release covers the main publicly accessible Wayback research workflows and the Save Page Now API. It does **not** claim literal parity with every Wayback website feature or every archive.org product. See [the feature matrix](docs/features.md) for implemented, credential-dependent and website-only functions. Library search, item metadata/download/upload, OCR, media, lending and account management are future phases.

The public deployment uses anonymous upstream access. Save Page Now can require Internet Archive credentials or reject a request because of access rules, anti-abuse controls or quotas. A tool being present does not mean upstream permission has been granted. Submission is not proof of completion; successful job status is not proof of current replay access. Poll the job, verify the exact capture timestamp, and inspect replay when necessary.

Archived text is returned as **untrusted source material**, never instructions. Requests only go to Internet Archive origins, and redirects outside those origins are refused. Restricted or excluded archives remain restricted. Replay can substitute a nearby date; the result includes the resolved URL and timestamp. Text comparison is not a pixel/visual diff and does not execute JavaScript.

## Development

```sh
npm ci
npm run check
npm run dev
```

Local endpoint: `http://localhost:8787/mcp`. Tests build the Worker, exercise the actual workerd runtime with the official MCP client, and check API parsing, request boundaries and failure behavior. Development uses the pinned Miniflare v5 API from the lockfile; do not blindly substitute the v4 constructor format.

```sh
npm run smoke
# Optional: explicitly submit a public URL you control during the smoke run:
TEST_SAVE_URL=https://your-public-site.example/ npm run smoke
# Point the same read-only checks at a different deployment:
MCP_URL=http://localhost:8787/mcp npm run smoke
```

The smoke script performs real Internet Archive requests and can fail during upstream outages or throttling. Unit/integration tests do not require Internet Archive access or create captures.

## Deployment and operations

`deployment.json` is the authoritative Cloudflare API configuration. `npm run build` creates `dist/worker.js`; `scripts/deploy.mjs` uploads it with that metadata and enables the workers.dev route. This release was deployed through the Cloudflare connector into the repository owner's account.

For subsequent CLI deployments, supply a scoped Cloudflare API token through your environment and run `npm run deploy`. Do not put tokens in arguments, source, or chat. The deploy script requires Workers Scripts Write access for the configured account. It preserves existing secret bindings.

- `/health` provides version and service health (not upstream Archive health).
- `/` is a small setup page; `/mcp` is the protocol endpoint.
- Logs and sampled traces are enabled; query strings are redacted.
- Request bodies are capped at 64 KiB. Archive JSON responses at 2 MB; captured text reads at 1 MB; tool output is further bounded.
- CDX pages are limited to 200 captures. Batch availability is limited to five URLs.
- Requests use a 25-second upstream deadline and bounded redirects. Save requests are never automatically retried.
- Rate-limit bindings allow 60 MCP requests/minute per source IP and three save submissions/minute per Cloudflare location. These are approximate local limits, not globally coordinated budgets. Shared client egress IPs share the read limit.

### Optional private account mode

Set `MCP_TOKEN`, `IA_ACCESS_KEY` and `IA_SECRET_KEY` as Cloudflare secret bindings on a **private deployment**. The Worker refuses Archive-account access without MCP bearer authentication, and refuses incomplete key pairs. It sends Archive credentials only to the Save Page Now endpoints. Credentials are never tool inputs. Do not add credentials to the unauthenticated public preview.

Clients must support `Authorization: Bearer …` to use this mode. This release does not implement OAuth, so private bearer mode is not a general ChatGPT account-login integration. Public ChatGPT testing uses **No authentication**.

## Privacy

URL queries and requested capture parameters are sent to the Internet Archive. Save operations ask the Archive to preserve public content and linked resources. This Worker has no application database and does not persist tool arguments or captured content. Cloudflare operational logs/traces and upstream logs can retain request metadata according to their policies. Avoid including private tokens in target URLs. See [PRIVACY.md](PRIVACY.md).

## Sources

API behavior was checked against [Internet Archive's API overview](https://archive.org/help/wayback_api.php), [its CDX server documentation](https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server), [its Save Page Now client and options](https://github.com/internetarchive/gospn), and [its Wayback comparison implementation](https://github.com/internetarchive/wayback-diff). MCP uses the [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).

MIT licensed. Contributions should preserve provenance, bounded outputs, explicit failures, and the separation between public research and public archiving.
