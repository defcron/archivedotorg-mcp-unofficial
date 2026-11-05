import { describe, it, expect, vi } from "vitest";
import { ArchiveHttp, publicUrl, boundedText } from "../src/upstream";
import { parseCdx, extractHtml, Wayback } from "../src/wayback";
const fake = (data: unknown) =>
  vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json(data),
  );
describe("archive boundary", () => {
  it.each([
    "file:///etc/passwd",
    "https://localhost/",
    "http://127.0.0.1",
    "http://2130706433",
    "http://[::1]",
    "https://user:password@example.com",
    "https://a.internal",
    "https://example.com:8080",
  ])("rejects unsafe target %s", (u) => expect(() => publicUrl(u)).toThrow());
  it("normalizes URLs and strips fragments", () =>
    expect(publicUrl("https://example.com/a?q=1#x")).toBe(
      "https://example.com/a?q=1",
    ));
  it("refuses redirects off archive without following", async () => {
    const f = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://example.com/live" },
        }),
    );
    await expect(
      new ArchiveHttp(f).get(
        "https://web.archive.org/web/2020/https://example.com",
      ),
    ).rejects.toMatchObject({ code: "unsafe_redirect" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("does not retry mutating requests", async () => {
    const f = vi.fn(async () => new Response(null, { status: 503 }));
    await expect(
      new ArchiveHttp(f).json("https://web.archive.org/save", {
        method: "POST",
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("returns actionable rate limiting", async () => {
    const f = vi.fn(
      async () =>
        new Response(null, { status: 429, headers: { "Retry-After": "120" } }),
    );
    await expect(
      new ArchiveHttp(f).json("https://archive.org/wayback/available"),
    ).rejects.toMatchObject({ code: "rate_limited", retryAfter: "120" });
  });
  it("keeps credentials off availability and replay requests", async () => {
    const f = fake({});
    const http = new ArchiveHttp(f, "LOW secret:key");
    await http.json("https://archive.org/wayback/available");
    expect(
      new Headers(f.mock.calls[0]?.[1]?.headers).has("authorization"),
    ).toBe(false);
  });
  it("limits buffered content", async () => {
    await expect(boundedText(new Response("1234567"), 3)).rejects.toMatchObject(
      { code: "response_too_large" },
    );
    expect(await boundedText(new Response("1234567"), 3, true)).toEqual({
      text: "123",
      truncated: true,
    });
  });
  it("handles malformed JSON as a tool-level upstream error", async () => {
    await expect(
      new ArchiveHttp(
        vi.fn(async () => new Response("<html>login</html>")),
      ).json("https://web.archive.org/save"),
    ).rejects.toMatchObject({ code: "invalid_upstream_response" });
  });
});
describe("Wayback semantics", () => {
  it("parses documented CDX resume markers", () => {
    const r = parseCdx([
      ["timestamp", "original"],
      ["20200101000000", "https://example.com"],
      [],
      ["opaque+key"],
    ]);
    expect(r.nextResumeKey).toBe("opaque+key");
    expect(r.captures[0].replayUrl).toContain("/20200101000000/");
  });
  it("rejects malformed CDX instead of inventing results", () => {
    expect(() => parseCdx({})).toThrow();
    expect(() => parseCdx([["bad"]])).toThrow();
    expect(parseCdx([]).captures).toEqual([]);
  });
  it("escapes nested URL queries and preserves CDX paging", async () => {
    const f = fake([]);
    await new Wayback(new ArchiveHttp(f)).search({
      url: "https://example.com/?a=1&b=2",
      resumeKey: "opaque+key",
      filters: ["statuscode:200", "!mimetype:image/.*"],
      limit: 2,
    });
    const u = new URL(String(f.mock.calls[0]?.[0]));
    expect(u.searchParams.get("url")).toBe("https://example.com/?a=1&b=2");
    expect(u.searchParams.getAll("filter")).toHaveLength(2);
    expect(u.searchParams.get("resumeKey")).toBe("opaque+key");
  });
  it("strips scripts, decodes entities and resolves links", () => {
    const r = extractHtml(
      '<title>Test</title><script>danger()</script><p>A &amp; B</p><a href="/next">Next</a>',
      "https://example.com/a",
    );
    expect(r.text).not.toContain("danger");
    expect(r.text).toContain("A & B");
    expect(r.links).toEqual([
      { url: "https://example.com/next", text: "Next" },
    ]);
  });
  it("reports the actual replay date after redirects", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/web/20200202000000id_/https://example.com/" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("<p>archived</p>", {
          headers: {
            "content-type": "text/html",
            "memento-datetime": "Sun, 02 Feb 2020 00:00:00 GMT",
          },
        }),
      );
    const r = await new Wayback(new ArchiveHttp(f)).read(
      "https://example.com/",
      "20200101",
    );
    expect(r.actualTimestamp).toBe("20200202000000");
    expect(r.text).toBe("archived");
  });
  it("serializes save options and reports submission separately", async () => {
    const f = fake({ job_id: "abc" });
    const r = await new Wayback(new ArchiveHttp(f)).save(
      "https://example.com/",
      { capture_screenshot: true, js_behavior_timeout: 0 },
    );
    expect(String(f.mock.calls[0]?.[1]?.body)).toContain(
      "capture_screenshot=1",
    );
    expect(String(f.mock.calls[0]?.[1]?.body)).toContain(
      "js_behavior_timeout=0",
    );
    expect(r.note).toContain("Submission is not completion");
  });
  it("verifies exact capture timestamps", async () => {
    const f = fake([
      ["timestamp", "original"],
      ["20200101000000", "https://example.com/"],
    ]);
    const r = await new Wayback(new ArchiveHttp(f)).verify(
      "https://example.com/",
      "20200101000000",
    );
    expect(r.indexed).toBe(true);
    const u = new URL(String(f.mock.calls[0]?.[0]));
    expect(u.searchParams.get("from")).toBe(u.searchParams.get("to"));
  });
});

describe("live regression protection", () => {
  it("calls platform fetch as a standalone function", async () => {
    const f = async function (
      this: unknown,
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) {
      expect(this).toBeUndefined();
      return Response.json({ ok: true });
    };
    expect(
      (await new ArchiveHttp(f).json("https://archive.org/wayback/available"))
        .data,
    ).toEqual({ ok: true });
  });
  it("does not confuse an HTML service page with archived content", async () => {
    const f = vi.fn(
      async () =>
        new Response("<html>Temporarily unavailable</html>", {
          headers: { "content-type": "text/html" },
        }),
    );
    await expect(
      new Wayback(new ArchiveHttp(f)).read(
        "https://example.com/",
        "20200101000000",
      ),
    ).rejects.toMatchObject({ code: "unverified_replay" });
  });
  it("uses redirected original URL for citations and relative links", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: "/web/20200101000000id_/https://www.example.com/renamed/",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response('<a href="next">Next</a>', {
          headers: {
            "content-type": "text/html",
            "memento-datetime": "Wed, 01 Jan 2020 00:00:00 GMT",
          },
        }),
      );
    const r = await new Wayback(new ArchiveHttp(f)).read(
      "https://example.com/",
      "2020",
      "links",
    );
    expect(r.replayUrl).toContain("https://www.example.com/renamed/");
    expect("links" in r && r.links?.[0].url).toBe(
      "https://www.example.com/renamed/next",
    );
  });
});
