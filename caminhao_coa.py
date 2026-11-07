"""Aguardando Caminhão x colhedoras (M10) — classificação e texto.
Entrada: dict {"faltaCaminhao":[...],"possivelDivergencia":[...],"soTransbordo":[...]}
com itens {hora, transbordoAguardCaminhao, transbordos{cod:h}, colhedoraAguardCaminhao,
colhedorasAguardCaminhao{}, colhedoraAguardTransbordo, colhedorasAguardTransbordo{}} (gerado por __C.cruzCaminhao no coa_extract.js).
Regras: hora considerada se transbordos somam >= 0,3 h de Aguardando Caminhão; colhedora Aguardando Caminhão >= 0,1 h -> faltaCaminhao;
senão colhedora Aguard. Transbordo + Aguardando Manobra Transbordo >= 0,2 h -> possivelDivergencia; senão soTransbordo.
"""


def classifica(t_ac, c_ac, c_at):
    if t_ac < 0.3 - 1e-9:
        return None
    if c_ac >= 0.1 - 1e-9:
        return "faltaCaminhao"
    if c_at >= 0.2 - 1e-9:
        return "possivelDivergencia"
    return "soTransbordo"


def faixas(horas):
    hs = sorted(int(h[:2]) for h in horas)
    runs = []
    for h in hs:
        if runs and runs[-1][1] == h - 1:
            runs[-1][1] = h
        else:
            runs.append([h, h])
    fm = lambda r: f"{r[0]:02d}h" if r[0] == r[1] else f"{r[0]:02d}h–{r[1]:02d}h"
    out = [fm(r) for r in runs]
    return out[0] if len(out) == 1 else ", ".join(out[:-1]) + " e " + out[-1]


def top3(itens, campo):
    s = {}
    for it in itens:
        for k, v in it[campo].items():
            s[k] = s.get(k, 0) + v
    c = [k for k, _ in sorted(s.items(), key=lambda x: -x[1])[:3]]
    return c[0] if len(c) == 1 else ", ".join(c[:-1]) + " e " + c[-1]


def num(x):
    return f"{x:.1f}".replace(".", ",")


def texto(ac):
    partes = []
    fc = ac.get("faltaCaminhao") or []
    pd = ac.get("possivelDivergencia") or []
    if fc:
        partes.append(
            f"Falta de caminhão: às {faixas([i['hora'] for i in fc])} os transbordos ({top3(fc,'transbordos')}) "
            f"e as colhedoras ({top3(fc,'colhedorasAguardCaminhao')}) apontaram Aguardando Caminhão ao mesmo tempo; "
            "a frente possivelmente parou por falta de caminhão. Verificar com a logística o motivo da falta nesse horário.")
    if pd:
        mx = max(pd, key=lambda i: i["transbordoAguardCaminhao"])
        partes.append(
            f"Possível divergência de apontamento: às {faixas([i['hora'] for i in pd])} os transbordos ({top3(pd,'transbordos')}) "
            f"apontaram Aguardando Caminhão (até {num(mx['transbordoAguardCaminhao'])} h somadas às {mx['hora']}), "
            f"mas as colhedoras ({top3(pd,'colhedorasAguardTransbordo')}) apontaram Aguardando Transbordo no mesmo horário, "
            "e não Aguardando Caminhão. Conferir com os operadores qual foi a espera real.")
    return " ".join(partes) if partes else None
