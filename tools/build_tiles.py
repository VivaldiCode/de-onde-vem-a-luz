#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Parte os dados da E-REDES em células de 0,1° para o navegador carregar só o que precisa.

Uso: build_tiles.py <eredes.json> <postos.geojson> <pasta-saida>

Entrada: data/eredes.json (build_eredes.py) e o export do dataset `postos-transformacao-distribuicao`
(CC BY 4.0, E-REDES). Saída (dados da APLICAÇÃO, para o R2/estáticos; o bruto fica fora do repo):
  <saida>/subs.json        subestações AT/MT (470) — pequeno, carregado sempre
  <saida>/t_<i>_<j>.json   i=floor(lat*10), j=floor(lon*10): {f: alimentadores MT, p: postos de transformação}
  <saida>/index.json       lista de células existentes + meta (snapshot, atribuição)
Atribuição obrigatória: «Dados: E-REDES».
"""
import json, math, os, sys, collections

CELL = 0.1


def cell(lat, lon):
    return math.floor(lat / CELL), math.floor(lon / CELL)


def main(eredes_f, postos_f, out):
    os.makedirs(out, exist_ok=True)
    E = json.load(open(eredes_f))
    P = json.load(open(postos_f))["features"]
    tiles = collections.defaultdict(lambda: {"f": [], "p": []})

    for f in E["feeders"]:
        cells = set()
        for part in f["g"]:
            for (a, b) in zip(part, part[1:]):  # amostrar os segmentos para não falhar células atravessadas
                n = max(1, int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) / (CELL / 4)))
                for k in range(n + 1):
                    cells.add(cell(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n))
        # cada célula leva o alimentador inteiro (simplificado): evita cortes e custa pouco
        for c in cells:
            tiles[c]["f"].append({"s": f["sub"], "kv": f["kv"], "g": f["g"]})

    for ft in P:
        lon, lat = ft["geometry"]["coordinates"]
        p = ft["properties"]
        tiles[cell(lat, lon)]["p"].append([round(lat, 5), round(lon, 5), p["cod_instalacao"], p.get("potencia_transformacao_kva"),
                                           p.get("nivel_utilizacao"), p.get("num_clientes"), p.get("tipo_construtivo")])

    sizes = []
    for (i, j), t in tiles.items():
        fn = f"t_{i}_{j}.json"
        json.dump(t, open(os.path.join(out, fn), "w"), separators=(",", ":"), ensure_ascii=False)
        sizes.append(os.path.getsize(os.path.join(out, fn)))
    json.dump({"meta": E["meta"], "subs": E["subs"]}, open(os.path.join(out, "subs.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    json.dump({"cell": CELL, "tiles": sorted(f"{i}_{j}" for (i, j) in tiles), "meta": E["meta"],
               "postos": len(P), "atribuicao": "Dados: E-REDES"}, open(os.path.join(out, "index.json"), "w"), ensure_ascii=False)
    print(f"{len(tiles)} células; tamanho médio {sum(sizes)//len(sizes)//1024} kB, máx {max(sizes)//1024} kB, total {sum(sizes)//1024//1024} MB; postos {len(P)}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
