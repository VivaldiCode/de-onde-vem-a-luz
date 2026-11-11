#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Extrai de OpenStreetMap (Overpass) a rede >= 60 kV, subestações e centrais de Portugal continental, por blocos.

Uso: fetch_osm.py <pasta-saida>
Escreve <saida>/lines_<n>.json (linhas aéreas + cabos >= 60 kV com geometria) e nodes_<n>.json (subestações >= 60 kV,
centrais e aerogeradores). Em produção isto vem do Geofabrik (portugal-latest.osm.pbf + osmium), não do Overpass público.
Dados © OpenStreetMap contributors (ODbL).
"""
import sys, os, time, json, urllib.request, urllib.parse

UA = "de-onde-vem-a-luz/0.1 (+https://luz.guilhermepinto.pt)"
URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
V = '"voltage"~"(^|;)(6[0-9]{4}|[1-9][0-9]{5})(;|$)"'
# blocos (sul, oeste, norte, este) — Portugal continental
BLOCKS = [(40.9, -9.6, 42.2, -6.1), (39.6, -9.6, 40.9, -6.1), (38.3, -9.6, 39.6, -6.1), (37.0, -9.6, 38.3, -6.5)]

def post(q):
    for attempt in range(8):
        for u in URLS:
            try:
                r = urllib.request.Request(u, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": UA})
                return urllib.request.urlopen(r, timeout=200).read()
            except Exception as e:
                last = e
        time.sleep(10 * (attempt + 1))
    raise SystemExit(f"Overpass indisponível: {last}")

def main(out):
    os.makedirs(out, exist_ok=True)
    for n, (s, w, nn, e) in enumerate(BLOCKS):
        bb = f"({s},{w},{nn},{e})"
        jobs = {
            f"lines_{n}.json": f'[out:json][timeout:180];(way["power"~"^(line|cable)$"][{V}]{bb};);out geom tags;',
            f"nodes_{n}.json": f'[out:json][timeout:180];(nwr["power"="substation"][{V}]{bb};nwr["power"="plant"]{bb};nwr["power"="generator"]["generator:source"="wind"]{bb};);out center tags;',
        }
        for fn, q in jobs.items():
            p = os.path.join(out, fn)
            if os.path.exists(p) and os.path.getsize(p) > 1000:
                print("já existe", fn); continue
            data = post(q); open(p, "wb").write(data)
            print(fn, len(data) // 1024, "kB", flush=True); time.sleep(5)

if __name__ == "__main__":
    main(sys.argv[1])
