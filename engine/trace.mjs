// SPDX-License-Identifier: AGPL-3.0-or-later
// Motor de traçado: ponto (lat,lon) -> subestação de entrada -> linhas >= 60 kV -> centrais prováveis.
// Zero dependências; corre igual no navegador, no Node e num Worker. Recebe o grafo (data/grid.json).
//
// HONESTIDADE: é um MODELO de melhor esforço. A rede real é malhada e a energia flui por leis
// físicas, não por "um caminho". O resultado diz "as centrais e linhas que mais provavelmente
// contribuem", nunca "a tua energia vem daqui". A MT/BT da rua só o operador conhece.

const R = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
export function haversine(a, b) {
  const dLa = rad(b[0] - a[0]), dLo = rad(b[1] - a[1]);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Potência típica (MW) quando o OSM não a indica — marcada como `estimada` no resultado.
const DEFAULT_MW = { wind: 20, hydro: 5, solar: 2, gas: 20, biomass: 8, biogas: 2, waste: 10, battery: 1, "?": 2 };

// Cenários: o que conta em cada situação. Rajada em km/h no local da central.
export const SCENARIOS = {
  normal: { solar: 1, windGustKmh: 0 },
  tempestade: { solar: 0, windGustKmh: 110 }, // sem sol, eólica cortada por vento forte
};
export function availability(plant, scenario) {
  if (plant.status === "closed" || plant.status === "reserve") return 0;  // encerrada ou só em reserva: não conta como fornecedora
  if (plant.src === "solar") return scenario.solar ?? 1;
  if (plant.src === "wind") {
    const g = scenario.windGustKmh ?? 0;
    return g >= 95 ? 0 : 1; // aerogeradores desligam ~90–100 km/h
  }
  return 1;
}

const edgeCost = (e) => e.km * (e.v >= 220000 ? 0.6 : e.v >= 150000 ? 0.8 : 1);
const isDistribution = (n) => n.k === "sub" && /(^|;)(15000|20000|30000)(;|$)/.test(n.volts || "") && n.v >= 60000;

export function buildIndex(grid, statusRules = []) {
  // estado operacional curado à mão (data/plant_status.json): nenhum dado aberto diz que centrais estão encerradas
  for (const p of grid.plants) {
    const rule = statusRules.find((r) => new RegExp(r.match, "i").test(p.name ?? ""));
    if (rule) { p.status = rule.status; p.statusNote = rule.note; p.statusNotes = rule.notes; }
  }
  const nodes = new Map(grid.nodes.map((n) => [n.id, n]));
  const adj = new Map();
  grid.edges.forEach((e, i) => {
    for (const [a, b] of [[e.a, e.b], [e.b, e.a]]) {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push({ to: b, e, i });
    }
  });
  return { grid, nodes, adj };
}

function dijkstra(idx, start) {
  const dist = new Map([[start, 0]]), prev = new Map(), done = new Set();
  // fila de prioridade simples (a malha tem centenas de nós)
  const q = [[0, start]];
  while (q.length) {
    q.sort((x, y) => x[0] - y[0]);
    const [d, u] = q.shift();
    if (done.has(u)) continue;
    done.add(u);
    for (const { to, e, i } of idx.adj.get(u) ?? []) {
      const nd = d + edgeCost(e);
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        prev.set(to, { from: u, i });
        q.push([nd, to]);
      }
    }
  }
  return { dist, prev };
}

