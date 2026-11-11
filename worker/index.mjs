// SPDX-License-Identifier: AGPL-3.0-or-later
// Worker «geração agora». Só dados GLOBAIS (nunca moradas nem coordenadas): REN DataHub (sem chave) e,
// se houver `ENTSOE_TOKEN` (secret do Cloudflare, nunca no repo), ENTSO-E por unidade.
// A REN não envia CORS e o endpoint diário só tem dias fechados: o Worker junta cache + CORS + «último ponto».
const REN = "https://servicebus.ren.pt/datahubapi/electricity";
const TYPES = { Hydro: "hydro", Wind: "wind", Solar: "solar", "Natural Gas": "gas", Biomass: "biomass", "Other Thermal": "other_thermal", Coal: "coal", Wave: "wave" };
const INST = { HYDRO: "hydro", WIND: "wind", SOLAR: "solar", NATURAL_GAS: "gas", BIOMASS: "biomass", OTHER_THERMAL: "other_thermal", COAL: "coal" };
const mem = new Map();
const CORS = { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS } });
const day = (d) => d.toISOString().slice(0, 10);

let renDiag = "";
async function ren(path) {
  try {
    const r = await fetch(`${REN}/${path}`, { headers: { "user-agent": "de-onde-vem-a-luz (open-source)" }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) { renDiag = `HTTP ${r.status}`; return null; }
    const txt = await r.text();  // a REN devolve JSON com content-type text/plain
    try { return JSON.parse(txt); } catch { renDiag = `resposta não JSON (${txt.slice(0, 40)})`; return null; }
  } catch (e) { renDiag = `erro de rede: ${String(e).slice(0, 80)}`; return null; }
}

export async function generationPT(now = new Date()) {
  let prod = null, date = null;
  for (let back = 0; back < 3 && !prod?.series; back++) {  // hoje costuma dar 404: recua até haver dia fechado
    const d = new Date(now.getTime() - back * 864e5); date = day(d);
    prod = await ren(`ElectricityProductionBreakdownDaily?culture=en-US&date=${date}`);
    if (!prod && renDiag.startsWith("erro de rede")) break;  // REN lenta/inacessível: não esperar mais
  }
  if (!prod?.series) return { available: false, reason: "REN sem dados nos últimos dias", detail: renDiag || undefined };
  const cats = prod.xAxis.categories, S = Object.fromEntries(prod.series.map((s) => [s.name, s.data]));
  const last = Math.max(...Object.values(S).map((a) => a.reduce((m, v, i) => (v != null ? i : m), -1)));
  const byType = {};
  for (const [k, t] of Object.entries(TYPES)) if (S[k]) byType[t] = Math.round(S[k][last] ?? 0);
  const inst = await ren(`ElectricityInstalledPowerMonthly?culture=en-US&year=${date.slice(0, 4)}`);
  const installed = {};
  for (const r of inst ?? []) if (INST[r.type] && r.monthly_Accumulation) installed[INST[r.type]] = r.monthly_Accumulation;
  const asOf = `${date}T${cats[last]}`;
  const staleHours = Math.round((now.getTime() - Date.parse(asOf + ":00Z")) / 36e5);
  return { available: true, source: "REN DataHub (provisório, telecontagem)", asOf, staleHours, byType,
    consumptionMw: Math.round(S["Consumption"]?.[last] ?? 0), importMw: Math.round(S["Import"]?.[last] ?? 0), installed,
    note: staleHours > 3 ? "A API diária da REN só fecha os dias no seguinte: este é o último ponto publicado, não o instante actual." : undefined };
}

async function cached(key, ttlMs, fn) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn(); if (v?.available !== false) mem.set(key, { t: Date.now(), v }); return v;
}

// Cron Trigger (de 30 em 30 min): vai à REN e guarda no KV; o pedido dos visitantes só lê o KV
async function refresh(env) {
  const g = await generationPT();
  if (g.available && env.GERACAO) await env.GERACAO.put("pt", JSON.stringify({ ...g, publishedAt: new Date().toISOString() }), { expirationTtl: 259200 });
  return g;
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(refresh(env)); },
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (url.pathname === "/api/v1/generation/pt") {
      // 1.º o valor publicado por um job fora do Cloudflare (a REN não responde a partir daqui); 2.º tentativa directa à REN
      try {
        const kv = env.GERACAO && !url.searchParams.has("live") ? await env.GERACAO.get("pt", "json") : null;  // ?live=1 ignora a cache (diagnóstico)
        if (kv?.available) { const idadeH = Math.round((Date.now() - Date.parse(kv.publishedAt ?? 0)) / 36e5);
          if (idadeH < 72) return json({ ...kv, viaCache: true, cacheHours: idadeH }); }
      } catch { /* KV indisponível: tenta a REN */ }
      try { return json(await cached("pt", 600e3, () => generationPT())); }
      catch (e) { return json({ available: false, reason: "falha ao obter a geração", detail: String(e).slice(0, 120) }); }
    }
    if (url.pathname === "/api/v1/generation/units") {
      // produção real por central (ENTSO-E A73), publicada no KV por um job fora do Cloudflare; o token nunca chega ao Worker
      try {
        const kv = env.GERACAO ? await env.GERACAO.get("units", "json") : null;
        if (kv?.available) return json(kv);
      } catch { /* KV indisponível */ }
      return json({ available: false, reason: "Produção real por central ainda não publicada." });
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("static assets only in Workers", { status: 404 });
  },
};
