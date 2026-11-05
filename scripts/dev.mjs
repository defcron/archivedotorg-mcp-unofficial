import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
const config = JSON.parse(await readFile("deployment.json", "utf8"));
const mf = new Miniflare({
  port: 8787,
  workers: [
    {
      config: {
        name: "archive-dev",
        compatibilityDate: config.metadata.compatibility_date,
        compatibilityFlags: config.metadata.compatibility_flags,
        manifest: {
          mainModule: "worker.js",
          modules: {
            "worker.js": {
              type: "esm",
              contents: await readFile("dist/worker.js", "utf8"),
            },
          },
        },
      },
    },
  ],
});
console.log(`Local MCP: ${await mf.ready}mcp`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await mf.dispose();
    process.exit(0);
  });
