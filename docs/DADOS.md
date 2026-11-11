# Dados: origem, licenças e como regenerar

| Dado | Origem | Licença | Ferramenta |
|---|---|---|---|
| Rede ≥ 60 kV, subestações, centrais | OpenStreetMap (Overpass ou extrato Geofabrik) | ODbL 1.0 | `tools/fetch_osm.py` → `tools/build_graph.py` → `tools/tag_pt.py` |
| Subestações e alimentadores de média tensão | E-REDES | **por confirmar** (ver abaixo) | `tools/build_eredes.py` |
| Postos de transformação | E-REDES, `postos-transformacao-distribuicao` | CC BY 4.0 | `tools/build_tiles.py` |
| Apoios de baixa tensão | E-REDES, `apoios-baixa-tensao` | CC BY 4.0 | `tools/build_poles.py` |
| Carga de ponta por subestação | E-REDES, `carga-na-subestacao` | CC BY 4.0 | `tools/build_loads.py` |
| Ficha das centrais (empresa, ano, link oficial) | pesquisa manual com fontes citadas em `data/plant_info.json` (campo `fonte`; `confianca` diz o quão seguro está) | factos | (editar o ficheiro) |
| Concelhos (para saber o que é Portugal) | E-REDES, `municipalities-portugal` | CC BY 4.0 | `tools/tag_pt.py` |
| Geração por tipo, potência instalada | REN DataHub | provisório | `worker/index.mjs`, `tools/publish_generation.py` |

## Estado da licença dos dados da E-REDES

Os conjuntos públicos do portal da E-REDES declaram CC BY 4.0. Os dados de **subestações com coordenadas** e **alimentadores de média tensão** vêm de camadas que o portal usa nos seus mapas mas que **não estão listadas no catálogo público e não declaram licença**. Enquanto a E-REDES não os publicar com licença, **não são redistribuídos neste repositório** (`data/eredes.json` e `web/data/` estão no `.gitignore`); o código lê-os num formato documentado nas próprias ferramentas. Pedido de publicação regular com licença aberta: em curso.

## Regenerar

- **Rede OSM:** `python3 tools/fetch_osm.py data/raw/osm` e depois `python3 tools/build_graph.py <linhas.json,...> <nós.json,...> data/grid.json` e `python3 tools/tag_pt.py <concelhos.geojson> data/grid.json`. Em produção preferir o extrato mensal da Geofabrik em vez do Overpass público (que está muitas vezes sobrecarregado).
- **E-REDES:** `build_tiles.py` e `build_poles.py` partem os dados em células pequenas para o navegador carregar só o que precisa; `build_loads.py` produz `web/data/eredes/loads.json`.
- **Geração (REN):** a REN só responde bem a pedidos com `Accept: */*` e dá timeout a pedidos vindos do Cloudflare. `tools/publish_generation.py` corre numa rede que a REN aceite (cron/CI) e escreve no KV que o Worker lê; sem KV o Worker tenta a REN diretamente.

## Atribuição

© OpenStreetMap contributors · «Dados: E-REDES» · «Dados: REN».
