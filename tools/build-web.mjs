// SPDX-License-Identifier: AGPL-3.0-or-later
// Copia o motor e os dados pequenos para web/ (a aplicação estática serve tudo de lá). Corre antes do dev e do deploy.
import { copyFileSync, existsSync } from "node:fs";
const root = new URL("../", import.meta.url);
for (const [from, to] of [["engine/trace.mjs", "web/trace.mjs"], ["engine/flow.mjs", "web/flow.mjs"], ["data/grid.json", "web/grid.json"], ["data/plant_status.json", "web/plant_status.json"], ["data/plant_info.json", "web/plant_info.json"], ["data/entsoe_map.json", "web/entsoe_map.json"]]) {
  if (existsSync(new URL(from, root))) copyFileSync(new URL(from, root), new URL(to, root));
}
console.log("web/ pronto (trace.mjs, flow.mjs, grid.json, plant_status.json, plant_info.json, entsoe_map.json)");
