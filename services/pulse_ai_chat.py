"""
Assistente conversacional do PULSE AI.

Arquitetura: a rota /pulse-ai/api/chat só conhece a interface MotorConversa
(responder(pergunta, usuario) -> dict). Hoje existe um único motor,
MotorRegras, que entende a pergunta por palavras-chave e responde com os
dados reais do banco (via services/pulse_ai.py). NÃO há modelo de linguagem
conectado, e a tela diz isso.

Pra plugar um LLM no futuro: criar uma subclasse de MotorConversa que monte
o contexto com services.pulse_ai.estado_completo() e chame a API escolhida,
registrar em MOTORES e definir PULSE_AI_MOTOR no ambiente. Rotas, tela e
regra de confirmação de ações continuam iguais.

Formato da resposta:
    {"texto": str, "itens": [str], "acao": {...} | None, "motor": str}
`acao` é só uma PROPOSTA — nada é executado aqui. A execução acontece em
/pulse-ai/api/executar, depois que a pessoa confirma.
"""
import re
import unicodedata
from datetime import datetime, timedelta, timezone

from flask import current_app

from models import Comodo, Dispositivo
from services import pulse_ai as cerebro
from services.energia import resumo_consumo


def normalizar(texto):
    texto = unicodedata.normalize("NFKD", (texto or "").lower())
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9 ]+", " ", texto.replace("-", " "))


def tokens(texto):
    return set(normalizar(texto).split())


class MotorConversa:
    nome = "base"
    descricao = ""

    def responder(self, pergunta, usuario):  # pragma: no cover - interface
        raise NotImplementedError


# sinônimos por tipo de dispositivo (Single Table Inheritance -> coluna `tipo`)
SINONIMOS_TIPO = {
    "luz": {"luz", "luzes", "lampada", "lampadas", "iluminacao"},
    "porta": {"porta", "portas", "portao"},
    "janela": {"janela", "janelas", "persiana"},
    "tv": {"tv", "televisao", "televisor"},
    "ar_condicionado": {"ar", "condicionado", "arcondicionado", "climatizacao", "climatizador"},
    "camera": {"camera", "cameras"},
    "robo_aspirador": {"robo", "aspirador"},
    "eletrodomestico": {"geladeira", "refrigerador"},
}
VERBOS_LIGAR = {"ligar", "liga", "ligue", "acender", "acende", "acenda", "abrir", "abra", "abre"}
VERBOS_DESLIGAR = {"desligar", "desliga", "desligue", "apagar", "apaga", "apague", "fechar", "feche", "fecha"}
PARADAS = {"de", "da", "do", "das", "dos", "a", "o", "e"}


