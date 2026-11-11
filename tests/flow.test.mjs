// SPDX-License-Identifier: AGPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "../engine/trace.mjs";
import { buildFlowModel, flowSources } from "../engine/flow.mjs";

const N = (id, lat) => ({ id, k: "sub", lat, lon: -8, v: 150000, name: id });
const E = (a, b, km) => ({ a, b, v: 150000, km, g: [] });
const P = (id, to, mw = 100, pt = true) => ({ id, name: id, src: "hydro", mw, to, pt, lat: 41, lon: -8, dkm: 0.5 });
const scenario = { solar: 1, windGustKmh: 0 };
const gen = (mw, imp = 0) => ({ asOf: "2026-01-01T00:00", byType: { hydro: mw }, consumptionMw: mw + imp, importMw: imp });
const mk = (nodes, edges, plants, loadAt, load) => {
  const idx = buildIndex({ nodes, edges, plants });
  return { idx, ei: { toOsm: new Map([["S", { id: loadAt }]]) }, loads: { S: { w: load, s: load } } };
};

test("triângulo simétrico: duas centrais iguais repartem 50/50", () => {
  const { idx, ei, loads } = mk([N("n1", 41), N("n2", 41.1), N("n3", 41.2)], [E("n1", "n3", 10), E("n2", "n3", 10)], [P("p1", "n1"), P("p2", "n2")], "n3", 80);
  const f = flowSources(buildFlowModel(idx, ei, loads, gen(80), scenario), "n3", 5);
  assert.equal(f.sources.length, 2);
  assert.ok(Math.abs(f.sources[0].share - 50) < 1, `partilha ${f.sources[0].share}`);
  assert.ok(Math.abs(f.sources.reduce((s, x) => s + x.flowMw, 0) - 80) < 0.5, "os MW somam a carga");
});

test("duas cargas, duas centrais nas pontas: cada carga é abastecida pela central que tem ao lado", () => {
  const idx = buildIndex({ nodes: [N("n1", 41), N("n3", 41.1), N("n4", 41.2), N("n2", 41.3)], edges: [E("n1", "n3", 10), E("n3", "n4", 10), E("n4", "n2", 10)], plants: [P("p1", "n1"), P("p2", "n2")] });
  const ei = { toOsm: new Map([["S3", { id: "n3" }], ["S4", { id: "n4" }]]) };
  const m = buildFlowModel(idx, ei, { S3: { w: 40, s: 40 }, S4: { w: 40, s: 40 } }, gen(80), scenario);
  const a = flowSources(m, "n3", 5), b = flowSources(m, "n4", 5);
  assert.equal(a.sources[0].id, "p1"); assert.ok(a.sources[0].share > 95, `n3: ${a.sources[0].share}`);
  assert.equal(b.sources[0].id, "p2"); assert.ok(b.sources[0].share > 95, `n4: ${b.sources[0].share}`);
});

test("conservação: a geração repartida iguala a carga (potências desiguais → 75/25)", () => {
  const { idx, ei, loads } = mk([N("n1", 41), N("n2", 41.1), N("n3", 41.2)], [E("n1", "n3", 10), E("n2", "n3", 25)], [P("p1", "n1", 300), P("p2", "n2", 100)], "n3", 80);
  const m = buildFlowModel(idx, ei, loads, gen(80), scenario);
  assert.ok(Math.abs(m.out.get("p1") + m.out.get("p2") - 80) < 1e-6);
  const f = flowSources(m, "n3", 5);
  assert.ok(Math.abs(f.sources[0].share - 75) < 1, `partilha ${f.sources[0].share}`);
});

test("cadeia radial: tudo vem da única central e o caminho vai da subestação à central", () => {
  const { idx, ei, loads } = mk([N("n1", 41), N("n2", 41.1), N("n3", 41.2)], [E("n1", "n2", 10), E("n2", "n3", 10)], [P("p1", "n1")], "n3", 50);
  const f = flowSources(buildFlowModel(idx, ei, loads, gen(50), scenario), "n3", 5);
  assert.equal(f.sources.length, 1);
  assert.equal(f.sources[0].share, 100);
  assert.deepEqual(f.sources[0].edgeIdx, [1, 0], "primeiro a aresta junto à subestação, depois a da central");
  assert.equal(f.sources[0].pathComplete, true);
});

test("importação: a central fora de Portugal recebe só o MW de importação", () => {
  const { idx, ei, loads } = mk([N("n1", 41), N("n2", 41.1), N("n3", 41.2)], [E("n1", "n3", 10), E("n2", "n3", 10)], [P("pt", "n1"), P("es", "n2", 100, false)], "n3", 100);
  const m = buildFlowModel(idx, ei, loads, gen(80, 20), scenario);
  assert.ok(Math.abs(m.out.get("es") - 20) < 0.01 && Math.abs(m.out.get("pt") - 80) < 0.01);
  const f = flowSources(m, "n3", 5);
  assert.equal(f.mix["importação"] > 0, true);
});

test("centrais fora de serviço não produzem", () => {
  const idx = buildIndex({ nodes: [N("n1", 41), N("n2", 41.1), N("n3", 41.2)], edges: [E("n1", "n3", 10), E("n2", "n3", 10)], plants: [P("p1", "n1"), P("p2", "n2")] }, [{ match: "^p1$", status: "closed", note: "x" }]);
  const m = buildFlowModel(idx, { toOsm: new Map([["S", { id: "n3" }]]) }, { S: { w: 60, s: 60 } }, gen(60), scenario);
  assert.equal(m.out.has("p1"), false);
  assert.equal(flowSources(m, "n3", 5).sources[0].id, "p2");
});

test("sem cargas conhecidas não há modelo", () => {
  const { idx, ei } = mk([N("n1", 41), N("n2", 41.1)], [E("n1", "n2", 10)], [P("p1", "n1")], "n2", 0);
  assert.equal(buildFlowModel(idx, ei, {}, gen(10), scenario), null);
});
