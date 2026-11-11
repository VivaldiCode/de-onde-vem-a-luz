#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Constrói data/grid.json a partir de extractos OSM (Overpass JSON) de `power=*`.

Uso: build_graph.py <linhas.json> <nós.json> <saida.json>

Em produção o extracto vem do Geofabrik (portugal-latest.osm.pbf) filtrado com osmium,
não do Overpass público (que está muitas vezes "at capacity"). O formato de saída é o mesmo.

Modelo (melhor esforço — NÃO é a topologia real da REN/E-REDES):
  * nós  = subestações >= 60 kV  +  junções de linhas (extremos que coincidem a < 40 m)
  * arestas = linhas aéreas >= 60 kV (comprimento real da geometria OSM)
  * os extremos das linhas ligam à subestação mais próxima a < 450 m
  * cada central liga ao nó mais próximo (subestação >= 60 kV ou extremo de linha) a < 6 km
    e a ligação fica marcada como `inferida` com a distância
"""
import json, math, sys, collections

def hav(a, b):
    R = 6371.0088
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    d = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(d))

def maxv(s):
    best = 0
    for p in str(s or "").split(";"):
        try:
            best = max(best, int(float(p)))
        except ValueError:
            pass
    return best

def vset(s):
    """Tensões (V) de uma etiqueta `voltage` (ex.: «400000;150000») como conjunto."""
    out = set()
    for p in str(s or "").split(";"):
        try:
            out.add(int(float(p)))
        except ValueError:
            pass
    return out

def compat(a, b):
    """Dois níveis de tensão podem ligar-se? Conjunto vazio = desconhecido = aceita; tolerância de 8 %."""
    if not a or not b:
        return True
    return any(abs(x - y) <= 0.08 * max(x, y) for x in a for y in b)

def mw(tags):
    for k in ("plant:output:electricity", "generator:output:electricity"):
        v = tags.get(k)
        if not v or v == "yes":
            continue
        try:
            num, *unit = v.replace(",", ".").split()
            num = float(num)
            u = (unit[0] if unit else "W").lower()
            return num * {"w": 1e-6, "kw": 1e-3, "kwp": 1e-3, "mw": 1, "mwp": 1, "gw": 1e3}.get(u, 1e-6)
        except (ValueError, IndexError):
            pass
    return None

class Grid:
    CELL = 0.01  # ~1 km: índice espacial simples

    def __init__(self):
        self.pts = []   # (lat, lon, id)
        self.idx = collections.defaultdict(list)

    def add(self, lat, lon, i):
        self.idx[(int(lat / self.CELL), int(lon / self.CELL))].append((lat, lon, i))

    def near_all(self, lat, lon, maxkm):
        """Todos os pontos a <= maxkm, do mais próximo para o mais distante: [(km, id)]."""
        r = max(1, math.ceil(maxkm / 1.1))
        ci, cj = int(lat / self.CELL), int(lon / self.CELL)
        out = []
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                for (la, lo, i) in self.idx.get((ci + di, cj + dj), ()):
                    d = hav((lat, lon), (la, lo))
                    if d <= maxkm:
                        out.append((d, i))
        return sorted(out)

    def near(self, lat, lon, maxkm):
        r = int(maxkm / 100) + 1 if maxkm > 1 else 1
        r = max(1, math.ceil(maxkm / 1.1))
        ci, cj = int(lat / self.CELL), int(lon / self.CELL)
        best = None
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                for (la, lo, i) in self.idx.get((ci + di, cj + dj), ()):
                    d = hav((lat, lon), (la, lo))
                    if d <= maxkm and (best is None or d < best[0]):
                        best = (d, i)
        return best

def main(lines_f, nodes_f, out_f):
    L = []
    for f in lines_f.split(","):  # linhas aéreas e cabos subterrâneos (power=line|cable)
        L += json.load(open(f))["elements"]
    N = []
    for f in nodes_f.split(","):  # vários blocos geográficos: juntar e retirar duplicados nas fronteiras
        N += json.load(open(f))["elements"]
    seen_ids = set(); L2 = []
    for e in L:
        k = (e["type"], e["id"])
        if k not in seen_ids: seen_ids.add(k); L2.append(e)
    L = L2
    seen_ids = set(); N2 = []
    for e in N:
        k = (e["type"], e["id"])
        if k not in seen_ids: seen_ids.add(k); N2.append(e)
    N = N2

    def pos(e):
        c = e.get("center") or e
        return c["lat"], c["lon"]

    nodes = {}      # id -> dict
    subv = {}       # id da subestação -> conjunto das suas tensões
    jv = {}         # id da junção -> conjunto das tensões das linhas que lá chegam
    sidx = Grid()
    for e in N:
        t = e["tags"]
        if t.get("power") != "substation":
            continue
        lat, lon = pos(e)
        i = f"s{e['type'][0]}{e['id']}"
        v = maxv(t.get("voltage"))
        nodes[i] = {"id": i, "k": "sub", "lat": round(lat, 5), "lon": round(lon, 5), "name": t.get("name"),
                    "v": v, "volts": t.get("voltage"), "op": t.get("operator")}
        subv[i] = vset(t.get("voltage"))
        sidx.add(lat, lon, i)

    # --- linhas: geometria, extremos -> subestação (<450 m) ou junção (<40 m)
    jidx = Grid()
    njunc = 0
    edges = []

    def endpoint(lat, lon, vs):
        # só liga linhas do mesmo nível de tensão: uma linha de 150 kV que passa ou acaba perto de uma de 400 kV
        # (ou de uma subestação sem esse nível) não está ligada a ela; a mudança de tensão só acontece numa subestação
        nonlocal njunc
        for _, sid in sidx.near_all(lat, lon, 0.45):
            if compat(vs, subv[sid]):
                return sid
        for _, jid in jidx.near_all(lat, lon, 0.04):
            if compat(vs, jv[jid]):
                jv[jid] |= vs
                return jid
        njunc += 1
        i = f"j{njunc}"
        nodes[i] = {"id": i, "k": "jct", "lat": round(lat, 5), "lon": round(lon, 5), "v": 0}
        jv[i] = set(vs)
        jidx.add(lat, lon, i)
        return i

    for e in L:
        g = e.get("geometry")
        if not g or len(g) < 2:
            continue
        pts = [(p["lat"], p["lon"]) for p in g]
        vs = vset(e["tags"].get("voltage"))
        a = endpoint(*pts[0], vs); b = endpoint(*pts[-1], vs)
        if a == b:
            continue
        km = sum(hav(pts[k], pts[k + 1]) for k in range(len(pts) - 1))
        # geometria simplificada p/ o mapa (1 em cada n pontos, mantém extremos)
        step = max(1, len(pts) // 12)
        simp = pts[::step]
        if simp[-1] != pts[-1]:
            simp.append(pts[-1])
        t = e["tags"]
        v = maxv(t.get("voltage"))
        edges.append({"a": a, "b": b, "v": v, "km": round(km, 2), "op": t.get("operator"), "cab": t.get("power") == "cable",
                      "g": [[round(x, 4), round(y, 4)] for x, y in simp], "w": f"w{e['id']}"})
        for n_ in (a, b):
            nodes[n_]["v"] = max(nodes[n_].get("v", 0), v)

    # --- extremos soltos (grau 1) = quase sempre o troço subterrâneo urbano que falta no OSM:
    #     ligar à subestação >= 60 kV mais próxima a < 3 km, marcado como `inferida` (tracejado no mapa)
    deg = collections.Counter()
    for ed in edges:
        deg[ed["a"]] += 1; deg[ed["b"]] += 1
    ninf = 0
    for n in list(nodes.values()):
        if n["k"] == "jct" and deg[n["id"]] == 1:
            cands = []
            for sid in [x for x in nodes if nodes[x]["k"] == "sub" and nodes[x]["v"] >= 60000]:
                d = hav((n["lat"], n["lon"]), (nodes[sid]["lat"], nodes[sid]["lon"]))
                if d < 3 and deg[sid] == 0:
                    cands.append((d, sid))
            if cands:
                d, sid = min(cands)
                edges.append({"a": n["id"], "b": sid, "v": 60000, "km": round(d, 2), "op": None, "cab": True, "inf": True,
                              "g": [[n["lat"], n["lon"]], [nodes[sid]["lat"], nodes[sid]["lon"]]], "w": f"i{ninf}"})
                deg[sid] += 1; ninf += 1

    # --- centrais: unir ao nó mais próximo
    allidx = Grid()
    for n in nodes.values():
        allidx.add(n["lat"], n["lon"], n["id"])
    plants = []
    # 1.º passe: posições dos parques eólicos já mapeados como `plant`
    seen_pos = []
    for e in N:
        t = e["tags"]
        if t.get("power") == "plant" and (t.get("plant:source") or "").split(";")[0] == "wind":
            seen_pos.append(pos(e))
    srcs = collections.Counter()
    for e in N:
        t = e["tags"]
        p = t.get("power")
        if p == "plant":
            src = (t.get("plant:source") or "?").split(";")[0]
        elif p == "generator" and t.get("generator:source") == "wind":
            src = "wind"
        else:
            continue
        lat, lon = pos(e)
        if p == "generator":
            # aerogeradores individuais: só contam se não houver um `plant` eólico a < 3 km
            if any(hav((lat, lon), q) < 3 for q in seen_pos):
                continue
        c = allidx.near(lat, lon, 6)
        out = mw(t)
        i = f"p{e['type'][0]}{e['id']}"
        plants.append({"id": i, "name": t.get("name"), "src": src, "mw": out,
                       "lat": round(lat, 5), "lon": round(lon, 5), "op": t.get("operator"),
                       "to": c[1] if c else None, "dkm": round(c[0], 2) if c else None})
        srcs[src] += 1

    # lista de adjacência -> componentes (para diagnosticar a malha)
    adj = collections.defaultdict(list)
    for ed in edges:
        adj[ed["a"]].append(ed["b"]); adj[ed["b"]].append(ed["a"])
    comp, seen = [], set()
    for n in nodes:
        if n in seen:
            continue
        st, c = [n], 0
        seen.add(n)
        while st:
            x = st.pop(); c += 1
            for y in adj[x]:
                if y not in seen:
                    seen.add(y); st.append(y)
        comp.append(c)
    comp.sort(reverse=True)

    out = {"meta": {"fonte": "OpenStreetMap contributors (ODbL)", "modelo": "melhor-esforço; não é a topologia real da rede",
                    "nodes": len(nodes), "edges": len(edges), "inferred": ninf, "plants": len(plants),
                    "components_top": comp[:8]},
           "nodes": list(nodes.values()), "edges": edges, "plants": plants}
    json.dump(out, open(out_f, "w"), separators=(",", ":"), ensure_ascii=False)
    print(out["meta"], dict(srcs))

if __name__ == "__main__":
    main(*sys.argv[1:4])
