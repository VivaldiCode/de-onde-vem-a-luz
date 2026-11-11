// SPDX-License-Identifier: AGPL-3.0-or-later
// Rastreio de fluxo: reparte a energia que chega a uma subestação pelas centrais que a produzem.
//
// Modelo (melhor esforço, com dados abertos):
//   1. Rede: grafo OSM ≥ 60 kV; reactância de cada linha ∝ comprimento × reactância típica por km da sua tensão.
//   2. Cargas: ponta de cada subestação AT/MT (E-REDES `carga-na-subestacao`), escalada para igualar o consumo nacional
//      (REN) na hora dos dados.
//   3. Geração: totais por tipo (REN) repartidos pelas centrais de Portugal em proporção da potência instalada
//      (centrais encerradas/em reserva contam zero); a importação (REN) repartida pelas centrais espanholas da malha.
//   4. Fluxo DC (ângulos por gradiente conjugado) e rastreio proporcional (Bialek): em cada nó, a energia que sai tem a
//      mesma composição da que entra. Os fluxos DC seguem uma ordem de ângulos, logo não têm ciclos.
// NÃO é o fluxo real: faltam as topologias reais, as manobras e a geração medida por central (ENTSO-E).

import { availability } from "./trace.mjs";

const XKM = (v) => (v >= 380000 ? 1.9e-4 : v >= 200000 ? 8.3e-4 : v >= 130000 ? 1.8e-3 : 1.1e-2); // pu/km (base 100 MVA), valores típicos
const BUCKET = { hydro: "hydro", wind: "wind", solar: "solar", gas: "gas", biomass: "biomass", biogas: "biomass", waste: "biomass", oil: "other_thermal", coal: "coal" };
const DISPATCH = new Set(["hydro", "gas", "other_thermal", "coal"]); // o que cobre o que faltar quando se tira vento/solar

