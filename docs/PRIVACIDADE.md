# Privacidade

**Princípio:** a morada de quem usa o mapa não sai do navegador para nós.

- O traçado corre no navegador: o motor, a rede de alta tensão e os ficheiros da zona (em células de ~10 km) são ficheiros estáticos.
- **Não há servidor que receba moradas, nem contas, cookies, *analytics* ou registos da morada.**
- Quando **escreves** uma morada, o navegador pede sugestões ao **Photon** (photon.komoot.io, dados OpenStreetMap) enquanto escreves (só depois de uma pausa e com 3 ou mais letras), e esse serviço vê o texto escrito e tem a sua própria política. Os servidores do mapa de fundo (Esri ou OpenFreeMap) veem a zona do mapa que estás a ver, o que revela a localização aproximada. Para evitar isso: clica no mapa, arrasta o ponto, ou usa a tua posição (a posição não sai do navegador).
- Os **mapas de fundo** (OpenFreeMap, Esri ou OpenStreetMap, à escolha) veem a zona que estás a ver, não a morada.
- O **Worker** só devolve dados globais (a geração nacional). Nunca recebe coordenadas.
- A escolha do mapa de fundo é guardada no teu navegador (`localStorage`); não sai de lá.
- O alojamento (Cloudflare) mantém registos de rede normais de pedidos de ficheiros estáticos (como qualquer site). Se quiseres evitar isso, podes alojar a tua cópia (o projeto é livre).
