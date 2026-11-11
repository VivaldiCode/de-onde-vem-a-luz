# SPDX-License-Identifier: AGPL-3.0-or-later
import importlib.util, os, unittest

AQUI = os.path.dirname(__file__)
spec = importlib.util.spec_from_file_location("pe", os.path.join(AQUI, "..", "tools", "publish_entsoe.py"))
pe = importlib.util.module_from_spec(spec); spec.loader.exec_module(pe)


class Entsoe(unittest.TestCase):
    def test_central_tira_o_grupo(self):
        self.assertEqual(pe.central("Alqueva - G3"), "Alqueva")
        self.assertEqual(pe.central("Picote II - G1"), "Picote II")
        self.assertEqual(pe.central("Pego C.C."), "Pego C.C.")

    def test_pontos_omitidos_repetem_o_anterior_e_somam_unidades(self):
        xml = open(os.path.join(AQUI, "fixtures_entsoe.xml"), encoding="utf-8").read()
        c = pe.interpretar(xml)["Exemplo"]
        self.assertEqual(c["unidades"], {"Exemplo - G1", "Exemplo - G2"})
        h = c["horas"]
        # G1: 10, 10, 30, 30 (hora 0..3); G2 (30 min): 4,6 | 6,6 | 8,8 | 8,8 -> médias 5, 6, 8, 8
        self.assertEqual([round(h[f"2026-11-09T0{i}:00Z"], 1) for i in range(4)], [15.0, 16.0, 38.0, 38.0])

    def test_recolher_de_ficheiro_resume_o_dia(self):
        xml = open(os.path.join(AQUI, "fixtures_entsoe.xml"), encoding="utf-8").read()
        g = pe.recolher(xml=xml)
        self.assertTrue(g["available"]); self.assertEqual(g["asOf"], "2026-11-09")
        p = g["plants"]["Exemplo"]
        self.assertEqual(p["unidades"], 2); self.assertEqual(p["maxMw"], 38.0); self.assertEqual(p["tipo"], "hydro")
        self.assertEqual(p["horas"][:4], [15.0, 16.0, 38.0, 38.0]); self.assertIsNone(p["horas"][10])


if __name__ == "__main__":
    unittest.main()
