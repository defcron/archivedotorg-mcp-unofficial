# Privacy — unofficial Internet Archive MCP

This service forwards the URLs, dates, filters and save options needed to perform requested Wayback Machine operations to archive.org or web.archive.org. It does not receive the rest of a conversation unless a client includes it in a tool argument.

The application stores no conversations, capture text, user accounts or job database. Cloudflare provides hosting, approximate rate limiting, invocation logs and sampled traces. Query strings are redacted in those operational logs; network failure diagnostics may be logged. Internet Archive operates its own logging and retention independently.

Save Page Now is a public publishing operation. It may archive the requested page, embedded resources, optional outlinks and screenshots, subject to Internet Archive's rules. Only submit public content you intend to preserve. Do not include private access tokens in URLs.

The public preview has no user login or stored Internet Archive credentials. Optional private deployments can use server-side secret bindings and require bearer authentication. Keys are not exposed as MCP tool parameters.

This project is unofficial and is not endorsed by Internet Archive, OpenAI or Cloudflare. Report project problems through the GitHub repository; do not post credentials or private URLs in public issues.