class MotorRegras(MotorConversa):
    nome = "regras"
    descricao = "Motor de regras local: responde com os dados do banco, sem modelo de linguagem."

    # ---------- entrada ----------
    def responder(self, pergunta, usuario):
        t = tokens(pergunta)
        n = normalizar(pergunta)
        if not t:
            return self._r("Digite uma pergunta sobre a casa. " + self._exemplos())

        verbo = "ligar" if t & VERBOS_LIGAR else "desligar" if t & VERBOS_DESLIGAR else None
        if verbo:
            return self._comando(verbo, t, pergunta, usuario)

        regras = [
            (lambda: t & {"oi", "ola", "ajuda", "help"} or any(s in n for s in ("bom dia", "boa tarde", "boa noite", "o que voce faz")),
             self._saudacao),
            (lambda: t & {"alerta", "alertas", "ocorrencia", "ocorrencias", "problema", "problemas", "aviso", "avisos"}, self._alertas),
            (lambda: t & {"melhorar", "melhoria", "melhorias", "dica", "dicas", "recomendacao", "recomendacoes",
                          "sugestao", "sugestoes", "economizar", "economia"}, self._recomendacoes),
            (lambda: t & {"consumo", "consumindo", "consome", "energia", "gasto", "gastando", "kwh", "conta"}, self._energia),
            (lambda: any(p.startswith("automac") or p.startswith("agendad") or p.startswith("programad") or p == "rotinas"
                         for p in t), self._automacoes),
            (lambda: "saude" in t, self._saude),
            (lambda: t & {"resumo", "hoje", "diario"}, self._resumo),
            (lambda: t & {"historico", "aconteceu", "ultimos", "ultimas", "timeline"} or "linha do tempo" in n, self._linha_tempo),
            (lambda: "garagem" in t or "carro" in t or "veiculo" in t, self._garagem),
            (lambda: t & SINONIMOS_TIPO["porta"], lambda: self._categoria("portas", "porta")),
            (lambda: t & SINONIMOS_TIPO["janela"], lambda: self._categoria("janelas", "janela")),
            (lambda: t & SINONIMOS_TIPO["luz"], self._luzes),
            (lambda: t & SINONIMOS_TIPO["ar_condicionado"] or "temperatura" in t, lambda: self._categoria("clima", "ar-condicionado")),
            (lambda: t & (SINONIMOS_TIPO["camera"] | {"seguranca"}), lambda: self._categoria("cameras", "câmera")),
            (lambda: t & {"funcionando", "ligado", "ligados", "ligadas", "ativo", "ativos", "ativas"}, lambda: self._por_estado(True)),
            (lambda: t & {"desligado", "desligados", "desligadas", "inativos"}, lambda: self._por_estado(False)),
        ]
        for condicao, acao in regras:
            if condicao():
                return acao()

        dispositivos = self._achar_dispositivos(t)
        if len(dispositivos) == 1:
            return self._dispositivo(dispositivos[0])
        if t & {"casa", "status", "situacao", "geral", "tudo"} or "como esta" in n:
            return self._visao_geral()
        return self._r("Não encontrei essa informação nos dados da casa. " + self._exemplos())

    # ---------- utilidades ----------
    def _r(self, texto, itens=None, acao=None):
        return {"texto": texto, "itens": itens or [], "acao": acao, "motor": self.nome}

    def _exemplos(self):
        return ("Você pode perguntar, por exemplo: \"quantas luzes estão ligadas?\", \"existe alguma porta aberta?\", "
                "\"como está a garagem?\", \"qual cômodo consome mais energia?\", \"existem alertas?\", "
                "\"quais automações estão programadas?\" ou pedir \"desligar a luz da sala\".")

    def _linhas(self):
        return cerebro.snapshot()

    def _achar_dispositivos(self, t, so_portas_janelas=False):
        """Acha dispositivos citados: precisa do tipo (ou sinônimo) e, se houver
        mais de um daquele tipo, do cômodo ou de outra palavra do nome."""
        todos = Dispositivo.query.join(Comodo).all()
        achados = []
        for d in todos:
            sinon = SINONIMOS_TIPO.get(d.tipo, set())
            nome_tokens = tokens(d.nome) - PARADAS
            comodo_tokens = tokens(d.comodo.nome) - PARADAS
            if comodo_tokens & {"externa"}:
                comodo_tokens |= {"externo", "externa", "fora", "quintal"}
            tipo_citado = bool(t & sinon) or bool(t & (nome_tokens - comodo_tokens))
            if not tipo_citado:
                if so_portas_janelas and d.tipo in ("porta", "janela") and t & comodo_tokens:
                    achados.append(d)
                continue
            mesmos = [x for x in todos if x.tipo == d.tipo]
            if len(mesmos) == 1 or t & comodo_tokens or nome_tokens <= t:
                achados.append(d)
        # se citou o cômodo, prefere os do cômodo citado
        return achados

    # ---------- comandos (sempre só proposta) ----------
    def _comando(self, verbo, t, pergunta, usuario):
        achados = self._achar_dispositivos(t, so_portas_janelas=bool(t & {"abrir", "abra", "abre", "fechar", "feche", "fecha"}))
        if not achados:
            return self._r("Não identifiquei qual dispositivo você quer controlar. Diga o tipo e o cômodo, "
                           "por exemplo \"desligar a luz da sala\".")
        if len(achados) > 1:
            return self._r("Encontrei mais de um dispositivo. Qual deles?", [f"{d.nome} ({d.comodo.nome})" for d in achados])
        d = achados[0]
        ligar = verbo == "ligar"
        rotulo = cerebro.estado_legivel(d).lower()
        if d.ativo == ligar:
            return self._r(f"{d.nome} já está assim: {rotulo}. Nada a fazer.")
        if not d.pode_controlar(usuario):
            return self._r(f"Seu perfil não tem permissão para controlar {d.nome}. "
                           f"O PULSE AI segue as mesmas permissões do painel.")
        abrir_fechar = d.tipo in ("porta", "janela")
        verbo_txt = ("abrir" if ligar else "fechar") if abrir_fechar else ("ligar" if ligar else "desligar")
        return self._r(
            f"Posso {verbo_txt}: {d.nome} ({d.comodo.nome}), que agora está {rotulo}. Confirma?",
            acao={"dispositivo_id": d.id, "nome": d.nome, "acao": "ligar" if ligar else "desligar",
                  "rotulo": verbo_txt.capitalize(), "pedido": pergunta[:300]},
        )

    # ---------- respostas ----------
    def _luzes(self):
        luzes = [l for l in self._linhas() if l["categoria"] == "iluminacao"]
        ligadas = [l for l in luzes if l["ativo"]]
        if not ligadas:
            return self._r(f"Todas as {len(luzes)} luzes estão desligadas.")
        itens = [f"{l['nome']} ({l['comodo']}) — {l['estado']}" + (f", há {cerebro.duracao(l['minutos'])}" if l["minutos"] is not None else "")
                 for l in ligadas]
        return self._r(f"{len(ligadas)} de {len(luzes)} luzes estão ligadas.", itens)

    def _categoria(self, cat, nome):
        linhas = [l for l in self._linhas() if l["categoria"] == cat]
        if not linhas:
            return self._r(f"Não há {nome} cadastrada na casa.")
        itens = [f"{l['nome']} ({l['comodo']}): {l['estado']}" + (f" desde {l['desde_hm']}" if l["desde_hm"] else "") for l in linhas]
        if cat in ("portas", "janelas"):
            abertas = [l for l in linhas if l["ativo"]]
            texto = (f"Sim, {len(abertas)} {nome}(s) aberta(s)." if abertas else f"Não, todas as {nome}s estão fechadas.")
        else:
            ativos = [l for l in linhas if l["ativo"]]
            texto = f"{len(ativos)} de {len(linhas)} {nome}(s) em funcionamento."
        return self._r(texto, itens)

    def _por_estado(self, ativo):
        linhas = [l for l in self._linhas() if l["ativo"] == ativo]
        palavra = "funcionando (ligados/abertos)" if ativo else "desligados/fechados"
        return self._r(f"{len(linhas)} dispositivo(s) {palavra}:", [f"{l['nome']} ({l['comodo']}) — {l['estado']}" for l in linhas])

    def _dispositivo(self, d):
        l = next(x for x in self._linhas() if x["id"] == d.id)
        desde = f" desde {l['desde_hm']} (há {cerebro.duracao(l['minutos'])})" if l["desde_hm"] else ""
        return self._r(f"{d.nome} ({d.comodo.nome}): {l['estado']}{desde}.")

    def _garagem(self):
        g = cerebro.garagem(self._linhas())
        if g is None:
            return self._r("Não há porta de garagem cadastrada.")
        if g["aberta"]:
            texto = f"A {g['porta']} está aberta" + (f" desde {g['desde_hm']} (há {cerebro.duracao(g['minutos'])})." if g["desde_hm"] else ".")
        else:
            texto = f"A {g['porta']} está fechada" + (f" desde {g['desde_hm']}." if g["desde_hm"] else ".")
        itens = []
        if g["luz"]:
            itens.append(f"Luz da garagem: {g['luz']}")
        itens.append("Veículo: " + g["veiculo"])
        return self._r(texto, itens)

    def _alertas(self):
        abertos = cerebro._ordenar_alertas(cerebro.alertas_abertos())
        if not abertos:
            return self._r("Nenhum alerta pendente. Todos os dispositivos estão dentro dos limites configurados.")
        return self._r(f"{len(abertos)} alerta(s) pendente(s):",
                       [f"[{cerebro.ROTULO_PRIORIDADE[a.prioridade]}] {a.titulo} — {a.dispositivo.nome if a.dispositivo else 'casa'}"
                        for a in abertos])

    def _automacoes(self):
        autos = cerebro.automacoes_programadas()
        if not autos:
            return self._r("Não há automações ativas.")
        return self._r(f"{len(autos)} automação(ões) ativa(s), da próxima para a última:",
                       [f"{a['nome']} — {', '.join(a['acoes'])} ({a['proxima'] or a['horario']})" for a in autos])

    def _energia(self):
        agora = datetime.now(timezone.utc)
        inicio = agora - timedelta(days=7)
        por_comodo = {}
        for d, kwh in resumo_consumo(Dispositivo.query.all(), inicio, agora):
            por_comodo[d.comodo.nome] = por_comodo.get(d.comodo.nome, 0.0) + kwh
        ranking = sorted(por_comodo.items(), key=lambda x: x[1], reverse=True)
        if not ranking or ranking[0][1] == 0:
            return self._r("Ainda não há consumo registrado nos últimos 7 dias.")
        total = sum(k for _, k in ranking)
        return self._r(f"O cômodo que mais consumiu nos últimos 7 dias foi {ranking[0][0]}: "
                       f"{ranking[0][1]:.1f} kWh ({ranking[0][1] / total * 100:.0f}% do total).",
                       [f"{nome}: {kwh:.2f} kWh" for nome, kwh in ranking])

    def _recomendacoes(self):
        recs = cerebro.recomendacoes()
        if not recs:
            return self._r("Os dados atuais não indicam nenhuma melhoria clara.")
        return self._r("Com base no histórico da casa:", [f"{r['titulo']}: {r['justificativa']}" for r in recs[:4]])

    def _saude(self):
        s = cerebro.saude(self._linhas(), cerebro.alertas_abertos())
        itens = []
        if s["criticos"]:
            itens.append("Crítico: " + ", ".join(s["criticos"]))
        if s["atencao"]:
            itens.append("Atenção: " + ", ".join(s["atencao"]))
        return self._r(f"{s['operacionais']} de {s['total']} dispositivos operacionais "
                       f"(sem alerta de Atenção ou Crítico).", itens)

    def _resumo(self):
        r = cerebro.resumo_diario()
        itens = [f"Dispositivos usados hoje: {r['dispositivos_usados']} ({r['eventos']} mudanças de estado)",
                 f"Por pessoas: {r['por_pessoas']} · por automação: {r['por_automacao']}",
                 f"Consumo de hoje: {r['kwh']:.2f} kWh (R$ {r['custo']:.2f})",
                 f"Alertas hoje: {r['alertas']['critico']} crítico(s), {r['alertas']['atencao']} de atenção, {r['alertas']['info']} informativo(s)"]
        if r["automacoes_restantes"]:
            itens.append("Ainda hoje: " + ", ".join(r["automacoes_restantes"]))
        return self._r(f"Resumo de {r['data']}:", itens)

    def _linha_tempo(self):
        itens = cerebro.linha_do_tempo()[:8]
        if not itens:
            return self._r("Nada aconteceu nas últimas 24 horas.")
        return self._r("Últimos acontecimentos:", [f"{i['hm']} — {i['texto']} ({i['autor']})" for i in itens])

    def _saudacao(self):
        geral = self._visao_geral()
        geral["texto"] = ("Olá! Sou o PULSE AI e acompanho os dispositivos da casa em tempo real. "
                          + geral["texto"] + " " + self._exemplos())
        return geral

    def _visao_geral(self):
        linhas = self._linhas()
        ind = cerebro.indicadores(linhas, cerebro.alertas_abertos())
        itens = [f"Ligados: {ind['ligados']} · desligados: {ind['desligados']}",
                 f"Portas abertas: {ind['portas_abertas']} · janelas abertas: {ind['janelas_abertas']}",
                 f"Luz acesa em: {', '.join(ind['luzes_ligadas']) or 'nenhum cômodo'}",
                 f"Automações ativas: {ind['automacoes']}",
                 f"Dispositivos com alerta: {ind['com_alerta']}"]
        return self._r(f"A casa tem {ind['total']} dispositivos monitorados.", itens)


MOTORES = {"regras": MotorRegras}


def obter_motor():
    """Motor configurado em PULSE_AI_MOTOR. Se o nome não existir, cai no de
    regras (que não depende de nenhuma API externa)."""
    return MOTORES.get(current_app.config.get("PULSE_AI_MOTOR", "regras"), MotorRegras)()
