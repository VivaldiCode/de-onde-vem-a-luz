# Where does your electricity come from?

**Preview:** https://luz.guilhermepinto.pt (still in testing; best-effort model).

**Type an address and see the path electricity takes to your home**: the poles, the transformer station, the medium-voltage cable, the substation, the high-voltage grid and the power plants that most likely supply you, with how much each one is producing.

🇵🇹 [Versão em português](README.md)

> **Status: prototype.** This is a **best-effort model** built only from open data. It is not the real grid topology or the real power flow: the grid is meshed and electricity follows physics, not "one plant". See [limits and methodology](docs/METODOLOGIA.md) (Portuguese).

## Why

Almost nobody knows where the power they use comes from. The information exists, scattered across maps, open-data portals and PDFs. This project puts it on one clear map so anyone can understand their home's dependence on the grid and discuss it with facts. It is free software and transparency-minded: the code, the derived data and the model's limits are public.

## Languages

The interface is available in Portuguese, English, Spanish and French (`web/i18n.mjs`); pick one in the selector at the top, with `?lang=pt`, or let the browser language decide. Names of substations, power plants and streets come from the data and are not translated. To add a language, copy a block of `DICT` in `web/i18n.mjs`; `tests/i18n.test.mjs` checks that no key or placeholder is missing.

## What it does

1. **Finds the address** (or you click the map, or use your location).
2. **Draws the path**: low-voltage pole → transformer station → medium-voltage cable → substation → transmission node → high-voltage lines → power plant.
3. **Splits the energy across plants** with *flow tracing*: a DC power flow on the high-voltage grid using per-plant generation and each substation's load, then proportional tracing (the power leaving a node has the composition of what enters it). It yields percentages per plant, not certainty.
4. **Shows what plants produce now** (REN) and a *storm* scenario (no solar, wind cut out).
5. **Degrades gracefully**: where data is missing it says so and carries on.

## Privacy

- Your address is **never stored or sent to any server of ours**: the trace runs in your browser. No accounts, cookies or analytics.
- When you **type** an address, your browser queries Nominatim (OpenStreetMap), which sees it. To avoid that, click the map or drag the point.
- Basemaps see the area you view (not your address). Details: [docs/PRIVACIDADE.md](docs/PRIVACIDADE.md) (Portuguese).

## Try it

```bash
npm test                              # 18 engine tests + 5 tooling tests
node bin/trace.mjs 41.5513 -8.423     # command-line demo (OSM high-voltage grid only)
npm run dev                           # local site at http://127.0.0.1:8787
```

No dependencies. The full site needs the derived E-REDES data (see [docs/DADOS.md](docs/DADOS.md)); without it the high-voltage layer and plants still work.

## Data and licences

OpenStreetMap (ODbL 1.0) · E-REDES open data (CC BY 4.0, see status in docs) · REN DataHub (provisional). **Code: [AGPL-3.0-or-later](LICENSE)** (network copyleft: if you host a modified version you must offer its source to users).

## Home Assistant

A ready-made package with REST sensors for Portugal's generation mix: [integrations/home-assistant](integrations/home-assistant/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Data fixes (closed plants, missing links) are very welcome: see [`data/plant_status.json`](data/plant_status.json).
