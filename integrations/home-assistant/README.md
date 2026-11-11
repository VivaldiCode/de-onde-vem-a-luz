# Integração com o Home Assistant

Sensores com o **mix de geração de Portugal** (eólica, hídrica, solar, gás, consumo, importação, percentagem renovável), alimentados pela API pública do projeto (`/api/v1/generation/pt`, dados da REN).

## Instalar

1. Copia [`packages/de_onde_vem_a_luz.yaml`](packages/de_onde_vem_a_luz.yaml) para `<config>/packages/`.
2. No `configuration.yaml`:
   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```
3. Reinicia o Home Assistant. Aparecem os sensores `sensor.rede_pt_*`.

Se alojares a tua própria cópia do projeto, muda o `resource:` para o teu endereço.

## Cartão de exemplo

```yaml
type: entities
title: Rede elétrica de Portugal
entities:
  - sensor.rede_pt_eolica
  - sensor.rede_pt_hidrica
  - sensor.rede_pt_solar
  - sensor.rede_pt_gas
  - sensor.rede_pt_consumo
  - sensor.rede_pt_importacao
  - sensor.rede_pt_renovavel
  - sensor.rede_pt_ultimo_ponto
```

## Limites

- A REN só publica dias fechados: o «último ponto» pode ter horas de atraso. Para tempo quase real é preciso a geração medida por central (ENTSO-E).
- Estes sensores são **nacionais**. O percurso da *tua* casa (subestação, centrais prováveis) está no mapa; uma API por localização sem enviar a tua morada está planeada, e seria calculada no teu Home Assistant a partir da posição da tua casa.
