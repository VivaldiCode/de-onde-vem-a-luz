# SPDX-License-Identifier: AGPL-3.0-or-later
"""Testes das ferramentas de construção de dados (só stdlib)."""
import importlib.util, json, os, tempfile, unittest, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "tools" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod


class TestTools(unittest.TestCase):
    def test_ponto_em_poligono(self):
        t = load("tag_pt")
        sq = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
        self.assertTrue(t.inside(5, 5, sq))
        self.assertFalse(t.inside(15, 5, sq))

    def test_cargas_por_subestacao(self):
        b = load("build_loads")
        rows = [{"codigo_da_instalacao": "X1", "tensao": "60/15", "potencia_instalada": 63, "inverno_verao": "Inverno", "carga_natural": 51.6},
                {"codigo_da_instalacao": "X1", "tensao": "60/15", "potencia_instalada": 63, "inverno_verao": "Verão", "carga_natural": 43.9}]
        with tempfile.TemporaryDirectory() as d:
            src, out = os.path.join(d, "a.json"), os.path.join(d, "b.json")
            json.dump(rows, open(src, "w")); b.main(src, out)
            self.assertEqual(json.load(open(out))["X1"], {"kv": "60/15", "cap": 63, "w": 51.6, "s": 43.9})

    def test_simplificacao_mantem_extremos_e_reduz_pontos(self):
        e = load("build_eredes")
        line = [(0.0, 0.0), (0.001, 1e-9), (0.002, 0.0), (0.003, 5e-4), (0.004, 0.0)]
        out = e.dp(line, 1e-5)
        self.assertEqual(out[0], line[0]); self.assertEqual(out[-1], line[-1])
        self.assertLess(len(out), len(line))

    def test_apoios_em_celulas_compactas(self):
        p = load("build_poles")
        with tempfile.TemporaryDirectory() as d:
            csv = os.path.join(d, "a.csv"); out = os.path.join(d, "t")
            open(csv, "w", encoding="utf-8-sig").write("geo_point_2d\n41.4251, -8.5201\n41.4252, -8.5202\n")
            p.main(csv, out)
            idx = json.load(open(os.path.join(out, "index.json")))
            self.assertEqual(idx["n"], 2)
            tile = json.load(open(os.path.join(out, f"p_{idx['tiles'][0]}.json")))
            self.assertEqual(len(tile["p"]), 4)
            self.assertAlmostEqual(tile["o"][0] + tile["p"][0] * 1e-5, 41.4251, places=4)

    def test_publicador_da_geracao_interpreta_a_REN(self):
        g = load("publish_generation")
        cats = [f"{h:02d}:{m:02d}" for h in range(24) for m in (0, 15, 30, 45)]
        series = [{"name": n, "data": [v] * 96} for n, v in [("Hydro", 800), ("Wind", 4500), ("Solar", 0), ("Natural Gas", 550), ("Consumption", 5800), ("Import", 600)]]
        calls = []

        def fake(path):
            calls.append(path)
            if path.startswith("ElectricityProductionBreakdownDaily"): return {"xAxis": {"categories": cats}, "series": series}
            return [{"type": "HYDRO", "monthly_Accumulation": 8385}, {"type": "WIND", "monthly_Accumulation": 5744}]
        g.ren = fake
        out = g.generation()
        self.assertTrue(out["available"])
        self.assertEqual(out["byType"]["wind"], 4500)
        self.assertEqual(out["installed"], {"hydro": 8385, "wind": 5744})
        self.assertEqual(out["consumptionMw"], 5800)


if __name__ == "__main__":
    unittest.main()
