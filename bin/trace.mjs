#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Demonstração na linha de comandos, só com a rede de alta tensão do OpenStreetMap (sem as camadas da E-REDES).
// Uso: node bin/trace.mjs <latitude> <longitude> [normal|tempestade]
import { readFileSync } from "node:fs";
import { buildIndex, trace, SCENARIOS } from "../engine/trace.mjs";

const [lat, lon, sc = "normal"] = process.argv.slice(2);
if (!lat || !lon || !SCENARIOS[sc]) { console.error("uso: node bin/trace.mjs <lat> <lon> [normal|tempestade]"); process.exit(2); }
const grid = JSON.parse(readFileSync(new URL("../data/grid.json", import.meta.url)));
const rules = JSON.parse(readFileSync(new URL("../data/plant_status.json", import.meta.url)));
const r = trace(buildIndex(grid, rules), { lat: +lat, lon: +lon }, { scenario: SCENARIOS[sc], top: 5 });
if (r.error) { console.error(r.error); process.exit(1); }
console.log(`Subestação mais próxima: ${r.entry.name} (${r.entry.km} km, ${r.entry.volts} V)`);
console.log("Centrais prováveis (peso indicativo):");
for (const s of r.sources) console.log(`  ${String(s.share).padStart(5)}%  ${s.name} [${s.src}, ${s.mw} MW]${s.available ? "" : "  (fora de serviço neste cenário)"}`);
console.log(`Mistura: ${JSON.stringify(r.mix)}`);
console.log(r.disclaimer);
