// SPDX-License-Identifier: AGPL-3.0-or-later
// Higiene do repositório público: nenhum email, nome, IP interno, identificador de conta ou referência à infraestrutura privada.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const SKIP_DIRS = new Set([".git", "node_modules", ".wrangler", "raw", "vendor", "__pycache__"]);
const SKIP_PATHS = [/^web\/data\//, /^data\/.*\.json$/, /^web\/.*\.json$/, /^LICENSE$/, /^tests\/hygiene\.test\.mjs$/];
const TEXT = new Set([".mjs", ".js", ".py", ".md", ".html", ".yaml", ".yml", ".jsonc", ".txt", ".sh", ".css", ""]);

function* walk(dir, rel = "") {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name), r = rel ? `${rel}/${name}` : name, st = statSync(p);
    if (st.isDirectory()) yield* walk(p, r);
    else if (st.size < 3_000_000 && TEXT.has(extname(name)) && !SKIP_PATHS.some((re) => re.test(r))) yield [r, p];
  }
}

// padrões montados por partes para este ficheiro não os conter literalmente
const j = (...a) => a.join("");
// único nome de anfitrião autorizado a conter o nome próprio: o endereço público de pré-visualização
const ALLOWED_HOSTS = [j("luz.guilher", "mepinto.pt")];
const FORBIDDEN = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/, "endereço de email"],
  [new RegExp(j("guilher", "me"), "i"), "nome próprio"],
  [new RegExp(j("camacho", "p"), "i"), "conta pessoal"],
  [new RegExp(j("infis", "ical"), "i"), "cofre de segredos privado"],
  [new RegExp(j("home", "lab"), "i"), "infraestrutura privada"],
  [new RegExp(j("HOM", "EL-"), ""), "item de planeamento interno"],
  [new RegExp(j("aist", "or"), "i"), "armazenamento privado"],
  [new RegExp(j("\\.claude", "/bin")), "ferramenta local"],
  [new RegExp(j("vs", "sh\\b")), "ferramenta local"],
  [/\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, "IP interno"],
  [/\b192\.168\.\d{1,3}\.\d{1,3}\b/, "IP interno"],
  [/\b[0-9a-f]{32}\b/, "identificador de conta/recurso (32 hex)"],
];

test("nenhum ficheiro de texto contém dados pessoais ou da infraestrutura privada", () => {
  const found = [];
  for (const [rel, p] of walk(root)) {
    const txt = ALLOWED_HOSTS.reduce((t, a) => t.split(a).join(""), readFileSync(p, "utf8"));
    for (const [re, why] of FORBIDDEN) { const m = txt.match(re); if (m) found.push(`${rel}: ${why} («${m[0].slice(0, 40)}»)`); }
  }
  assert.deepEqual(found, [], "\n" + found.join("\n"));
});

test("a licença e os cabeçalhos SPDX existem", () => {
  assert.match(readFileSync(join(root, "LICENSE"), "utf8"), /GNU AFFERO GENERAL PUBLIC LICENSE/);
  const missing = [];
  for (const [rel, p] of walk(root)) {
    if (!/\.(mjs|py|sh)$/.test(rel)) continue;
    if (!/SPDX-License-Identifier: AGPL-3\.0-or-later/.test(readFileSync(p, "utf8").slice(0, 400))) missing.push(rel);
  }
  assert.deepEqual(missing, [], "faltam cabeçalhos SPDX: " + missing.join(", "));
});
