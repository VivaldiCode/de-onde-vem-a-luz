# De onde vem a tua luz?

**Pré-visualização:** https://luz.guilhermepinto.pt (ainda em testes; modelo de melhor esforço).

**Escreve a tua morada e vê o caminho da eletricidade até à tua casa**: os postes, o posto de transformação, o cabo de média tensão, a subestação, a rede de alta tensão e as centrais que provavelmente te abastecem, com quanto cada uma está a produzir.

🇬🇧 [English version](README.en.md)

> **Estado: protótipo.** É um **modelo de melhor esforço** feito só com dados abertos. Não é a topologia real da rede nem o fluxo real de energia: a rede é malhada e a energia flui por leis físicas, não por «uma central». Ver [limites e metodologia](docs/METODOLOGIA.md).

## Porquê

Quase ninguém sabe de onde vem a luz que consome. A informação existe, mas está espalhada por mapas, portais de dados e PDFs. Este projeto junta-a num único mapa claro, para qualquer pessoa perceber a dependência da sua casa e discutir a rede com factos. É software livre e de transparência: o código, os dados derivados e os limites do modelo são públicos.

## Línguas

A interface está em português, inglês, espanhol e francês (`web/i18n.mjs`); escolhe-se no seletor do topo, por `?lang=en` ou pela língua do navegador. Os nomes de subestações, centrais e ruas vêm dos dados e não se traduzem. Para acrescentar uma língua, copia um bloco de `DICT` em `web/i18n.mjs`; o teste `tests/i18n.test.mjs` garante que não falta nenhuma chave nem marcador.

## O que faz

1. **Procura a morada** (ou clicas no mapa, ou usas a tua posição).
2. **Traça o caminho**: poste de baixa tensão → posto de transformação → cabo de média tensão → subestação → nó da rede de transporte → linhas de alta tensão → central.
3. **Reparte a energia pelas centrais** com um *rastreio de fluxo*: fluxo DC na rede de alta tensão, com a geração por central e a carga de cada subestação, e rastreio proporcional (a energia que sai de um nó tem a composição da que entra). Dá percentagens por central, não uma certeza.
4. **Mostra quanto produz agora** (REN) e o cenário *tempestade* (sem solar, eólica cortada).
5. **Degrada com graça**: onde faltam dados diz «ainda não temos» e continua.

## Privacidade

- A tua morada **nunca é guardada nem enviada** para nenhum servidor nosso: o traçado corre no teu navegador. Não há contas, cookies nem *analytics*.
- Ao **escrever** uma morada, o navegador pede sugestões ao Photon (geocodificador sobre dados OpenStreetMap), que vê o texto escrito (não a guardamos nem passa por nós). Os servidores do mapa de fundo veem a zona que estás a ver. Para ninguém ver a morada, clica no mapa ou arrasta o ponto.
- Os mapas de fundo veem a zona que estás a ver (não a morada). Detalhes em [docs/PRIVACIDADE.md](docs/PRIVACIDADE.md).

## Experimentar

```bash
npm test                              # 18 testes do motor + 5 das ferramentas
node bin/trace.mjs 41.5513 -8.423     # demonstração na linha de comandos (só alta tensão OSM)
npm run dev                           # site local em http://127.0.0.1:8787
```

Não há dependências. O site completo precisa dos dados derivados da E-REDES (ver [docs/DADOS.md](docs/DADOS.md)); sem eles funciona a camada de alta tensão e as centrais.

## Como está organizado

| Pasta | O quê |
|---|---|
| `engine/trace.mjs` | traçado: morada → subestação → linhas → centrais (sem dependências, corre no navegador, Node e Workers) |
| `engine/flow.mjs` | rastreio de fluxo (DC + rastreio proporcional) |
| `web/` | aplicação estática (Leaflet, MapLibre) |
| `worker/` | Worker Cloudflare: API da geração (REN), com cache em KV opcional |
| `tools/` | construção dos dados (OSM, E-REDES, tiles, apoios, cargas) e publicação da geração |
| `data/` | rede de alta tensão e centrais derivadas do OpenStreetMap; estado curado das centrais |
| `integrations/home-assistant/` | sensores para o Home Assistant |
| `tests/` | testes automáticos, incluindo higiene (nada pessoal no repositório) |

## Integração com o Home Assistant

Há um *package* pronto com sensores REST do mix de geração em Portugal: [integrations/home-assistant](integrations/home-assistant/README.md).

## Fontes e licenças

| Dados | Origem | Licença |
|---|---|---|
| Rede ≥ 60 kV, subestações e centrais | © OpenStreetMap contributors | ODbL 1.0 |
| Subestações, alimentadores MT, postos de transformação, apoios BT, cargas | E-REDES (portal de dados abertos) | CC BY 4.0 (ver [estado](docs/DADOS.md)) |
| Geração por tipo e potência instalada | REN DataHub | provisório, atribuição «Dados: REN» |
| Moradas (sugestões) | Photon / OpenStreetMap | ODbL |
| Ficha das centrais (empresa, ano, link) | Pesquisa manual com fontes (`data/plant_info.json`) | factos; ver as fontes de cada ficha |

**Código: [AGPL-3.0-or-later](LICENSE).** É software livre com copyleft de rede: quem alojar uma versão modificada tem de oferecer o código aos utilizadores. Cada ficheiro tem o cabeçalho `SPDX-License-Identifier`. As bibliotecas em `web/vendor/` mantêm as suas licenças.

## Contribuir

Ver [CONTRIBUTING.md](CONTRIBUTING.md). Correções de dados (centrais encerradas, ligações em falta) são muito bem-vindas: o estado das centrais está em [`data/plant_status.json`](data/plant_status.json).
