#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Cargas de ponta por subestação AT/MT (E-REDES `carga-na-subestacao`, CC BY 4.0) -> web/data/eredes/loads.json.
Saída: {código: {w: carga natural no inverno (MW), s: no verão (MW), cap: potência instalada (MVA), kv: «60/15»}}.
Uso: build_loads.py <carga_raw.json> <saida.json>   (carga_raw = lista de registos da API; ver o fetch no README)
"""
import json, sys


def main(raw_f, out_f):
    rows = json.load(open(raw_f))
    out = {}
    for r in rows:
        o = out.setdefault(r["codigo_da_instalacao"], {"kv": r.get("tensao"), "cap": r.get("potencia_instalada")})
        o["w" if str(r.get("inverno_verao")).lower().startswith("inv") else "s"] = r.get("carga_natural")
    json.dump(out, open(out_f, "w"), separators=(",", ":"))
    print(len(out), "subestações; carga de ponta total (inverno):", round(sum(v.get("w") or 0 for v in out.values())), "MW")


if __name__ == "__main__":
    main(*sys.argv[1:3])
