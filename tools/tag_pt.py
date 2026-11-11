#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Marca em data/grid.json quais as centrais ficam em Portugal (pt: true/false), por ponto-em-polígono sobre os
concelhos (E-REDES `municipalities-portugal`, CC BY 4.0). Serve ao rastreio de fluxo: as centrais espanholas contam como
«importação», não como produção nacional.
Uso: tag_pt.py <municipalities.geojson> <grid.json>   (reescreve o grid.json)
"""
import json, sys


def rings(g):
    return g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]


def inside(x, y, ring):
    c = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]; xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def main(mun_f, grid_f):
    M = []
    for f in json.load(open(mun_f))["features"]:
        for poly in rings(f["geometry"]):
            xs = [p[0] for p in poly[0]]; ys = [p[1] for p in poly[0]]
            M.append((min(xs), min(ys), max(xs), max(ys), poly))
    g = json.load(open(grid_f))
    n_pt = 0
    for p in g["plants"]:
        x, y = p["lon"], p["lat"]
        p["pt"] = any(b[0] <= x <= b[2] and b[1] <= y <= b[3] and inside(x, y, b[4][0]) and not any(inside(x, y, h) for h in b[4][1:]) for b in M)
        n_pt += p["pt"]
    g["meta"]["plants_pt"] = n_pt
    json.dump(g, open(grid_f, "w"), separators=(",", ":"), ensure_ascii=False)
    print(f"{n_pt} de {len(g['plants'])} centrais em Portugal")


if __name__ == "__main__":
    main(*sys.argv[1:3])
