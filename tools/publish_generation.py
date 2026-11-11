#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Vai buscar a geração da REN e publica-a no KV do Cloudflare (de onde o Worker a serve).
Corre numa rede que a REN aceite (a REN dá timeout a pedidos vindos do Cloudflare): um agendador fora do Cloudflare (cron, CI).
Só stdlib. Variáveis: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, KV_NAMESPACE_ID (a conta e o namespace KV que o Worker lê; o token nunca vai no repo).
Enviar Accept: */* (application/json pendura a REN; sem Accept corta o corpo). A REN devolve JSON com content-type text/plain.
"""
import json, os, sys, time, datetime, http.client, urllib.request, urllib.error

REN = "https://servicebus.ren.pt/datahubapi/electricity"
NS = os.environ.get("KV_NAMESPACE_ID")
TYPES = {"Hydro": "hydro", "Wind": "wind", "Solar": "solar", "Natural Gas": "gas", "Biomass": "biomass",
         "Other Thermal": "other_thermal", "Coal": "coal", "Wave": "wave"}
INST = {"HYDRO": "hydro", "WIND": "wind", "SOLAR": "solar", "NATURAL_GAS": "gas", "BIOMASS": "biomass",
        "OTHER_THERMAL": "other_thermal", "COAL": "coal"}


def ren(path):
    req = urllib.request.Request(f"{REN}/{path}", headers={"User-Agent": "de-onde-vem-a-luz (open-source)", "Accept": "*/*"})  # a REN só responde bem com Accept: */* (application/json pendura; sem Accept corta o corpo)
    for attempt in range(4):  # a REN corta por vezes a ligação a meio da resposta: repetir
        try:
            return json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:  # dia ainda não fechado
                return None
            err = e
        except (urllib.error.URLError, http.client.HTTPException, ValueError, TimeoutError, ConnectionError) as e:
            err = e
        print(f"REN {path.split('?')[0]} (tentativa {attempt + 1}): {err}", file=sys.stderr)
        time.sleep(2 * (attempt + 1))
    return None


def generation():
    now = datetime.datetime.now(datetime.timezone.utc)
    prod = date = None
    for back in range(4):  # hoje costuma dar 404: recua até haver um dia fechado
        date = (now - datetime.timedelta(days=back)).strftime("%Y-%m-%d")
        prod = ren(f"ElectricityProductionBreakdownDaily?culture=en-US&date={date}")
        if prod and prod.get("series"):
            break
    if not prod or not prod.get("series"):
        return None
    cats = prod["xAxis"]["categories"]
    S = {s["name"]: s["data"] for s in prod["series"]}
    last = max(max((i for i, v in enumerate(a) if v is not None), default=-1) for a in S.values())
    by_type = {t: round(S[k][last] or 0) for k, t in TYPES.items() if k in S}
    installed = {}
    for r in ren(f"ElectricityInstalledPowerMonthly?culture=en-US&year={date[:4]}") or []:
        if r.get("type") in INST and r.get("monthly_Accumulation"):
            installed[INST[r["type"]]] = r["monthly_Accumulation"]
    as_of = f"{date}T{cats[last]}"
    stale = round((now - datetime.datetime.fromisoformat(as_of + ":00+00:00")).total_seconds() / 3600)
    out = {"available": True, "source": "REN DataHub (provisório, telecontagem)", "asOf": as_of, "staleHours": stale,
           "byType": by_type, "consumptionMw": round((S.get("Consumption") or [0])[last] or 0),
           "importMw": round((S.get("Import") or [0])[last] or 0), "installed": installed,
           "publishedAt": now.isoformat().replace("+00:00", "Z")}
    if stale > 3:
        out["note"] = "A API diária da REN só fecha os dias no seguinte: este é o último ponto publicado, não o instante actual."
    return out


def main():
    g = generation()
    if not g:
        print("REN sem dados", file=sys.stderr); return 2
    token, acct = os.environ.get("CLOUDFLARE_API_TOKEN"), os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if "--dry-run" in sys.argv or not (token and acct and NS):
        print(json.dumps(g)[:300]); return 0 if "--dry-run" in sys.argv else 3
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{acct}/storage/kv/namespaces/{NS}/values/pt?expiration_ttl=259200",
        data=json.dumps(g).encode(), method="PUT", headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=30).read())
    except urllib.error.HTTPError as e:
        print(f"Cloudflare KV: HTTP {e.code}", file=sys.stderr); return 1
    print(f"publicado: {g['asOf']} (hídrica {g['byType'].get('hydro')} MW, eólica {g['byType'].get('wind')} MW, solar {g['byType'].get('solar')} MW)" if r.get("success") else f"falhou: {r.get('errors')}")
    return 0 if r.get("success") else 1


if __name__ == "__main__":
    sys.exit(main())
