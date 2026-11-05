import { readFile } from "node:fs/promises";
const config = JSON.parse(await readFile("deployment.json", "utf8"));
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token)
  throw new Error(
    "Set CLOUDFLARE_API_TOKEN in your environment, or deploy the same bundle and deployment.json metadata through the Cloudflare connector.",
  );
const root = `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/workers`;
async function call(path, init = {}) {
  const response = await fetch(root + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
  const data = await response.json();
  if (!response.ok || !data.success)
    throw new Error(JSON.stringify(data.errors));
  return data.result;
}
const form = new FormData();
form.set(
  "metadata",
  new Blob([JSON.stringify(config.metadata)], { type: "application/json" }),
);
form.set(
  "worker.js",
  new Blob([await readFile("dist/worker.js")], {
    type: "application/javascript+module",
  }),
  "worker.js",
);
const result = await call(`/scripts/${config.name}`, {
  method: "PUT",
  body: form,
});
await call(`/scripts/${config.name}/subdomain`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ enabled: true, previews_enabled: false }),
});
const sub = await call("/subdomain");
console.log(
  JSON.stringify({
    version: result.id,
    url: `https://${config.name}.${sub.subdomain}.workers.dev/mcp`,
  }),
);
