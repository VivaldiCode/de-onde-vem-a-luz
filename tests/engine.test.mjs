// SPDX-License-Identifier: AGPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { clipEdgeGeometry, buildIndex, trace, haversine, availability, nearestPostos, polePath, feederPath, SCENARIOS } from "../engine/trace.mjs";

const grid = JSON.parse(readFileSync(new URL("../data/grid.json", import.meta.url)));
const BRAGA = { lat: 41.5513, lon: -8.423 }, PORTO = { lat: 41.1496, lon: -8.611 };

test("haversine: Lisboa–Porto ≈ 274 km", () => {
  const d = haversine([38.7223, -9.1393], [41.1496, -8.611]);
  assert.ok(d > 268 && d < 280, `distância ${d}`);
});

test("rede OSM: tem milhares de nós, centrais ligadas e uma componente principal", () => {
  assert.ok(grid.nodes.length > 1500 && grid.edges.length > 2000 && grid.plants.length > 1500);
  assert.ok(grid.meta.components_top[0] > 1000, "a rede devia estar quase toda ligada");
});

test("Braga: a subestação de entrada é a de Braga e há centrais prováveis", () => {
  const r = trace(buildIndex(grid), BRAGA, { top: 8 });
  assert.match(r.entry.name, /Braga/);
  assert.ok(r.entry.km < 3);
  assert.equal(r.sources.length, 8);
  const sum = Object.values(r.mix).reduce((a, b) => a + b, 0);
  assert.ok(sum > 98 && sum < 102, `a mistura devia somar ~100%, deu ${sum}`);
  assert.ok(r.sources.every((s, i, a) => i === 0 || a[i - 1].share >= s.share), "ordenado por peso");
});

test("cenário tempestade: sem solar nem eólica", () => {
  const r = trace(buildIndex(grid), BRAGA, { scenario: SCENARIOS.tempestade, top: 10 });
  assert.equal(r.mix.wind ?? 0, 0);
  assert.equal(r.mix.solar ?? 0, 0);
  assert.ok(r.sources.every((s) => s.src !== "wind" && s.src !== "solar" || !s.available));
});

test("availability: vento corta ≥ 95 km/h; solar segue o cenário", () => {
  assert.equal(availability({ src: "wind" }, { windGustKmh: 110 }), 0);
  assert.equal(availability({ src: "wind" }, { windGustKmh: 80 }), 1);
  assert.equal(availability({ src: "solar" }, { solar: 0 }), 0);
  assert.equal(availability({ src: "hydro" }, { solar: 0, windGustKmh: 200 }), 1);
});

test("estado das centrais: «em reserva» conta zero", () => {
  const rules = [{ match: "Tapada do Outeiro", status: "reserve", note: "teste" }];
  const r = trace(buildIndex(grid, rules), PORTO, { top: 5000 }); // peso zero: vai para o fim da lista
  const t = r.sources.find((s) => /Tapada do Outeiro/.test(s.name));
  assert.ok(t, "a Tapada do Outeiro devia estar entre as candidatas junto ao Porto");
  assert.equal(t.available, false);
  assert.equal(t.status, "reserve");
});

test("nearestPostos: ordena por distância e respeita o raio", () => {
  const P = [[41.0001, -8.0, "A", 250, "0%", "10", "x"], [41.001, -8.0, "B", 400, "0%", "20", "x"], [41.05, -8.0, "C", 100, "0%", "5", "x"]];
  const r = nearestPostos(P, { lat: 41, lon: -8 }, 5, 0.5);
  assert.deepEqual(r.map((p) => p.code), ["A", "B"]);
});

test("polePath: segue a fila de postes e falha quando há um buraco grande", () => {
  const from = [41, -8], to = [41, -8 + 0.0035]; // ~295 m
  const line = []; for (let k = 1; k <= 6; k++) line.push([41.0001, -8 + k * 0.0005]); // postes de ~42 m ao longo da rua
  const r = polePath(line, from, to);
  assert.ok(r && r.chain.length >= 4, "devia ligar pela fila de postes");
  assert.ok(r.chain.every((p, i, a) => i === 0 || p.lon >= a[i - 1].lon), "avança da casa para o posto");
  const broken = [[41.0001, -8.0005], [41.0001, -8.0035]]; // vão de ~300 m
  assert.equal(polePath(broken, from, to), null);
});

