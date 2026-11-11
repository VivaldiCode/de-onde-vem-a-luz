#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Vai buscar à ENTSO-E a produção real por unidade de Portugal (A73) e publica-a, agregada por central, no KV do Cloudflare.
Portugal só publica hídricas e gás (eólica e solar só por tipo) e com ~2 dias de atraso: o script recua até encontrar um dia com dados.
Só stdlib. Variáveis: ENTSOE_TOKEN, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, KV_NAMESPACE_ID (nunca no repositório).
Dados: ENTSO-E Transparency Platform (https://transparency.entsoe.eu), sujeitos aos seus termos; mostrar sempre a atribuição.
Uso: publish_entsoe.py [--dry-run] [--xml FICHEIRO]   (--xml: usa um ficheiro em vez da API, para testes)
"""
import datetime, json, os, re, sys, urllib.error, urllib.parse, urllib.request

PT = "10YPT-REN------W"
API = "https://web-api.tp.entsoe.eu/api"
TIPO = {"B10": "hydro", "B11": "hydro", "B12": "hydro", "B04": "gas", "B01": "biomass", "B16": "solar", "B19": "wind", "B18": "wind"}


def central(nome):
    """«Alqueva - G3» -> «Alqueva» (as unidades são grupos geradores da mesma central)."""
    return re.sub(r"\s*[-–]\s*(G|GR|UG|Grupo)?\s*\d+\w*\s*$", "", nome or "").strip()


def _passo_min(res):
    m = re.fullmatch(r"PT(\d+)M", res or "")
    return int(m[1]) if m else 60


def interpretar(xml):
    """XML A73 -> {central: {tipo, unidades, horas: {hora_UTC: MW médios}}} somando as unidades de cada central.
    A ENTSO-E usa curvas «A03»: um ponto em falta repete o valor do anterior; por isso preenchemos para a frente até ao fim do período."""
    out = {}
    for ts in re.findall(r"<TimeSeries>.*?</TimeSeries>", xml, re.S):
        nome = (re.search(r"<name>(.*?)</name>", ts, re.S) or [None, ""])[1]
        psr = (re.search(r"<psrType>(\w+)</psrType>", ts) or [None, None])[1]
        c = out.setdefault(central(nome), {"tipo": TIPO.get(psr, psr), "unidades": set(), "horas": {}})
        c["unidades"].add(nome)
        for per in re.findall(r"<Period>.*?</Period>", ts, re.S):
            ini = datetime.datetime.fromisoformat(re.search(r"<start>(.*?)</start>", per)[1].replace("Z", "+00:00"))
            fim = datetime.datetime.fromisoformat(re.search(r"<end>(.*?)</end>", per)[1].replace("Z", "+00:00"))
            passo = _passo_min(re.search(r"<resolution>(.*?)</resolution>", per)[1])
            n = int((fim - ini).total_seconds() // 60 // passo)
            pts = {int(pos): float(q) for pos, q in re.findall(r"<position>(\d+)</position>\s*<quantity>([\d.\-]+)</quantity>", per)}
            ult, acum = None, {}
            for pos in range(1, n + 1):
                ult = pts.get(pos, ult)  # ponto omitido = igual ao anterior
                if ult is None:
                    continue
                t = ini + datetime.timedelta(minutes=passo * (pos - 1))
                acum.setdefault(t.replace(minute=0), []).append(ult)
            for hora, v in acum.items():
                h = hora.strftime("%Y-%m-%dT%H:00Z")
                c["horas"][h] = c["horas"].get(h, 0.0) + sum(v) / len(v)  # média da hora desta unidade; soma entre unidades
    return out


def resumir(centrais, dia):
    plantas = {}
    for nome, c in sorted(centrais.items()):
        horas = [c["horas"].get(f"{dia}T{h:02d}:00Z") for h in range(24)]
        val = [x for x in horas if x is not None]
        if not val:
            continue
        plantas[nome] = {"tipo": c["tipo"], "unidades": len(c["unidades"]), "horas": [None if x is None else round(x, 1) for x in horas],
                         "mediaMw": round(sum(val) / len(val), 1), "maxMw": round(max(val), 1)}
    return plantas


def pedir(tok, dia):
    d1 = dia + datetime.timedelta(days=1)
    q = urllib.parse.urlencode({"securityToken": tok, "documentType": "A73", "processType": "A16", "in_Domain": PT,
                                "periodStart": dia.strftime("%Y%m%d0000"), "periodEnd": d1.strftime("%Y%m%d0000")})
    try:
        return urllib.request.urlopen(f"{API}?{q}", timeout=90).read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        return e.read().decode("utf-8", "ignore")  # 200 com «No matching data» ou 4xx com texto: tratado abaixo


def recolher(tok=None, xml=None):
    hoje = datetime.datetime.now(datetime.timezone.utc).date()
    for atras in (1, 2, 3, 4, 5):
        dia = hoje - datetime.timedelta(days=atras)
        x = xml if xml is not None else pedir(tok, dia)
        if "<TimeSeries>" in x:
            if xml is not None:  # ficheiro de teste: o dia vem do próprio XML
                dia = datetime.datetime.fromisoformat(re.search(r"<start>(.*?)</start>", x)[1].replace("Z", "+00:00")).date()
            plantas = resumir(interpretar(x), dia.isoformat())
            if plantas:
                return {"available": True, "source": "ENTSO-E Transparency Platform (A73, produção real por unidade)", "asOf": dia.isoformat(),
                        "lagDays": atras, "plants": plantas,
                        "note": "Só hídricas e gás são publicadas por unidade; eólica e solar só por tipo. Dados com cerca de 2 dias de atraso.",
                        "publishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")}
        if xml is not None:
            break
    return None


def main():
    xml = open(sys.argv[sys.argv.index("--xml") + 1], encoding="utf-8").read() if "--xml" in sys.argv else None
    tok = os.environ.get("ENTSOE_TOKEN")
    if not tok and xml is None:
        print("ENTSOE_TOKEN em falta", file=sys.stderr); return 3
    g = recolher(tok, xml)
    if not g:
        print("ENTSO-E sem dados por unidade nos últimos dias", file=sys.stderr); return 2
    resumo = f"{g['asOf']} (atraso {g['lagDays']} d): {len(g['plants'])} centrais"
    cf, acct, ns = os.environ.get("CLOUDFLARE_API_TOKEN"), os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("KV_NAMESPACE_ID")
    if "--dry-run" in sys.argv or not (cf and acct and ns):
        print("(simulação) " + resumo); return 0 if "--dry-run" in sys.argv else 3
    req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{acct}/storage/kv/namespaces/{ns}/values/units?expiration_ttl=864000",
                                 data=json.dumps(g).encode(), method="PUT", headers={"Authorization": f"Bearer {cf}", "Content-Type": "application/json"})
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=30).read())
    except urllib.error.HTTPError as e:
        print(f"Cloudflare KV: HTTP {e.code}", file=sys.stderr); return 1
    print("publicado: " + resumo if r.get("success") else f"falhou: {r.get('errors')}")
    return 0 if r.get("success") else 1


if __name__ == "__main__":
    sys.exit(main())
