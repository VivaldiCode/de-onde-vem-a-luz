// SPDX-License-Identifier: AGPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DICT, LANGS, detectLang, makeT } from "../web/i18n.mjs";

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("as 4 línguas têm exactamente as mesmas chaves", () => {
  assert.deepEqual(Object.keys(LANGS).sort(), ["en", "es", "fr", "pt"]);
  const base = Object.keys(DICT.pt).sort();
  for (const l of ["en", "es", "fr"]) assert.deepEqual(Object.keys(DICT[l]).sort(), base, `chaves diferentes em ${l}`);
});

test("marcadores {x} e etiquetas HTML coincidem em todas as línguas e nada fica vazio", () => {
  const tags = (s) => (String(s).match(/<\/?[a-z]+/gi) || []).map((x) => x.toLowerCase()).sort().join(",");
  for (const [k, v] of Object.entries(DICT.pt)) {
    for (const l of ["en", "es", "fr"]) {
      const o = DICT[l][k];
      assert.ok(typeof o === "string" && o.trim() !== "", `${l}.${k} vazio`);
      assert.equal(ph(o), ph(v), `marcadores diferentes em ${l}.${k}`);
      assert.equal(tags(o), tags(v), `HTML diferente em ${l}.${k}`);
    }
  }
});

test("todas as chaves usadas na página existem no dicionário", () => {
  const used = new Set([...html.matchAll(/\bt\('([\w.]+)'[,)]/g)].map((m) => m[1]));
  for (const m of html.matchAll(/data-i18n(?:-ph|-title|-aria)?="([\w.]+)"/g)) used.add(m[1]);
  for (const k of used) assert.ok(k in DICT.pt, `chave em falta: ${k}`);
  // chaves compostas (how1.t, src.*, base.*)
  for (const i of [1, 2, 3]) for (const x of ["t", "d"]) assert.ok(`how${i}.${x}` in DICT.pt);
  for (const s of ["hydro", "wind", "solar", "gas", "biomass", "biogas", "waste", "battery", "other"]) assert.ok(`src.${s}` in DICT.pt);
  for (const b of ["streets", "gray", "topo", "sat", "osm", "positron", "liberty", "bright"]) assert.ok(`base.${b}` in DICT.pt);
});

test("detectLang: ?lang= > guardada > navegador > inglês", () => {
  assert.equal(detectLang("?lang=fr", "es", ["pt-PT"]), "fr");
  assert.equal(detectLang("", "es", ["pt-PT"]), "es");
  assert.equal(detectLang("", null, ["de-DE", "pt-BR"]), "pt");
  assert.equal(detectLang("", null, ["de-DE", "ja"]), "en");
  assert.equal(detectLang("?lang=xx", "zz", ["fr-CA"]), "fr");
});

test("makeT interpola e não escreve «undefined»", () => {
  assert.equal(makeT("en")("pole.many", { n: 3 }), "3 low-voltage poles");
  assert.equal(makeT("fr")("sub.code", {}), "code ");
  assert.equal(makeT("es")("chave.que.nao.existe"), "chave.que.nao.existe");
});
