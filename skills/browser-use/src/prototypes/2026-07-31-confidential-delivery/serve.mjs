// PROTOTYPE — throwaway static server so fixtures are http(s), not file://, so the
// browser-use harness target-discovery filter (http(s)-only) surfaces them.
// Serves the scratchpad dir. Run: bun serve.mjs   (default port 8787)
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import { existsSync, statSync } from "node:fs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || 8787);

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path === "/" || path === "") path = "/index.html";
    // prevent path traversal
    const filePath = normalize(join(ROOT, path));
    if (!filePath.startsWith(ROOT)) return new Response("forbidden", { status: 403 });
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      return new Response("not found: " + path, { status: 404 });
    }
    return new Response(Bun.file(filePath));
  },
});
console.log(`serving ${ROOT} at http://localhost:${server.port}`);
console.log(`  fixtures: http://localhost:${server.port}/fasttrack-fixture.html`);
console.log(`            http://localhost:${server.port}/login-shapes-fixture.html`);