export function buildFlowModel(idx, ei, loads, gen, scenario = { solar: 1, windGustKmh: 0 }, opts = {}) {
  const { grid } = idx;
  const nodes = grid.nodes, N = nodes.length, pos = new Map(nodes.map((n, i) => [n.id, i]));
  const adj = Array.from({ length: N }, () => []);
  grid.edges.forEach((e, k) => { const a = pos.get(e.a), b = pos.get(e.b); if (a == null || b == null) return;
    const x = Math.max(0.2, e.km) * XKM(e.v || 60000); adj[a].push([b, 1 / x, k]); adj[b].push([a, 1 / x, k]); });
  // maior componente ligada
  const comp = new Int32Array(N).fill(-1); let best = -1, bestSize = 0, cid = 0;
  for (let s = 0; s < N; s++) { if (comp[s] >= 0) continue; let sz = 0; const st = [s]; comp[s] = cid;
    while (st.length) { const u = st.pop(); sz++; for (const [v] of adj[u]) if (comp[v] < 0) { comp[v] = cid; st.push(v); } }
    if (sz > bestSize) { bestSize = sz; best = cid; } cid++; }
  // cargas (MW) nas subestações E-REDES casadas com nós OSM da componente
  const winter = !(gen?.asOf) || [10, 11, 12, 1, 2, 3].includes(+String(gen.asOf).slice(5, 7));
  const L = new Float64Array(N); let sumL = 0;
  for (const [code, o] of Object.entries(loads ?? {})) { const m = ei.toOsm.get(code); if (!m) continue; const i = pos.get(m.id); if (i == null || comp[i] !== best) continue;
    const mw = (winter ? o.w : o.s) ?? o.w ?? o.s ?? 0; L[i] += mw; sumL += mw; }
  if (sumL <= 0) return null;
  const demand = gen?.consumptionMw > 0 ? gen.consumptionMw : 0.6 * sumL, k = demand / sumL;
  for (let i = 0; i < N; i++) L[i] *= k;
  // geração
  const byType = { ...(gen?.byType ?? {}) }, imp = Math.max(0, gen?.importMw ?? 0);
  const plants = grid.plants.filter((p) => p.to && pos.has(p.to) && comp[pos.get(p.to)] === best);
  const ptPlants = plants.filter((p) => p.pt !== false), esPlants = plants.filter((p) => p.pt === false);
  const wOf = (p) => (p.mw ?? 2) * availability(p, scenario);
  const totals = {};
  if (!Object.keys(byType).length) { for (const p of ptPlants) { const t = BUCKET[p.src] ?? "other_thermal"; totals[t] = (totals[t] ?? 0) + 0.3 * wOf(p); } }
  else for (const [t, v] of Object.entries(byType)) totals[t] = v;
  // cenário sem vento/solar: o que falta é coberto por hídrica/gás (potência instalada disponível)
  let removed = 0;
  if ((scenario.solar ?? 1) === 0 && totals.solar) { removed += totals.solar; totals.solar = 0; }
  if ((scenario.windGustKmh ?? 0) >= 95 && totals.wind) { removed += totals.wind; totals.wind = 0; }
  if (removed > 0) { const cap = {}; let capSum = 0; for (const t of DISPATCH) { cap[t] = ptPlants.filter((p) => BUCKET[p.src] === t).reduce((s, p) => s + wOf(p), 0); capSum += cap[t]; }
    for (const t of DISPATCH) if (capSum > 0) totals[t] = (totals[t] ?? 0) + removed * cap[t] / capSum; }
  const G = new Float64Array(N), out = new Map(); let sumG = 0;
  for (const t of Object.keys(totals)) { const grp = ptPlants.filter((p) => (BUCKET[p.src] ?? "other_thermal") === t); const ws = grp.reduce((s, p) => s + wOf(p), 0); if (ws <= 0 || !(totals[t] > 0)) continue;
    for (const p of grp) { const o = totals[t] * wOf(p) / ws; if (o > 0) { out.set(p.id, o); G[pos.get(p.to)] += o; sumG += o; } } }
  const wEs = esPlants.reduce((s, p) => s + wOf(p), 0);
  if (imp > 0 && wEs > 0) for (const p of esPlants) { const o = imp * wOf(p) / wEs; out.set(p.id, o); G[pos.get(p.to)] += o; sumG += o; }
  if (sumG <= 0) return null;
  const f = sumL / sumG; for (const [id, o] of out) out.set(id, o * f); for (let i = 0; i < N; i++) G[i] *= f;
  // fluxo DC: B θ = P (θ_slack = 0) por gradiente conjugado com pré-condicionador diagonal
  const P = new Float64Array(N); let slack = 0; for (let i = 0; i < N; i++) { P[i] = G[i] - L[i]; if (comp[i] === best && G[i] > G[slack]) slack = i; }
  const diag = new Float64Array(N); for (let i = 0; i < N; i++) for (const [, b] of adj[i]) diag[i] += b;
  const mul = (x, y) => { for (let i = 0; i < N; i++) { if (comp[i] !== best || i === slack) { y[i] = 0; continue; } let s = diag[i] * x[i]; for (const [j, b] of adj[i]) if (j !== slack) s -= b * x[j]; y[i] = s; } };
  const th = new Float64Array(N), r = new Float64Array(N), z = new Float64Array(N), p = new Float64Array(N), Ap = new Float64Array(N);
  for (let i = 0; i < N; i++) r[i] = comp[i] === best && i !== slack ? P[i] : 0;
  for (let i = 0; i < N; i++) { z[i] = diag[i] > 0 ? r[i] / diag[i] : 0; p[i] = z[i]; }
  let rz = 0; for (let i = 0; i < N; i++) rz += r[i] * z[i];
  const tol = 1e-9 * Math.max(1, rz);
  for (let it = 0; it < (opts.maxIter ?? 4000) && rz > tol; it++) { mul(p, Ap); let pAp = 0; for (let i = 0; i < N; i++) pAp += p[i] * Ap[i]; if (pAp <= 0) break;
    const al = rz / pAp; for (let i = 0; i < N; i++) { th[i] += al * p[i]; r[i] -= al * Ap[i]; z[i] = diag[i] > 0 ? r[i] / diag[i] : 0; }
    let rz2 = 0; for (let i = 0; i < N; i++) rz2 += r[i] * z[i]; const be = rz2 / rz; rz = rz2; for (let i = 0; i < N; i++) p[i] = z[i] + be * p[i]; }
  // fluxos nas arestas (MW) e energia que atravessa cada nó
  const inflow = Array.from({ length: N }, () => []); const thr = new Float64Array(N);
  for (let i = 0; i < N; i++) thr[i] = G[i];
  grid.edges.forEach((e, k) => { const a = pos.get(e.a), b = pos.get(e.b); if (a == null || b == null || comp[a] !== best) return;
    const x = Math.max(0.2, e.km) * XKM(e.v || 60000), fl = (th[a] - th[b]) / x; if (Math.abs(fl) < 1e-6) return;
    const [from, to] = fl > 0 ? [a, b] : [b, a], q = Math.abs(fl); inflow[to].push([from, q, k]); thr[to] += q; });
  const plantsAt = new Map(); for (const pl of plants) { if (!out.has(pl.id)) continue; const i = pos.get(pl.to); (plantsAt.get(i) ?? plantsAt.set(i, []).get(i)).push(pl); }
  const memo = new Map();
  const composition = (n, stack = new Set()) => { // MW de cada central que passa pelo nó n
    if (memo.has(n)) return memo.get(n); if (stack.has(n)) return new Map(); stack.add(n);
    const m = new Map(); for (const pl of plantsAt.get(n) ?? []) m.set(pl.id, (m.get(pl.id) ?? 0) + out.get(pl.id));
    for (const [j, q] of inflow[n]) { const cj = composition(j, stack), tj = thr[j] || 1; for (const [id, mw] of cj) m.set(id, (m.get(id) ?? 0) + q * mw / tj); }
    stack.delete(n); memo.set(n, m); return m; };
  return { pos, nodes, plants, out, inflow, thr, L, G, th, composition, demandMw: demand, loadScale: k, genScale: f, winter, best, comp, grid,
    dominantPath(target, plantId) { // do nó-alvo para montante, o ramo que mais energia daquela central transporta
      const edges = []; let n = target; const seen = new Set([n]); const home = plants.find((p) => p.id === plantId); const homeI = home ? pos.get(home.to) : -1;
      while (n !== homeI && edges.length < 400) { let bestE = null, bv = 0; for (const [j, q, k] of inflow[n]) { if (seen.has(j)) continue; const v = q * (composition(j).get(plantId) ?? 0) / (thr[j] || 1); if (v > bv) { bv = v; bestE = [j, k]; } }
        if (!bestE) break; edges.push(bestE[1]); n = bestE[0]; seen.add(n); }
      return { edges, reached: n === homeI }; } };
}