export function trace(idx, point, opts = {}) {
  const scenario = opts.scenario ?? SCENARIOS.normal;
  const top = opts.top ?? 8;
  const here = [point.lat, point.lon];
  const notes = [];

  // 1. subestação de entrada = a mais próxima do tipo AT/MT (a "porta" da distribuição)
  const subs = idx.grid.nodes.filter((n) => n.k === "sub");
  const withDist = subs.map((n) => ({ n, d: haversine(here, [n.lat, n.lon]) })).sort((a, b) => a.d - b.d);
  const dist = withDist.filter((x) => isDistribution(x.n));
  const forced = opts._forceStart ? withDist.find((x) => x.n.id === opts._forceStart) ?? { n: idx.nodes.get(opts._forceStart), d: haversine(here, [idx.nodes.get(opts._forceStart).lat, idx.nodes.get(opts._forceStart).lon]) } : null;
  const entry = forced ?? (dist[0] ?? withDist[0]);
  if (!entry) return { error: "sem subestações nos dados desta zona" };
  if (entry.d > 12) notes.push(`A subestação AT/MT mais próxima nos dados está a ${entry.d.toFixed(1)} km: fora da zona coberta ou mal mapeada.`);
  const alternatives = dist.slice(1, 4).map((x) => ({ id: x.n.id, name: x.n.name, km: +x.d.toFixed(2) }));

  // 2. caminhos mínimos a partir da entrada
  const { dist: D, prev } = dijkstra(idx, entry.n.id);
  const entryDegree = (idx.adj.get(entry.n.id) ?? []).length;
  if (entryDegree === 0) notes.push("A subestação de entrada não tem linhas ≥ 60 kV mapeadas ligadas (dados incompletos).");
  if (entryDegree === 1) notes.push("Só uma linha ≥ 60 kV mapeada chega à subestação: possível ponto único de falha (se o OSM estiver completo).");

  // 3. centrais alcançáveis, com peso indicativo
  const cand = [];
  for (const p of idx.grid.plants) {
    if (!p.to || !D.has(p.to)) continue;
    const mwEst = p.mw == null;
    const mw = p.mw ?? DEFAULT_MW[p.src] ?? 2;
    const cost = D.get(p.to) + (p.dkm ?? 0);
    const av = availability(p, scenario);
    const raw = mw * Math.exp(-cost / 60);
    cand.push({ p, cost, mw, mwEst, av, w: raw * av, wNormal: raw });
  }
  const totalW = cand.reduce((s, c) => s + c.w, 0) || 1;
  const totalNormal = cand.reduce((s, c) => s + c.wNormal, 0) || 1;
  cand.sort((a, b) => b.w - a.w);

  const pathTo = (nodeId) => {
    const ids = [];
    for (let cur = nodeId; prev.has(cur); cur = prev.get(cur).from) ids.push(prev.get(cur).i);
    return ids.reverse();
  };
  const sources = cand.slice(0, top).map((c) => ({
    id: c.p.id, name: c.p.name ?? `(sem nome) ${c.p.src}`, src: c.p.src, mw: +c.mw.toFixed(1), mwEstimated: c.mwEst,
    lat: c.p.lat, lon: c.p.lon, via: c.p.to, connKm: c.p.dkm, pathKm: +c.cost.toFixed(1),
    share: +((100 * c.w) / totalW).toFixed(1), shareNormal: +((100 * c.wNormal) / totalNormal).toFixed(1),
    available: c.av > 0, status: c.p.status, statusNote: c.p.statusNote, statusNotes: c.p.statusNotes, edgeIdx: pathTo(c.p.to),
  }));

  // 4. por tipo de fonte (a "mistura" provável vista deste ponto)
  const mix = {};
  for (const c of cand) mix[c.p.src] = (mix[c.p.src] ?? 0) + c.w;
  const mixPct = Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, +((100 * v) / totalW).toFixed(1)]).sort((a, b) => b[1] - a[1]));

  return {
    scenario, notes,
    entry: { id: entry.n.id, name: entry.n.name, volts: entry.n.volts, km: +entry.d.toFixed(2), lat: entry.n.lat, lon: entry.n.lon, hvLines: entryDegree },
    alternatives, sources, mix: mixPct,
    reachablePlants: cand.length,
    disclaimer: "Modelo de melhor esforço sobre dados OpenStreetMap. Não é a topologia real nem o fluxo real de energia.",
  };
}

