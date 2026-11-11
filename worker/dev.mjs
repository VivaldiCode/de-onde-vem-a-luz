// SPDX-License-Identifier: AGPL-3.0-or-later
// Servidor local: estáticos de web/ + o mesmo handler do Worker em /api/*. Uso: node worker/dev.mjs [porta]
import http from "node:http"; import { readFile } from "node:fs/promises"; import { extname, join, normalize } from "node:path";
import worker from "./index.mjs";
const ROOT = new URL("../web/", import.meta.url).pathname, PORT = +process.argv[2] || 8787;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/")) {
    const r = await worker.fetch(new Request("http://x" + req.url), {});
    res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(Buffer.from(await r.arrayBuffer()));
  }
  const p = normalize(join(ROOT, u.pathname === "/" ? "index.html" : u.pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try { const b = await readFile(p); const extra = {};
    if (process.env.WITH_HEADERS) for (const l of (await readFile(join(ROOT, "_headers"), "utf8")).split("\n")) { const m = l.match(/^\s+([\w-]+):\s*(.+)$/); if (m) extra[m[1]] = m[2]; }
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream", ...extra }); res.end(b); }
  catch { res.writeHead(404); res.end("not found"); }
}).listen(PORT, "127.0.0.1", () => console.log(`http://127.0.0.1:${PORT}`));
