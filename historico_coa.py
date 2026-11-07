# -*- coding: utf-8 -*-
"""Apoio da Análise diária COA — economiza tokens: a tarefa NÃO lê o histórico nem o analise.json anterior inteiros.

Uso:
  python3 historico_coa.py resumo  historico_analise_coa.json [n_dias=7]   -> tendência curta por frente (imprime ~3 KB)
  python3 historico_coa.py estilo  analise.json                            -> resumo + 1 frente do dia anterior (referência de escrita)
  python3 historico_coa.py add     historico_analise_coa.json analise.json -> grava o dia do analise.json no histórico
                                                                              (substitui se a data já existir; máx. 60 dias)
"""
import json
import sys

ORDEM = ["Frente 01", "Frente 02", "Frente 03", "Frente 04", "Frente 05",
         "Frente 11", "Frente 13", "Frente 34", "Frente 37"]
MAX_DIAS = 60


def carregar(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def dia_do_analise(a):
    """Monta a entrada do histórico no mesmo formato usado desde 08/10/2026."""
    ec = {}
    if a.get("entregaCota"):
        ec = {x["frente"]: x for x in a["entregaCota"].get("frentes", [])}
    frentes = {}
    for f in a.get("frentes", []):
        nome = f["frente"]
        tl = {}
        for t in f.get("timeline") or []:
            tl[t["indicador"]] = {"horasAcimaMeta": t.get("horasAcimaMeta", 0),
                                  "media": t.get("media", 0),
                                  "pico": t.get("picoValor")}
        ml = {}
        for tipo, v in (f.get("motorLigadoParado") or {}).items():
            if v:
                ml[tipo] = {"horas": v.get("paradoMotorLigado"), "pct": v.get("pctMotorLigado")}
        ac = {k: [x["hora"] for x in (v or [])]
              for k, v in (f.get("aguardandoCaminhao") or {}).items()}
        e = ec.get(nome, {})
        frentes[nome] = {"status": f.get("status"), "colhedora": f.get("colhedora"),
                         "transbordo": f.get("transbordo"), "timeline": tl,
                         "motorLigadoParado": ml, "aguardandoCaminhao": ac,
                         "entrega": e.get("entrega"), "meta": e.get("meta"),
                         "diferenca": e.get("diferenca")}
    return {"data": a["data"], "frentes": frentes}


def add(hp, ap):
    h = carregar(hp)
    a = carregar(ap)
    if a.get("semDados"):
        print("analise.json sem dados (semDados=true): histórico não alterado")
        return
    novo = dia_do_analise(a)
    dias = [d for d in h.get("dias", []) if d.get("data") != novo["data"]]
    dias.append(novo)
    dias.sort(key=lambda d: d["data"])
    h["dias"] = dias[-MAX_DIAS:]
    with open(hp, "w", encoding="utf-8") as f:
        json.dump(h, f, ensure_ascii=False, indent=1)
    print("histórico: %d dias (%s a %s); gravado %s" % (len(h["dias"]), h["dias"][0]["data"], h["dias"][-1]["data"], novo["data"]))


def g(d, *ks):
    for k in ks:
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d


def fmt(v, casas=1):
    if v is None:
        return "-"
    if isinstance(v, (int, float)):
        return ("%." + str(casas) + "f") % v
    return str(v)


def resumo(hp, n=7):
    h = carregar(hp)
    dias = h.get("dias", [])[-n:]
    if not dias:
        print("histórico vazio")
        return
    datas = [d["data"][8:10] + "/" + d["data"][5:7] for d in dias]
    print("HISTÓRICO — últimos %d dias: %s (valores na ordem dos dias)" % (len(dias), " ".join(datas)))
    print("Legenda: st=status(o=ok w=warn b=bad); DMc/DMt=Disponibilidade Manutenção colh/transb (%); EMc=Eficiência do Motor colh (%);"
          " AgT%=Aguard. Transbordo+Manobra (% horas colh); AgC=Aguard. Colhedora (h/transb); Fila (h/transb);"
          " MLP=motor ligado parado colh+transb (h); FC/PD=horas com falta de caminhão/possível divergência; Dif=entrega−cota nominal (t)")
    for nome in ORDEM:
        fs = [d["frentes"].get(nome) for d in dias]
        if not any(fs):
            continue
        def serie(fn, casas=1):
            return " ".join(fmt(fn(f), casas) if f else "·" for f in fs)
        st = " ".join(((f or {}).get("status") or "·")[0] for f in fs)
        mlp = lambda f: sum((g(f, "motorLigadoParado", t, "horas") or 0) for t in ("colhedora", "transbordo"))
        fc = lambda f: len(g(f, "aguardandoCaminhao", "faltaCaminhao") or [])
        pdv = lambda f: len(g(f, "aguardandoCaminhao", "possivelDivergencia") or [])
        print("%s | st %s" % (nome, st))
        print("  DMc %s | DMt %s | EMc %s" % (serie(lambda f: g(f, "colhedora", "disponibilidade"), 0),
                                              serie(lambda f: g(f, "transbordo", "disponibilidade"), 0),
                                              serie(lambda f: g(f, "colhedora", "eficiencia"))))
        print("  AgT%% %s | AgC %s | Fila %s" % (serie(lambda f: g(f, "colhedora", "aguardTransbordoPct")),
                                                serie(lambda f: g(f, "transbordo", "aguardColhedora")),
                                                serie(lambda f: g(f, "transbordo", "fila"))))
        print("  MLP %s | FC %s | PD %s | Dif %s" % (serie(mlp), serie(fc, 0), serie(pdv, 0),
                                                    serie(lambda f: f.get("diferenca"), 0)))
        # sequências que valem citar ("pelo Nº dia seguido")
        avisos = []
        def seguidos(cond):
            c = 0
            for f in reversed(fs):
                if f and cond(f):
                    c += 1
                else:
                    break
            return c
        for rot, cond in [("status bad", lambda f: f.get("status") == "bad"),
                          ("Disp. Manutenção colhedora < 85%", lambda f: (g(f, "colhedora", "disponibilidade") or 100) < 85),
                          ("possível divergência de apontamento", lambda f: pdv(f) > 0),
                          ("falta de caminhão", lambda f: fc(f) > 0),
                          ("abaixo da cota nominal", lambda f: (f.get("diferenca") or 0) < 0)]:
            s = seguidos(cond)
            if s >= 2:
                avisos.append("%s há %d dias seguidos" % (rot, s))
        if avisos:
            print("  ⚑ " + "; ".join(avisos))


def estilo(ap):
    a = carregar(ap)
    print("REFERÊNCIA DE ESTILO — analise.json de %s" % a.get("data"))
    print("RESUMO:\n" + (a.get("resumo") or ""))
    fr = [f for f in a.get("frentes", []) if f.get("status") == "bad"] or a.get("frentes", [])
    if fr:
        f = fr[0]
        print("\nEXEMPLO DE FRENTE (%s, %s):\ntitulo: %s\nanalise: %s\nacao: %s" % (
            f.get("frente"), f.get("status"), f.get("titulo"), f.get("analise"), f.get("acao")))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "add" and len(sys.argv) >= 4:
        add(sys.argv[2], sys.argv[3])
    elif cmd == "resumo" and len(sys.argv) >= 3:
        resumo(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 7)
    elif cmd == "estilo" and len(sys.argv) >= 3:
        estilo(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(1)