// Geometrias das linhas destacadas (GeoJSON) a partir dos índices das arestas.
// Um extremo de linha pode ficar até 450 m da subestação a que se liga (OSM); se o troço passar pela subestação e continuar,
// o desenho faz um «gancho» de volta (o X que se via no mapa). Corta o final no ponto mais próximo da subestação.
const MAXTAIL_KM = 0.6;
function clipEnd(g, node) {
  if (!node || g.length < 2) return g;
  const kx = 111.32 * Math.cos(rad(node.lat)), ky = 110.57, X = (p) => [(p[1] - node.lon) * kx, (p[0] - node.lat) * ky];
  let tail = 0, best = null;
  for (let k = g.length - 2; k >= 0; k--) {
    const a = X(g[k]), b = X(g[k + 1]), dx = b[0] - a[0], dy = b[1] - a[1], n2 = dx * dx + dy * dy;
    const t = n2 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / n2)) : 0, d = Math.hypot(a[0] + t * dx, a[1] + t * dy);
    if (!best || d < best.d - 1e-9) best = { k, t, d, tail: tail + (1 - t) * Math.hypot(dx, dy) };
    tail += Math.hypot(dx, dy); if (tail > MAXTAIL_KM) break;
  }
  if (!best || (best.k === g.length - 2 && best.t >= 0.999) || best.tail > MAXTAIL_KM) return g;
  if (best.t <= 0.001) return g.slice(0, best.k + 1);
  const A = g[best.k], B = g[best.k + 1], pt = [A[0] + (B[0] - A[0]) * best.t, A[1] + (B[1] - A[1]) * best.t];
  return [...g.slice(0, best.k + 1), pt];
}
export function clipEdgeGeometry(idx, e) {
  let g = e.g;
  const na = idx.nodes.get(e.a), nb = idx.nodes.get(e.b);
  if (nb?.k === "sub") g = clipEnd(g, nb);
  if (na?.k === "sub") g = clipEnd([...g].reverse(), na).reverse();
  return g;
}
export function pathsGeoJSON(idx, result) {
  const used = new Set(result.sources.flatMap((s) => s.edgeIdx));
  return {
    type: "FeatureCollection",
    features: [...used].map((i) => {
      const e = idx.grid.edges[i];
      return { type: "Feature", properties: { v: e.v, km: e.km, op: e.op }, geometry: { type: "LineString", coordinates: clipEdgeGeometry(idx, e).map(([la, lo]) => [lo, la]) } };
    }),
  };
}

// ───────────── Camada E-REDES (morada → alimentador MT mais próximo → subestação AT/MT → nó RNT → OSM) ─────────────
// Dados: E-REDES, open data (snapshot manual, ver data/eredes.json `meta`). Atribuição: «Dados: E-REDES».
const norm = (s) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
  .replace(/\b(SUBESTACAO|SUBESTACION|SE|POSTO DE CORTE|PC)\b/g, "").replace(/\b(DE|DO|DA|DOS|DAS)\b/g, "").replace(/[^A-Z0-9]+/g, " ").trim();

