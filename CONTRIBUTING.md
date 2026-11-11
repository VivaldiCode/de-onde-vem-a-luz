# Contribuir

Obrigado! O mais útil, por ordem:

1. **Dados:** centrais encerradas ou em reserva (`data/plant_status.json`, com fonte), ligações em falta, erros de nomes.
2. **Motor:** melhorar o rastreio de fluxo (reactâncias reais, limites de capacidade, validação com geração medida).
3. **Interface:** acessibilidade, telemóvel, inglês.

Regras simples:

- `npm test` tem de passar. Inclui um teste de higiene: o repositório não pode conter emails, nomes, IPs internos nem identificadores de contas.
- Sem dependências novas sem boa razão (o motor corre no navegador, em Node e em Workers).
- Todo o código novo leva o cabeçalho `SPDX-License-Identifier: AGPL-3.0-or-later`.
- Não commits dados pessoais nem segredos. Chaves de API vão em variáveis de ambiente.
- Seja honesto nos limites: o resultado é um modelo e a interface diz-o.

Licença das contribuições: AGPL-3.0-or-later.
