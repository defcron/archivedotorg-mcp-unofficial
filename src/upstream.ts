export class UpstreamError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
    public retryAfter?: string | null,
  ) {
    super(message);
  }
}
export function publicUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new Error("Provide an absolute http:// or https:// URL.");
  }
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    !h.includes(".") ||
    h.includes(":") ||
    /^\d+(\.\d+){3}$/.test(h) ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(h)
  )
    throw new Error(
      "Only public HTTP(S) domain URLs without credentials are supported.",
    );
  if (u.port && !["80", "443"].includes(u.port))
    throw new Error("Only standard HTTP(S) ports are supported.");
  u.hash = "";
  return u.href;
}
export async function boundedText(
  response: Pick<Response, "body">,
  maxBytes = 2_000_000,
  truncate = false,
) {
  const reader = response.body?.getReader();
  if (!reader) return { text: "", truncated: false };
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (bytes + value.byteLength > maxBytes) {
        if (!truncate)
          throw new UpstreamError(
            "response_too_large",
            "Archive response exceeds the safety limit. Narrow the date range or lower the result limit.",
          );
        text += decoder.decode(value.subarray(0, maxBytes - bytes), {
          stream: true,
        });
        text += decoder.decode();
        return { text, truncated: true };
      }
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
    return { text: text + decoder.decode(), truncated: false };
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export class ArchiveHttp {
  constructor(
    private fetcher: typeof fetch = fetch,
    private iaAuthorization?: string,
  ) {}
  async get(url: string, init: RequestInit = {}, allowArchivedError = false) {
    let next = new URL(url);
    const deadline = AbortSignal.timeout(25_000);
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (
        next.protocol !== "https:" ||
        !["archive.org", "web.archive.org"].includes(next.hostname) ||
        next.port ||
        next.username ||
        next.password
      )
        throw new UpstreamError(
          "unsafe_redirect",
          "Refused redirect outside Internet Archive.",
        );
      const headers = new Headers(init.headers);
      headers.set(
        "User-Agent",
        "archivedotorg-mcp-unofficial/0.1.0 (+https://github.com/defcron/archivedotorg-mcp-unofficial)",
      );
      if (
        this.iaAuthorization &&
        next.hostname === "web.archive.org" &&
        next.pathname.startsWith("/save")
      )
        headers.set("Authorization", this.iaAuthorization);
      let response: Response;
      try {
        const fetcher = this.fetcher;
        response = await fetcher(next.href, {
          ...init,
          headers,
          redirect: "manual",
          signal: deadline,
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "archive_fetch_failed",
            reason:
              error instanceof Error ? error.message : "Unknown network error",
          }),
        );
        throw new UpstreamError(
          "upstream_unavailable",
          "Internet Archive request failed or timed out. Retry later.",
        );
      }
      if (
        [301, 302, 303, 307, 308].includes(response.status) &&
        response.headers.has("location")
      ) {
        await response.body?.cancel();
        if (init.method && init.method !== "GET")
          throw new UpstreamError(
            "save_redirect",
            "Save Page Now redirected instead of accepting a job; authentication may be required.",
            response.status,
          );
        next = new URL(response.headers.get("location")!, next);
        if (next.hostname === "web.archive.org" && next.protocol === "http:")
          next.protocol = "https:";
        continue;
      }
      if (
        !response.ok &&
        !(allowArchivedError && response.headers.has("memento-datetime"))
      ) {
        await response.body?.cancel();
        throw new UpstreamError(
          response.status === 429
            ? "rate_limited"
            : response.status === 401 || response.status === 403
              ? "access_denied"
              : "upstream_error",
          `Internet Archive returned HTTP ${response.status}. No result was inferred.`,
          response.status,
          response.headers.get("retry-after"),
        );
      }
      return { response, url: next.href };
    }
    throw new UpstreamError(
      "redirect_limit",
      "Internet Archive exceeded the redirect limit.",
    );
  }
  async json(url: string, init: RequestInit = {}) {
    const { response, url: sourceUrl } = await this.get(url, {
      ...init,
      headers: { Accept: "application/json", ...init.headers },
    });
    const { text } = await boundedText(response);
    try {
      return { data: JSON.parse(text) as unknown, sourceUrl };
    } catch {
      throw new UpstreamError(
        "invalid_upstream_response",
        "Internet Archive returned non-JSON content (possibly a login or service page).",
      );
    }
  }
}
export function endpoint(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  host = "https://web.archive.org",
) {
  const u = new URL(path, host);
  for (const [k, v] of Object.entries(params))
    if (v !== undefined) u.searchParams.set(k, String(v));
  return u.href;
}