// distância (km) de um ponto a um segmento, em projecção equirectangular local (suficiente a esta escala)
function distSeg(p, a, b) {
  const kx = 111.32 * Math.cos(rad(p[0])), ky = 110.57;
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
  const dx = bx - ax, dy = by - ay, n2 = dx * dx + dy * dy;
  const t = n2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / n2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function buildEreIndex(ere, idx) {
  const subs = new Map(ere.subs.map((s) => [s.code, s]));
  // casar cada subestação E-REDES a um nó OSM: nome igual e < 3 km; senão o nó OSM ≥ 60 kV mais próximo a < 1,2 km
  const osmSubs = idx.grid.nodes.filter((n) => n.k === "sub");
  const byName = new Map();
  for (const n of osmSubs) { const k = norm(n.name); if (k) (byName.get(k) ?? byName.set(k, []).get(k)).push(n); }
  const toOsm = new Map();
  for (const s of ere.subs) {
    const here = [s.lat, s.lon];
    let best = (byName.get(norm(s.name)) ?? []).map((n) => ({ n, d: haversine(here, [n.lat, n.lon]) })).filter((x) => x.d < 3).sort((a, b) => a.d - b.d)[0];
    let how = "nome";
    if (!best) { best = osmSubs.map((n) => ({ n, d: haversine(here, [n.lat, n.lon]) })).filter((x) => x.d < 1.2 && x.n.v >= 60000).sort((a, b) => a.d - b.d)[0]; how = "proximidade"; }
    if (best) toOsm.set(s.code, { id: best.n.id, d: best.d, how });
  }
  // nó RNT (REN) pelo nome, ex.: «Riba de Ave» → «Subestação de Riba d'Ave»
  // «Riba de Ave» (E-REDES) = «Riba d'Ave» (OSM): comparar sem artigos nem o «d» solto
  const nrnt = (x) => norm(x).replace(/\bD\b/g, "").replace(/\s+/g, " ").trim();
  // abreviaturas da E-REDES («R. Maior», «V. Fria», «Vila P. Aguiar»): cada «letra» tem de ser a inicial da palavra do nome OSM, na mesma ordem
  const abbrMatch = (k, cand) => { const kt = k.split(" "), ct = cand.split(" "); let j = 0;
    for (const t of kt) { while (j < ct.length && !(t.length === 1 ? ct[j].startsWith(t) : ct[j] === t || ct[j].startsWith(t))) j++; if (j >= ct.length) return false; j++; }
    return true; };
  const rntNode = (name) => { const k = nrnt(name); if (!k) return undefined; const hi = osmSubs.filter((n) => n.v >= 150000).sort((a, b) => b.v - a.v);
    return hi.find((n) => nrnt(n.name).includes(k)) ?? (/\b[A-Z]\b/.test(k) ? hi.find((n) => abbrMatch(k, nrnt(n.name))) : undefined); };
  return { ere, subs, toOsm, rntNode };
}

export function nearestFeeders(ei, point, n = 3) {
  const p = [point.lat, point.lon], bySub = new Map();
  for (const f of ei.ere.feeders) {
    let m = Infinity;
    for (const part of f.g) for (let i = 0; i < part.length - 1; i++) { const d = distSeg(p, part[i], part[i + 1]); if (d < m) m = d; }
    const sub = f.sub ?? f.s;  // eredes.json usa `sub`; os tiles usam `s`
    if (m < (bySub.get(sub)?.km ?? Infinity)) bySub.set(sub, { sub, km: m, kv: f.kv });
  }
  return [...bySub.values()].sort((a, b) => a.km - b.km).slice(0, n);
}

// Traçado com a camada E-REDES: a entrada é a subestação a montante do alimentador mais próximo.
export function traceEre(idx, ei, point, opts = {}) {
  const feeders = nearestFeeders(ei, point, 3);
  const f = feeders[0];
  const s = f && ei.subs.get(f.sub);
  if (!s) return { ...trace(idx, point, opts), source: "osm-only" };
  const link = ei.toOsm.get(s.code);
  const rnt = ei.rntNode(s.rnt);
  const startId = link?.id ?? rnt?.id;
  const notes = [];
  if (!link) notes.push(`A subestação ${s.name} não foi encontrada no OSM; o traçado parte do nó RNT «${s.rnt}».`);
  if (f.km > 1) notes.push(`O alimentador MT mais próximo está a ${f.km.toFixed(2)} km: confirma que o ponto está numa zona coberta.`);
  const base = trace({ ...idx, grid: { ...idx.grid } }, point, { ...opts, _forceStart: startId });
  return { ...base, source: "e-redes+osm", eredes: { code: s.code, name: s.name, tipo: s.tipo, rnt: s.rnt, group: s.group, capAtMva: s.cap_at, capMtAtMva: s.cap_mtat, feederKm: +f.km.toFixed(3), feederKv: f.kv, osmMatch: link ? `${link.how} (${link.d.toFixed(2)} km)` : null, others: feeders.slice(1).map((x) => ({ code: x.sub, name: ei.subs.get(x.sub)?.name, km: +x.km.toFixed(2) })) }, notes: [...notes, ...base.notes] };
}

// ───────────── Última milha: postos de transformação (MT/BT) mais próximos ─────────────
// Dados: E-REDES `postos-transformacao-distribuicao` (CC BY 4.0). p = [lat, lon, código, kVA, utilização, clientes, tipo]
export function nearestPostos(postos, point, n = 3, maxKm = 0.6) {
  const here = [point.lat, point.lon];
  return postos.map((p) => ({ code: p[2], kva: p[3], use: p[4], clients: p[5], kind: p[6], lat: p[0], lon: p[1], km: +haversine(here, [p[0], p[1]]).toFixed(3) }))
    .filter((p) => p.km <= maxKm).sort((a, b) => a.km - b.km).slice(0, n);
}

// ───────────── Geração agora (REN, por tipo) → estimativa por central ─────────────
// gen = { asOf, byType: {hydro, wind, solar, gas, biomass...} (MW), installed: {...} (MW) }.
// Estimativa honesta: factor de carga NACIONAL do tipo × potência da central. Não é a medição da central.
export function withGeneration(result, gen) {
  if (!gen?.byType || !gen?.installed) return { ...result, generation: null };
  const sources = result.sources.map((s) => {
    const out = gen.byType[s.src], inst = gen.installed[s.src];
    if (out == null || !inst) return { ...s, now: null };
    const factor = Math.max(0, Math.min(1, out / inst));
    return { ...s, now: { factor: +factor.toFixed(3), estMw: +(s.mw * factor).toFixed(1), basis: "factor de carga nacional do tipo (REN)" } };
  });
  return { ...result, sources, generation: { asOf: gen.asOf, source: gen.source, byType: gen.byType, installed: gen.installed, consumptionMw: gen.consumptionMw, importMw: gen.importMw } };
}

// ───────────── Caminho ÚNICO no alimentador MT (do ponto de ligação até à subestação) ─────────────
// O alimentador é uma árvore de linhas; só queremos o ramo que liga o ponto à subestação (não a rede toda).
// Liga os vértices (~11 m) e junta extremos a < 25 m (troços subterrâneos em falta); Dijkstra.
export function feederPath(feeders, subCode, fromPt, toPt) {
  const key = (la, lo) => `${Math.round(la * 1e4)}_${Math.round(lo * 8e3)}`;
  const nodes = new Map(), adj = new Map();
  const node = (la, lo) => { const k = key(la, lo); if (!nodes.has(k)) { nodes.set(k, [la, lo]); adj.set(k, []); } return k; };
  const ends = [];
  const link = (a, b) => { if (a === b) return; const w = haversine(nodes.get(a), nodes.get(b)); adj.get(a).push([b, w]); adj.get(b).push([a, w]); };
  for (const f of feeders) {
    if ((f.sub ?? f.s) !== subCode) continue;
    for (const part of f.g) {
      let prev = null;
      part.forEach(([la, lo], i) => { const k = node(la, lo); if (prev) link(prev, k); prev = k; if (i === 0 || i === part.length - 1) ends.push(k); });
    }
  }
  if (!nodes.size) return null;
  const E = [...new Set(ends)];  // juntar extremos próximos
  for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) if (haversine(nodes.get(E[i]), nodes.get(E[j])) < 0.025) link(E[i], E[j]);
  const nearest = (p) => { let b = null, d = Infinity; for (const [k, v] of nodes) { const x = haversine(p, v); if (x < d) { d = x; b = k; } } return { k: b, d }; };
  const s = nearest(fromPt), t = nearest(toPt);
  const dist = new Map([[s.k, 0]]), prev = new Map(), done = new Set(), q = [[0, s.k]];
  while (q.length) {
    q.sort((a, b) => a[0] - b[0]); const [d, u] = q.shift();
    if (done.has(u)) continue; done.add(u); if (u === t.k) break;
    for (const [v, w] of adj.get(u)) if (d + w < (dist.get(v) ?? Infinity)) { dist.set(v, d + w); prev.set(v, u); q.push([d + w, v]); }
  }
  if (!dist.has(t.k)) return { coords: null, joinKm: s.d, subKm: t.d, connected: false, start: nodes.get(s.k) };
  const path = []; for (let c = t.k; c != null; c = prev.get(c)) path.push(nodes.get(c));
  path.reverse();
  return { coords: path, km: +dist.get(t.k).toFixed(2), joinKm: +s.d.toFixed(3), subKm: +t.d.toFixed(3), connected: true, start: nodes.get(s.k) };
}

