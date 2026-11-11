#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Converte o snapshot manual da E-REDES (auxiliar1 = subestações, auxiliar2 = alimentadores MT)
em data/eredes.json compacto.

Uso: build_eredes.py <auxiliar1.geojson> <auxiliar2.geojson> <saida.json> [tolerancia_m=20]

Fonte: E-REDES, portal open data (https://e-redes.opendatasoft.com), página «Capacidade de Receção
na RND». Atribuição obrigatória: «Dados: E-REDES». O snapshot é actualizado À MÃO (a E-REDES não tem
exportação automática); `meta.snapshot` regista a data. O bruto completo fica fora do repo (153 MB).

Saída:
  subs[]    : code (0312S5003800 — começa pelo INE distrito+concelho), name, tipo (SE AT|PC AT), lat, lon,
              rnt (nó RNT 60 kV da REN), group (subestações do mesmo grupo), cap_at / cap_mtat (MVA livres)
  feeders[] : sub (code da subestação a montante), kv, g = [[[lat,lon]...], ...] (partes simplificadas)
"""
import json, math, sys, datetime


def dp(pts, tol):
    """Douglas-Peucker iterativo; pts em (lon, lat), tol em graus aprox."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        n2 = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if n2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / n2))
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def num(v):
    try:
        return round(float(str(v).replace(",", ".")), 2)
    except (TypeError, ValueError):
        return None


def main(a1, a2, out, tol_m="20"):
    tol = float(tol_m) / 111000.0
    S = json.load(open(a1))["features"]
    F = json.load(open(a2))["features"]
    subs = []
    for f in S:
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"]
        subs.append({"code": p["codigo"], "name": p["instalacao"], "tipo": p["tipo_de_instalacao"],
                     "lat": round(lat, 5), "lon": round(lon, 5), "rnt": p.get("ligacao_rnt_barramento_60kv_rari"),
                     "group": p.get("grupo_de_subestacoes_rari"), "cap_at": num(p.get("capacidade_de_recepcao_at_mva_rari")),
                     "cap_mtat": num(p.get("capacidade_de_recepcao_mt_at_mva_rari"))})
    feeders, npts = [], 0
    for f in F:
        p = f["properties"]; g = f["geometry"]
        if not g:
            continue
        parts = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
        simp = []
        for part in parts:
            q = dp([(x, y) for x, y in part], tol)
            if len(q) >= 2:
                simp.append([[round(y, 5), round(x, 5)] for x, y in q]); npts += len(q)
        if simp:
            feeders.append({"sub": p["codigo_se_montante"], "kv": p.get("rede_cir5"), "c": p.get("rede_cir3"), "g": simp})
    meta = {"fonte": "E-REDES (open data, portal Opendatasoft; página Capacidade de Receção na RND)",
            "atribuicao": "Dados: E-REDES", "snapshot": datetime.date.today().isoformat(),
            "actualizacao": "manual", "tolerancia_m": float(tol_m), "subs": len(subs), "feeders": len(feeders), "pontos": npts}
    json.dump({"meta": meta, "subs": subs, "feeders": feeders}, open(out, "w"), separators=(",", ":"), ensure_ascii=False)
    print(meta)


if __name__ == "__main__":
    main(*sys.argv[1:])
