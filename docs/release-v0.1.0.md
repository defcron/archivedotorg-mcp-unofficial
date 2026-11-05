# v0.1.0 — Wayback preview

Released November 5, 2026.

Remote MCP endpoint: https://archivedotorg-mcp-unofficial.defcronyke.workers.dev/mcp

This release adds 17 Wayback-focused tools, a workflow resource and a research prompt. It supports Streamable HTTP, structured results, bounded capture searches, provenance-bearing reads, text comparisons, timelines, calendars, URL inventory, Memento-style records and Save Page Now requests/status handling.

## Verification

- TypeScript strict checking and formatting pass.
- 36 automated tests pass, including workerd runtime integration using the official MCP client.
- Live Cloudflare tests successfully exercised initialization, tool discovery, nearest-capture lookup, CDX search, archived text reads, comparisons, timeline/calendar data, digest-change discovery and Memento-style results.
- Live anonymous Save Page Now submission of this project's public landing page returned **HTTP 401**. No capture creation was confirmed. Authenticated saving has not been tested because Internet Archive credentials were not configured.
- Save Page Now service-status calls returned **HTTP 429** and later **HTTP 401** from Cloudflare egress; these are surfaced as explicit upstream errors, not healthy results.
- Deployment ID: `7bec9518bf5d4aae96ce9dd120955186`.

This is an installable remote MCP preview, not an app-directory approval or a claim of complete Internet Archive product coverage. See the feature matrix and README for exact boundaries and connection instructions.