// ───────────── Apoios de baixa tensão mais próximos (E-REDES apoios-baixa-tensao) ─────────────
export function nearestPoles(poles, point, n = 8, maxKm = 0.25) {
  const here = [point.lat, point.lon];
  return poles.map((p) => ({ lat: p[0], lon: p[1], km: haversine(here, p) })).filter((p) => p.km <= maxKm).sort((a, b) => a.km - b.km).slice(0, n);
}

// ───────────── Caminho de baixa tensão pelos postes (casa ← postes ← posto de transformação) ─────────────
// Os apoios BT da E-REDES só têm posição. A ligação real segue a rua, de poste em poste: aqui liga-se cada poste aos vizinhos
// (vãos até `span` m, com penalização dos vãos grandes para preferir a fila densa de postes) e procura-se o melhor caminho
// do poste mais próximo da casa ao mais próximo do posto. Devolve {chain:[{lat,lon,km}], m, gaps} ou null.
export function polePath(all, from, to, o = {}) {
  if (!to || !all?.length) return null;
  const SPAN = o.span ?? 250, HOP = o.hop ?? 60;
  const kx = 111.32 * Math.cos(rad(from[0])) * 1000, ky = 110.57 * 1000;
  const X = (la, lo) => [(lo - from[1]) * kx, (la - from[0]) * ky];
  const A = [0, 0], B = X(to[0], to[1]), d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]), AB = d(A, B);
  const pts = [];
  for (const p of all) { const xy = X(p[0], p[1]); if (d(xy, A) + d(xy, B) <= AB * 1.6 + 150) pts.push({ lat: p[0], lon: p[1], xy }); }
  if (pts.length < 1) return null; if (pts.length > 2500) pts.length = 2500;
  const N = pts.length, S = N, E = N + 1, adj = Array.from({ length: N + 2 }, () => []);
  // custo convexo: dois saltos curtos custam menos que um comprido, por isso o caminho passa por todos os apoios que estão realmente na linha
  const w = (m) => m * (1 + m / (2 * HOP)) + (m > HOP ? (m - HOP) * 3 : 0);
  for (let i = 0; i < N; i++) {
    const di = d(pts[i].xy, A); if (di <= SPAN) adj[S].push([i, w(di), di]);
    const dj = d(pts[i].xy, B); if (dj <= SPAN) adj[i].push([E, w(dj), dj]);
    for (let j = i + 1; j < N; j++) { const m = d(pts[i].xy, pts[j].xy); if (m <= SPAN) { adj[i].push([j, w(m), m]); adj[j].push([i, w(m), m]); } }
  }
  const dist = new Array(N + 2).fill(Infinity), real = new Array(N + 2).fill(0), prev = new Array(N + 2).fill(-1), done = new Array(N + 2).fill(false); dist[S] = 0;
  for (let it = 0; it < N + 2; it++) {
    let u = -1, b = Infinity; for (let i = 0; i < N + 2; i++) if (!done[i] && dist[i] < b) { b = dist[i]; u = i; }
    if (u < 0 || u === E) break; done[u] = true;
    for (const [v, c, m] of adj[u]) if (dist[u] + c < dist[v]) { dist[v] = dist[u] + c; real[v] = real[u] + m; prev[v] = u; }
  }
  if (!isFinite(dist[E])) return null;
  const chain = []; for (let c = prev[E]; c !== S && c >= 0; c = prev[c]) chain.push({ lat: pts[c].lat, lon: pts[c].lon, km: d(pts[c].xy, A) / 1000 });
  chain.reverse();
  let gaps = 0, last = A; for (const c of chain) { const xy = X(c.lat, c.lon); if (d(last, xy) > HOP) gaps++; last = xy; }
  return chain.length ? { chain, m: Math.round(real[E]), gaps } : null;
}