// Repartição da energia que chega ao nó OSM `entryId`: lista de centrais ordenada pelo MW que lhe chega.
export function flowSources(model, entryId, top = 8) {
  if (!model) return null; const i = model.pos.get(entryId); if (i == null || model.comp[i] !== model.best) return null;
  const comp = model.composition(i), total = [...comp.values()].reduce((s, v) => s + v, 0); if (total <= 0) return null;
  const load = model.L[i];  // as percentagens vêm da composição do que passa pelo nó; os MW aplicam-se à carga da subestação
  const byId = new Map(model.plants.map((p) => [p.id, p]));
  const rows = [...comp.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([id, mw]) => {
    const p = byId.get(id), path = model.dominantPath(i, id), km = path.edges.reduce((s, k) => s + (model.grid.edges[k]?.km ?? 0), 0);
    return { id, name: p.name ?? `(sem nome) ${p.src}`, src: p.src, mw: +(p.mw ?? 0).toFixed(1), mwEstimated: p.mw == null, lat: p.lat, lon: p.lon, via: p.to, connKm: p.dkm,
      pathKm: +km.toFixed(1), edgeIdx: path.edges, pathComplete: path.reached, flowMw: +(load * mw / total).toFixed(2), share: +(100 * mw / total).toFixed(1), outputMw: +model.out.get(id).toFixed(1),
      available: !(p.status === "closed" || p.status === "reserve"), status: p.status, statusNote: p.statusNote, pt: p.pt !== false }; });
  const mix = {}; for (const [id, mw] of comp) { const p = byId.get(id); const k = p.pt === false ? "importação" : p.src; mix[k] = (mix[k] ?? 0) + mw; }
  const mixPct = Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, +(100 * v / total).toFixed(1)]).sort((a, b) => b[1] - a[1]));
  return { sources: rows, mix: mixPct, entryLoadMw: +load.toFixed(1), demandMw: Math.round(model.demandMw), basis: "rastreio de fluxo (DC) com dados abertos; não é o fluxo real" };
}
