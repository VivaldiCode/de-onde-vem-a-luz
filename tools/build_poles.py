#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Parte os apoios de baixa tensão da E-REDES (3 M de pontos) em células de 0,05° (~5 km) compactas.

Uso: build_poles.py <apoios.csv> <pasta-saida>
Entrada: export CSV do dataset `apoios-baixa-tensao` (CC BY 4.0, E-REDES), coluna geo_point_2d «lat, lon».
Saída p_<i>_<j>.json, i=floor(lat*20), j=floor(lon*20): {"o":[lat0,lon0],"p":[dlat,dlon,...]} com deslocamentos
inteiros em unidades de 1e-5° (~1 m) relativos ao canto sul-oeste da célula: ~10 bytes por apoio.
Atribuição obrigatória: «Dados: E-REDES». Os apoios só têm posição (não dizem a que posto/linha ligam).
"""
import sys, os, re, json, math, collections

F = 20  # células de 1/20° = 0,05°
pat = re.compile(r'(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)')

def main(csv_f, out):
    os.makedirs(out, exist_ok=True)
    cells = collections.defaultdict(list)
    n = 0
    with open(csv_f, encoding='utf-8-sig') as fh:
        for line in fh:
            m = pat.search(line)
            if not m:
                continue
            lat, lon = float(m.group(1)), float(m.group(2))
            i, j = math.floor(lat * F), math.floor(lon * F)
            cells[(i, j)].append((round((lat - i / F) * 1e5), round((lon - j / F) * 1e5)))
            n += 1
    sizes = []
    for (i, j), pts in cells.items():
        flat = [v for p in pts for v in p]
        fn = os.path.join(out, f"p_{i}_{j}.json")
        json.dump({"o": [i / F, j / F], "p": flat}, open(fn, "w"), separators=(",", ":"))
        sizes.append(os.path.getsize(fn))
    json.dump({"f": F, "tiles": sorted(f"{i}_{j}" for (i, j) in cells), "n": n, "atribuicao": "Dados: E-REDES"},
              open(os.path.join(out, "index.json"), "w"))
    print(f"{n} apoios em {len(cells)} células; média {sum(sizes)//len(sizes)//1024} kB, máx {max(sizes)//1024} kB, total {sum(sizes)//1024//1024} MB")

if __name__ == "__main__":
    main(*sys.argv[1:3])
