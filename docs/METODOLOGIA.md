# Metodologia e limites

O resultado é um **modelo**. Esta página diz o que faz, com que dados e onde pode estar errado.

## Cadeia de traçado

1. **Ponto** (morada geocodificada, clique ou posição).
2. **Postes de baixa tensão** (apoios da E-REDES, só têm posição): procura-se a fila de postes, com vãos até 250 m (os vãos grandes custam mais), que liga o ponto ao posto de transformação. Se não houver fila completa, mostra-se o poste mais próximo e a ligação a tracejado, dita «provável». A rede de baixa tensão real não é pública.
3. **Posto de transformação** mais próximo (E-REDES): potência, utilização e clientes. A ligação poste → posto é inferida por proximidade.
4. **Cabo de média tensão**: o alimentador mais próximo diz a que subestação o ponto pertence; desenha-se só o ramo entre o posto e a subestação (caminho mais curto no grafo do alimentador).
5. **Subestação AT/MT** e o **nó da rede de transporte** a que se liga (E-REDES).
6. **Linhas de alta tensão e centrais**: grafo do OpenStreetMap (≥ 60 kV). Os nós intermédios com nome (subestações, postos de corte) são listados.

## Rastreio de fluxo (`engine/flow.mjs`)

- **Rede:** linhas ≥ 60 kV; reactância = comprimento × valor típico por nível de tensão.
- **Cargas:** ponta de cada subestação (E-REDES), escalada para igualar o consumo nacional na hora dos dados (REN).
- **Geração:** totais por tipo (REN) repartidos pelas centrais de Portugal em proporção à potência instalada; centrais encerradas ou em reserva contam zero; a importação (REN) é repartida pelas centrais espanholas da malha. No cenário *tempestade* tira-se solar e eólica e o que falta é coberto por hídrica e gás.
- **Fluxo DC** (gradiente conjugado) e **rastreio proporcional** (Bialek): em cada nó, a energia que sai tem a composição da que entra. Os fluxos DC seguem uma ordem de ângulos, logo não há ciclos.
- **Saída:** percentagem do que chega à subestação por central, e o ramo de maior fluxo de cada central (o caminho desenhado).

## Limites (o que pode estar errado)

- **A topologia real não é pública.** O OpenStreetMap pode estar incompleto; cabos subterrâneos urbanos faltam. As ligações a tracejado são inferidas.
- **Geração repartida pela potência instalada**, não medida por central. A produção medida por unidade (ENTSO-E) melhoraria muito o modelo.
- **Reactâncias típicas**, não as da rede real; **carga escalada**; **sem manobras** (a rede de média tensão pode ser reconfigurada) nem limites de capacidade das linhas.
- **Atraso dos dados:** a REN só publica dias fechados (o último ponto tem horas de atraso); os diagramas de carga da E-REDES são históricos.
- **A central «principal»** é a de maior contribuição no modelo; não é garantido que seja a que fisicamente te alimenta. Em geral **nenhuma central domina**: a energia chega de muitas ao mesmo tempo.
- **Estado das centrais:** nenhum dado aberto diz quais estão encerradas. [`data/plant_status.json`](../data/plant_status.json) é curado à mão, com fontes; correções são bem-vindas.

## Como se valida

Testes automáticos com redes pequenas de resposta conhecida (conservação da carga, repartição simétrica, geração local abastece carga local) em `tests/`. Falta comparar com a geração real por central (ENTSO-E).