test("feederPath: devolve só o ramo que liga ao sítio da subestação", () => {
  const feeders = [{ sub: "S1", g: [[[41.0, -8.0], [41.0, -8.001], [41.0, -8.002]], [[41.0, -8.001], [41.001, -8.001]]] }, { sub: "S2", g: [[[42, -8], [42, -8.001]]] }];
  const r = feederPath(feeders, "S1", [41.001, -8.001], [41.0, -8.002]);
  assert.ok(r.connected && r.coords.length >= 3);
  assert.deepEqual(r.coords[0].map((x) => +x.toFixed(3)), [41.001, -8.001]);
  assert.equal(feederPath(feeders, "S9", [41, -8], [41, -8]), null);
});

test("clipEdgeGeometry: corta o «gancho» que passa da subestação e volta para trás", () => {
  const idx = { nodes: new Map([["s", { k: "sub", lat: 0, lon: 0 }], ["j", { k: "jct", lat: 0, lon: -0.02 }]]) };
  // chega à subestação por oeste, passa por ela e dá a volta para norte (≈ 330 m de «rabo»)
  const e = { a: "j", b: "s", g: [[0, -0.02], [0, -0.005], [0, 0], [0.003, 0], [0.003, -0.001]] };
  const g = clipEdgeGeometry(idx, e);
  const last = g[g.length - 1];
  assert.ok(Math.hypot(last[0], last[1]) < 1e-4, `o traçado devia acabar na subestação, acaba em ${last}`);
  assert.ok(g.length <= 3);
});

test("clipEdgeGeometry: não mexe numa linha que já acaba na subestação nem em junções", () => {
  const idx = { nodes: new Map([["s", { k: "sub", lat: 0, lon: 0 }], ["j", { k: "jct", lat: 0, lon: -0.02 }]]) };
  const e = { a: "j", b: "s", g: [[0, -0.02], [0, -0.01], [0, 0]] };
  assert.deepEqual(clipEdgeGeometry(idx, e), e.g);
});

test("polePath passa por todos os apoios que estão na linha (custo convexo)", () => {
  // 8 apoios em fila, de 25 m em 25 m, entre a casa (0,0) e o posto a 200 m
  const kx = 111320, from = [41, -8], pts = Array.from({ length: 7 }, (_, i) => [41, -8 + ((i + 1) * 25) / (kx * Math.cos((41 * Math.PI) / 180))]);
  const to = [41, -8 + 200 / (kx * Math.cos((41 * Math.PI) / 180))];
  const r = polePath(pts, from, to);
  assert.equal(r.chain.length, 7);
});

test("plant_info.json: ids existem na rede, links https, sem emails", () => {
  const info = JSON.parse(readFileSync(new URL("../data/plant_info.json", import.meta.url)));
  const ids = new Set(grid.plants.map((p) => p.id));
  for (const [id, f] of Object.entries(info)) {
    assert.ok(ids.has(id), `central desconhecida ${id}`);
    assert.ok(!f.link || /^https:\/\//.test(f.link), `link inseguro em ${id}`);
    assert.ok(["alta", "media", "baixa"].includes(f.confianca), `confiança inválida em ${id}`);
    assert.ok(!/@/.test(JSON.stringify(f)), `email em ${id}`);
  }
});

const TEM_EREDES = existsSync(new URL("../web/data/eredes/subs.json", import.meta.url)); // dados derivados da E-REDES não vão no repo
test("rntNode encontra o nó da REN mesmo com «d'» e abreviaturas da E-REDES", { skip: !TEM_EREDES && "sem web/data/eredes (gerar com tools/build_eredes.py)" }, async () => {
  const { buildEreIndex } = await import("../engine/trace.mjs");
  const subs = JSON.parse(readFileSync(new URL("../web/data/eredes/subs.json", import.meta.url)));
  const ei = buildEreIndex({ subs: subs.subs, feeders: [] }, buildIndex(grid, []));
  assert.match(ei.rntNode("Riba de Ave").name, /Riba d'Ave/);
  assert.match(ei.rntNode("R. Maior").name, /Rio Maior/);
  assert.match(ei.rntNode("Vila P. Aguiar").name, /Pouca de Aguiar/);
});
