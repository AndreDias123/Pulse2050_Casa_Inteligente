"""
PULSE AI — o "cérebro" da residência.

Tudo aqui é calculado em cima dos dados reais do sistema, sem estrutura
paralela de dispositivos:

- estado atual        -> Dispositivo.ativo / status() (mesma herança do resto do app)
- "desde quando"      -> último evento ligou/desligou do RegistroUso
- tempo de uso        -> services.energia.intervalos_ligado (mesmo cálculo do kWh)
- automações          -> Automacao/AutomacaoAcao + helpers do services.agendador

A "inteligência" é um motor de regras transparente: cada alerta e cada
recomendação carrega a condição verificável que o gerou (limites em
config.py, PULSE_AI_*). Não existe modelo de linguagem conectado — o
assistente conversacional (services/pulse_ai_chat.py) responde com estes
mesmos dados.

Alertas são persistidos em AlertaAgente. A `chave` de cada alerta identifica
o episódio (dispositivo + momento em que a situação começou), então:
  - a mesma situação nunca gera dois alertas;
  - resolver manualmente não faz o alerta voltar enquanto a situação continuar;
  - quando a condição deixa de existir, o alerta é resolvido automaticamente
    (resolvido_por = None) e fica no histórico.
"""
import hashlib
import json
import threading
import time
from datetime import datetime, timedelta, timezone
from statistics import median
from zoneinfo import ZoneInfo

from flask import current_app

from extensions import db
from models import (
    AcaoAgente, AlertaAgente, ArCondicionado, Automacao, Camera, Comodo, Dispositivo,
    Janela, Luz, Porta, RegistroUso, RoboAspirador, TV,
)
from services.agendador import _dia_bate, proxima_automacao, rotulo_quando
from services.energia import (
    custo, gerar_alerta, horas_ligado, intervalos_ligado, resumo_consumo, tarifa_atual,
)

PESO = {"info": 1, "atencao": 2, "critico": 3}
ROTULO_PRIORIDADE = {"info": "Informativo", "atencao": "Atenção", "critico": "Crítico"}
ROTULO_TIPO = {
    "luz_tempo": "Iluminação", "porta_aberta": "Porta", "janela_aberta": "Janela",
    "ac_janela": "Climatização", "ac_tempo": "Climatização", "camera_off": "Segurança",
    "bateria": "Robô aspirador", "auto_nao_exec": "Automação",
}
CATEGORIAS = [
    ("iluminacao", "Iluminação"), ("portas", "Portas e garagem"), ("janelas", "Janelas"),
    ("clima", "Climatização"), ("cameras", "Câmeras"), ("outros", "Outros dispositivos"),
]


# ---------------------------------------------------------------------------
# utilidades de tempo
# ---------------------------------------------------------------------------
def _agora():
    return datetime.now(timezone.utc)


def _utc(ts):
    """O SQLite devolve datetime sem fuso; tudo no banco é UTC (models.agora)."""
    if ts is None:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def _tz():
    return ZoneInfo(current_app.config["TIMEZONE"])


def _hm(ts):
    return _utc(ts).astimezone(_tz()).strftime("%H:%M") if ts else None


def momento(ts):
    """'09:32' se for hoje, 'ontem 19:30' ou '02/11 06:33' — evita mostrar só
    a hora de algo que aconteceu em outro dia."""
    if ts is None:
        return None
    local = _utc(ts).astimezone(_tz())
    hoje = datetime.now(_tz()).date()
    if local.date() == hoje:
        return local.strftime("%H:%M")
    if local.date() == hoje - timedelta(days=1):
        return "ontem " + local.strftime("%H:%M")
    return local.strftime("%d/%m %H:%M")


def _iso(ts):
    return _utc(ts).isoformat() if ts else None


def duracao(minutos):
    """125 -> '2h 05min'; 40 -> '40 min'."""
    if minutos is None:
        return "tempo desconhecido"
    minutos = int(minutos)
    if minutos < 60:
        return f"{minutos} min"
    h, m = divmod(minutos, 60)
    if h >= 48:
        return f"{h // 24} dias"
    return f"{h}h {m:02d}min"


def _inicio_do_dia_local():
    agora_local = datetime.now(_tz())
    return agora_local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


# ---------------------------------------------------------------------------
# estado dos dispositivos
# ---------------------------------------------------------------------------
def categoria(d):
    if isinstance(d, Luz):
        return "iluminacao"
    if isinstance(d, Porta):
        return "portas"
    if isinstance(d, Janela):
        return "janelas"
    if isinstance(d, ArCondicionado):
        return "clima"
    if isinstance(d, Camera):
        return "cameras"
    return "outros"


def estado_legivel(d):
    """Texto do estado. Portas e janelas usam aberta/fechada — é o que o
    `ativo` representa na maquete (a porta da garagem sobe quando ativo)."""
    if isinstance(d, (Porta, Janela)):
        return "Aberta" if d.ativo else "Fechada"
    return d.status()


def ultimo_evento(d):
    return (
        RegistroUso.query.filter(
            RegistroUso.dispositivo_id == d.id,
            RegistroUso.evento.in_(("ligou", "desligou")),
        )
        .order_by(RegistroUso.timestamp.desc(), RegistroUso.id.desc())
        .first()
    )


def estado_desde(d):
    """Momento (UTC) em que o dispositivo entrou no estado atual, segundo o
    histórico. None quando o histórico não confirma (ex.: estado definido
    direto no banco, sem evento correspondente)."""
    ev = ultimo_evento(d)
    if ev is None:
        return None
    esperado = "ligou" if d.ativo else "desligou"
    return _utc(ev.timestamp) if ev.evento == esperado else None


def snapshot(usuario=None):
    """Lista de dispositivos com o estado atual e há quanto tempo estão nele."""
    agora = _agora()
    linhas = []
    for d in Dispositivo.query.join(Comodo).order_by(Comodo.id, Dispositivo.id).all():
        desde = estado_desde(d)
        linhas.append({
            "id": d.id,
            "nome": d.nome,
            "tipo": d.tipo,
            "categoria": categoria(d),
            "comodo": d.comodo.nome,
            "ativo": d.ativo,
            "estado": estado_legivel(d),
            "desde": _iso(desde),
            "desde_hm": momento(desde),
            "minutos": int((agora - desde).total_seconds() // 60) if desde else None,
            "pode_controlar": d.pode_controlar(usuario) if usuario else False,
            "_obj": d,
            "_desde": desde,
        })
    return linhas


def _publico(linhas):
    return [{k: v for k, v in linha.items() if not k.startswith("_")} for linha in linhas]


# ---------------------------------------------------------------------------
# automações
# ---------------------------------------------------------------------------
def _automacao_que_desliga(d):
    """Próxima execução de uma automação ativa que desliga `d`, se houver:
    (Automacao, datetime local)."""
    tz = _tz()
    agora_local = datetime.now(tz)
    melhor = (None, None)
    for auto in Automacao.query.filter_by(ativa=True).all():
        if not any(a.dispositivo_id == d.id and a.acao == "desligar" for a in auto.acoes):
            continue
        quando = _proxima_execucao(auto, agora_local)
        if quando and (melhor[1] is None or quando < melhor[1]):
            melhor = (auto, quando)
    return melhor


def _proxima_execucao(auto, agora_local):
    try:
        hora, minuto = (int(p) for p in auto.horario.split(":"))
    except (ValueError, AttributeError):
        return None
    for dias in range(8):
        dia = agora_local + timedelta(days=dias)
        if not _dia_bate(auto.dias_semana, dia.weekday()):
            continue
        quando = dia.replace(hour=hora, minute=minuto, second=0, microsecond=0)
        if quando > agora_local:
            return quando
    return None


def automacoes_programadas():
    tz = _tz()
    agora_local = datetime.now(tz)
    linhas = []
    for auto in Automacao.query.filter_by(ativa=True).order_by(Automacao.horario).all():
        quando = _proxima_execucao(auto, agora_local)
        linhas.append({
            "id": auto.id,
            "nome": auto.nome,
            "horario": auto.horario,
            "dias": auto.dias_semana,
            "acoes": [f"{'Liga' if a.acao == 'ligar' else 'Desliga'} {a.dispositivo.nome}"
                      for a in auto.acoes if a.dispositivo is not None],
            "proxima": rotulo_quando(quando, tz) if quando else None,
            "_quando": quando,
        })
    linhas.sort(key=lambda x: x["_quando"] or datetime.max.replace(tzinfo=tz))
    return linhas


# ---------------------------------------------------------------------------
# regras de alerta
# ---------------------------------------------------------------------------
def _candidato(chave, tipo, prioridade, d, titulo, descricao, sugestao):
    return {"chave": chave, "tipo": tipo, "prioridade": prioridade, "dispositivo": d,
            "titulo": titulo, "descricao": descricao, "sugestao": sugestao}


def avaliar(linhas=None):
    """Aplica as regras sobre o estado atual e devolve os alertas que deveriam
    estar abertos agora. Cada regra usa só dados verificáveis do banco."""
    cfg = current_app.config
    linhas = linhas if linhas is not None else snapshot()
    agora = _agora()
    cands = []

    def minutos(linha):
        return linha["minutos"]

    portas_abertas = [l for l in linhas if isinstance(l["_obj"], Porta) and l["ativo"]]

    for l in linhas:
        d, desde, mins = l["_obj"], l["_desde"], minutos(l)
        marca = desde.isoformat() if desde else "sem-historico"

        # 1. luz ligada há muito tempo
        if isinstance(d, Luz) and d.ativo and mins is not None and mins >= cfg["PULSE_AI_LUZ_HORAS"] * 60:
            auto, quando = _automacao_que_desliga(d)
            desc = (f"A {d.nome} ({d.comodo.nome}) está ligada desde {l['desde_hm']}, "
                    f"acima do limite de {cfg['PULSE_AI_LUZ_HORAS']:g}h.")
            if auto:
                cands.append(_candidato(
                    f"luz_tempo:{d.id}:{marca}", "luz_tempo", "info", d, "Luz ligada há bastante tempo",
                    desc + f" A automação \"{auto.nome}\" vai desligá-la {rotulo_quando(quando, _tz()).lower()}.",
                    "Nenhuma ação obrigatória; desligue antes se o cômodo estiver vazio."))
            else:
                cands.append(_candidato(
                    f"luz_tempo:{d.id}:{marca}", "luz_tempo", "atencao", d, "Luz ligada há muito tempo", desc,
                    "Desligue se o cômodo estiver vazio ou crie uma automação de desligamento."))

        # 2. porta aberta (garagem)
        if isinstance(d, Porta) and d.ativo:
            limite = cfg["PULSE_AI_PORTA_MINUTOS"]
            if mins is None:
                prio, titulo = "atencao", "Porta aberta sem registro de abertura"
                desc = f"A {d.nome} está aberta, mas o histórico não registra quando ela foi aberta."
            elif mins >= limite * 3:
                prio, titulo = "critico", "Porta aberta há muito tempo"
                desc = f"A {d.nome} está aberta desde {l['desde_hm']}, mais de {limite * 3:g} minutos."
            elif mins >= limite:
                prio, titulo = "atencao", "Porta aberta além do limite"
                desc = f"A {d.nome} está aberta desde {l['desde_hm']}, acima do limite de {limite:g} minutos."
            else:
                prio, titulo = "info", "Porta aberta"
                desc = f"A {d.nome} foi aberta às {l['desde_hm']}."
            cands.append(_candidato(f"porta_aberta:{d.id}:{marca}", "porta_aberta", prio, d, titulo, desc,
                                    "Feche a porta se não houver ninguém usando a garagem."))

        # 3. janela aberta
        if isinstance(d, Janela) and d.ativo:
            limite = cfg["PULSE_AI_JANELA_MINUTOS"]
            longa = mins is not None and mins >= limite
            desde_txt = f"desde {l['desde_hm']}" if desde else "(sem registro de abertura)"
            cands.append(_candidato(
                f"janela_aberta:{d.id}:{marca}", "janela_aberta", "atencao" if longa else "info", d,
                "Janela aberta há muito tempo" if longa else "Janela aberta",
                f"A {d.nome} ({d.comodo.nome}) está aberta {desde_txt}."
                + (f" Passou do limite de {limite:g} minutos." if longa else ""),
                "Feche a janela ao sair do cômodo ou se for chover."))

        # 4. ar-condicionado ligado com janela aberta no mesmo cômodo
        if isinstance(d, ArCondicionado) and d.ativo:
            janelas = [j for j in linhas if isinstance(j["_obj"], Janela) and j["ativo"] and j["comodo"] == l["comodo"]]
            for j in janelas:
                inicio = max(filter(None, [desde, j["_desde"]]), default=None)
                cands.append(_candidato(
                    f"ac_janela:{d.id}:{j['id']}:{inicio.isoformat() if inicio else 'sem-historico'}",
                    "ac_janela", "atencao", d, "Ar-condicionado ligado com janela aberta",
                    f"O {d.nome} está ligado enquanto a {j['nome']} está aberta ({l['comodo']}). "
                    f"Parte do ar climatizado se perde.",
                    "Feche a janela ou desligue o ar-condicionado."))

            # 5. ar-condicionado ligado há muito tempo
            if mins is not None and mins >= cfg["PULSE_AI_AC_HORAS"] * 60:
                auto, quando = _automacao_que_desliga(d)
                cands.append(_candidato(
                    f"ac_tempo:{d.id}:{marca}", "ac_tempo", "info" if auto else "atencao", d,
                    "Ar-condicionado ligado há muito tempo",
                    f"O {d.nome} está ligado desde {l['desde_hm']}, acima de {cfg['PULSE_AI_AC_HORAS']:g}h.",
                    "Considere uma automação de desligamento no fim da madrugada."))

        # 6. câmera desligada (crítico se houver porta aberta ao mesmo tempo)
        if isinstance(d, Camera) and not d.ativo:
            critico = bool(portas_abertas)
            cands.append(_candidato(
                f"camera_off:{d.id}:{marca}", "camera_off", "critico" if critico else "atencao", d,
                "Câmera desligada com porta aberta" if critico else "Câmera desligada",
                f"A {d.nome} ({d.comodo.nome}) está desligada"
                + (f" desde {l['desde_hm']}" if desde else "")
                + (f", enquanto a {portas_abertas[0]['nome']} está aberta." if critico else "."),
                "Religue a câmera para manter o monitoramento da casa."))

        # 7. bateria baixa do robô aspirador (atributo real do dispositivo)
        if isinstance(d, RoboAspirador):
            bateria = (d.atributos_extra or {}).get("bateria")
            if isinstance(bateria, (int, float)) and bateria < cfg["PULSE_AI_BATERIA_MIN"]:
                dia = datetime.now(_tz()).date().isoformat()
                cands.append(_candidato(
                    f"bateria:{d.id}:{dia}", "bateria", "atencao", d, "Bateria baixa do robô aspirador",
                    f"A bateria do {d.nome} está em {bateria}%, abaixo de {cfg['PULSE_AI_BATERIA_MIN']}%.",
                    "Deixe o robô na base até completar a carga."))

    # 8. automação que deveria ter rodado hoje e não tem registro de execução
    cands.extend(_automacoes_nao_executadas(agora))
    return cands


def _automacoes_nao_executadas(agora):
    """Uma automação ativa cujo horário de hoje já passou (há mais de 5 min e
    menos de 12 h) é considerada não executada quando: não existe RegistroUso
    de automação (usuario_id nulo) perto do horário E o dispositivo não está
    no estado que ela deveria ter deixado. Acontece, por exemplo, se o
    servidor estava desligado no horário."""
    tz = _tz()
    agora_local = agora.astimezone(tz)
    cands = []
    for auto in Automacao.query.filter_by(ativa=True).all():
        if not _dia_bate(auto.dias_semana, agora_local.weekday()):
            continue
        try:
            hora, minuto = (int(p) for p in auto.horario.split(":"))
        except (ValueError, AttributeError):
            continue
        previsto = agora_local.replace(hour=hora, minute=minuto, second=0, microsecond=0)
        if not (timedelta(minutes=5) <= agora_local - previsto <= timedelta(hours=12)):
            continue
        previsto_utc = previsto.astimezone(timezone.utc)
        for acao in auto.acoes:
            d = acao.dispositivo
            if d is None:
                continue
            esperado_ativo = acao.acao == "ligar"
            if d.ativo == esperado_ativo:
                continue
            evento = "ligou" if esperado_ativo else "desligou"
            executou = RegistroUso.query.filter(
                RegistroUso.dispositivo_id == d.id,
                RegistroUso.evento == evento,
                RegistroUso.usuario_id.is_(None),
                RegistroUso.timestamp >= (previsto_utc - timedelta(minutes=2)).replace(tzinfo=None),
                RegistroUso.timestamp <= (previsto_utc + timedelta(minutes=5)).replace(tzinfo=None),
            ).first()
            if executou:
                continue
            cands.append(_candidato(
                f"auto_nao_exec:{auto.id}:{d.id}:{previsto.date().isoformat()}", "auto_nao_exec", "info", d,
                "Automação sem registro de execução",
                f"A automação \"{auto.nome}\" deveria ter {'ligado' if esperado_ativo else 'desligado'} "
                f"a {d.nome} às {auto.horario}, mas não há registro disso e o dispositivo está "
                f"{estado_legivel(d).lower()}.",
                "Verifique se o servidor estava ativo no horário ou ajuste o dispositivo manualmente."))
    return cands


# ---------------------------------------------------------------------------
# sincronização dos alertas com o banco
# ---------------------------------------------------------------------------
_lock = threading.Lock()
_ultima_sync = 0.0


def sincronizar(linhas=None):
    """Grava os alertas novos, atualiza a prioridade dos abertos e resolve
    automaticamente os que deixaram de valer. Devolve True se mudou algo."""
    global _ultima_sync
    with _lock:
        cands = avaliar(linhas)
        por_chave = {c["chave"]: c for c in cands}
        existentes = {a.chave: a for a in AlertaAgente.query.filter(AlertaAgente.chave.in_(list(por_chave))).all()} \
            if por_chave else {}
        mudou = False
        agora = _agora()

        for chave, c in por_chave.items():
            a = existentes.get(chave)
            if a is None:
                db.session.add(AlertaAgente(
                    chave=chave, tipo=c["tipo"], prioridade=c["prioridade"],
                    dispositivo_id=c["dispositivo"].id if c["dispositivo"] else None,
                    titulo=c["titulo"], descricao=c["descricao"], sugestao=c["sugestao"],
                ))
                mudou = True
            elif a.status != "resolvido" and (a.prioridade, a.titulo, a.descricao) != (c["prioridade"], c["titulo"], c["descricao"]):
                if PESO[c["prioridade"]] > PESO[a.prioridade] and a.status == "visto":
                    a.status = "ativo"  # escalou: volta a pedir atenção
                a.prioridade, a.titulo, a.descricao, a.sugestao = c["prioridade"], c["titulo"], c["descricao"], c["sugestao"]
                mudou = True

        for a in AlertaAgente.query.filter(AlertaAgente.status != "resolvido").all():
            if a.chave not in por_chave:
                a.status, a.resolvido_em, a.resolvido_por_id = "resolvido", agora, None
                mudou = True

        if mudou:
            db.session.commit()
        _ultima_sync = time.monotonic()
        return mudou


def sincronizar_se_preciso(intervalo=10):
    """Evita reavaliar a casa a cada requisição: no máximo uma vez a cada
    `intervalo` segundos (o agendador também roda a cada minuto)."""
    if time.monotonic() - _ultima_sync >= intervalo:
        sincronizar()


def registrar_monitor(scheduler, app):
    """Agenda a avaliação periódica no mesmo APScheduler das automações, pra
    os alertas serem detectados mesmo sem ninguém com a página aberta."""
    from apscheduler.triggers.cron import CronTrigger

    def _tick():
        with app.app_context():
            sincronizar()

    scheduler.add_job(_tick, trigger=CronTrigger(second=30), id="pulse_ai", replace_existing=True)


def garantir_tabelas(app):
    """Cria só as tabelas novas do PULSE AI num banco já existente, sem tocar
    nos dados atuais (CREATE TABLE IF NOT EXISTS)."""
    with app.app_context():
        for tabela in (AlertaAgente.__table__, AcaoAgente.__table__):
            tabela.create(db.engine, checkfirst=True)


# ---------------------------------------------------------------------------
# leitura para a interface
# ---------------------------------------------------------------------------
def _nome_autor(usuario_id, usuario, nome):
    """Não expõe quem fez o quê para o Usuário Comum (só 'Você')."""
    if usuario_id is None:
        return "Automação"
    if usuario and usuario_id == usuario.id:
        return "Você"
    if usuario and usuario.is_admin:
        return nome
    return "Outro morador"


def alerta_dict(a, usuario=None):
    d = a.dispositivo
    return {
        "id": a.id,
        "tipo": a.tipo,
        "tipo_rotulo": ROTULO_TIPO.get(a.tipo, a.tipo),
        "prioridade": a.prioridade,
        "prioridade_rotulo": ROTULO_PRIORIDADE[a.prioridade],
        "dispositivo": {"id": d.id, "nome": d.nome} if d else None,
        "comodo": d.comodo.nome if d else None,
        "titulo": a.titulo,
        "descricao": a.descricao,
        "sugestao": a.sugestao,
        "status": a.status,
        "detectado_em": _iso(a.detectado_em),
        "detectado_hm": _hm(a.detectado_em),
        "detectado_data": _utc(a.detectado_em).astimezone(_tz()).strftime("%d/%m"),
        "resolvido_hm": _hm(a.resolvido_em),
        "resolvido_por": (None if a.status != "resolvido" else
                          "Automático (condição normalizada)" if a.resolvido_por_id is None else
                          _nome_autor(a.resolvido_por_id, usuario, a.resolvido_por.nome if a.resolvido_por else "")),
        "pode_gerenciar": pode_gerenciar(a, usuario),
    }


def pode_gerenciar(alerta, usuario):
    """Marcar como visto/resolvido segue a mesma regra de controlar o
    dispositivo — quem não pode mexer no aparelho não fecha o alerta dele."""
    if usuario is None:
        return False
    if alerta.dispositivo is None:
        return usuario.is_admin
    return alerta.dispositivo.pode_controlar(usuario)


def alertas_abertos():
    return (AlertaAgente.query.filter(AlertaAgente.status != "resolvido")
            .order_by(AlertaAgente.detectado_em.desc()).all())


def _ordenar_alertas(alertas):
    return sorted(alertas, key=lambda a: (-PESO[a.prioridade], a.status == "visto", -_utc(a.detectado_em).timestamp()))


def indicadores(linhas, abertos):
    def conta(cat, ativo):
        return sum(1 for l in linhas if l["categoria"] == cat and l["ativo"] == ativo)

    return {
        "total": len(linhas),
        "ligados": sum(1 for l in linhas if l["ativo"]),
        "desligados": sum(1 for l in linhas if not l["ativo"]),
        "portas_abertas": conta("portas", True),
        "portas_fechadas": conta("portas", False),
        "janelas_abertas": conta("janelas", True),
        "janelas_fechadas": conta("janelas", False),
        "com_alerta": len({a.dispositivo_id for a in abertos if a.dispositivo_id}),
        "automacoes": Automacao.query.filter_by(ativa=True).count(),
        "luzes_ligadas": [l["comodo"] for l in linhas if l["categoria"] == "iluminacao" and l["ativo"]],
    }


def saude(linhas, abertos):
    """Critério transparente (sem 'nota' inventada): um dispositivo está
    operacional quando não tem alerta aberto de Atenção ou Crítico."""
    pior = {}
    for a in abertos:
        if a.dispositivo_id:
            pior[a.dispositivo_id] = max(pior.get(a.dispositivo_id, 0), PESO[a.prioridade])
    criticos = [l["nome"] for l in linhas if pior.get(l["id"]) == 3]
    atencao = [l["nome"] for l in linhas if pior.get(l["id"]) == 2]
    operacionais = len(linhas) - len(criticos) - len(atencao)
    return {
        "total": len(linhas),
        "operacionais": operacionais,
        "atencao": atencao,
        "criticos": criticos,
        "percentual": round(operacionais / len(linhas) * 100) if linhas else 100,
        "criterios": [
            "Operacional: sem alerta aberto de Atenção ou Crítico.",
            "Atenção: estado fora do limite configurado (ex.: luz acesa há mais de "
            f"{current_app.config['PULSE_AI_LUZ_HORAS']:g}h, porta aberta há mais de "
            f"{current_app.config['PULSE_AI_PORTA_MINUTOS']:g} min).",
            "Crítico: situação de risco (porta aberta há muito tempo, câmera desligada com porta aberta).",
            "O sistema não recebe diagnóstico de hardware: a avaliação usa só estado e histórico.",
        ],
    }


def garagem(linhas):
    porta = next((l for l in linhas if isinstance(l["_obj"], Porta)), None)
    if porta is None:
        return None
    luz = next((l for l in linhas if l["categoria"] == "iluminacao" and l["comodo"] == porta["comodo"]), None)
    return {
        "porta": porta["nome"],
        "aberta": porta["ativo"],
        "desde_hm": porta["desde_hm"],
        "minutos": porta["minutos"],
        "luz": luz["estado"] if luz else None,
        "veiculo": "Sem sensor no banco: o carro é uma animação da maquete e acompanha a porta.",
    }


def resumo_diario(usuario=None):
    inicio = _inicio_do_dia_local()
    agora = _agora()
    eventos = RegistroUso.query.filter(RegistroUso.timestamp >= inicio.replace(tzinfo=None)).all()
    alertas_hoje = AlertaAgente.query.filter(AlertaAgente.detectado_em >= inicio.replace(tzinfo=None)).all()
    dispositivos = Dispositivo.query.all()
    kwh = sum(k for _, k in resumo_consumo(dispositivos, inicio, agora))

    tz = _tz()
    agora_local = datetime.now(tz)
    restantes = []
    for auto in Automacao.query.filter_by(ativa=True).all():
        quando = _proxima_execucao(auto, agora_local)
        if quando and quando.date() == agora_local.date():
            restantes.append(f"{auto.nome} às {auto.horario}")

    principais = _ordenar_alertas(alertas_hoje)[:3]
    return {
        "data": agora_local.strftime("%d/%m/%Y"),
        "dispositivos_usados": len({e.dispositivo_id for e in eventos}),
        "eventos": len(eventos),
        "por_pessoas": sum(1 for e in eventos if e.usuario_id is not None),
        "por_automacao": sum(1 for e in eventos if e.usuario_id is None),
        "alertas": {p: sum(1 for a in alertas_hoje if a.prioridade == p) for p in PESO},
        "principais": [f"{a.titulo} — {a.dispositivo.nome if a.dispositivo else ''} ({_hm(a.detectado_em)})" for a in principais],
        "automacoes_restantes": sorted(restantes, key=lambda s: s[-5:]),
        "kwh": round(kwh, 2),
        "custo": round(custo(kwh, tarifa_atual()), 2),
    }


_VERBOS = {
    "luz": ("ligada", "desligada"), "porta": ("aberta", "fechada"), "janela": ("aberta", "fechada"),
    "camera": ("ligada", "desligada"), "robo_aspirador": ("começou a limpar", "voltou para a base"),
}


def linha_do_tempo(usuario=None, horas=24, limite=40):
    desde = (_agora() - timedelta(hours=horas)).replace(tzinfo=None)
    itens = []
    for e in (RegistroUso.query.filter(RegistroUso.timestamp >= desde)
              .order_by(RegistroUso.timestamp.desc()).limit(limite).all()):
        d = e.dispositivo
        if e.evento == "ajustou":
            texto = f"{d.nome}: intensidade ajustada para {(e.valor or {}).get('intensidade', '?')}%"
        else:
            liga, desliga = _VERBOS.get(d.tipo, ("ligado", "desligado"))
            texto = f"{d.nome} {liga if e.evento == 'ligou' else desliga}"
        itens.append({"ts": _iso(e.timestamp), "hm": momento(e.timestamp), "tipo": "estado",
                      "texto": texto, "autor": _nome_autor(e.usuario_id, usuario, e.usuario.nome if e.usuario else "")})

    for a in AlertaAgente.query.filter(AlertaAgente.detectado_em >= desde).all():
        itens.append({"ts": _iso(a.detectado_em), "hm": momento(a.detectado_em), "tipo": "alerta",
                      "prioridade": a.prioridade, "texto": f"PULSE AI detectou: {a.titulo} ({a.dispositivo.nome if a.dispositivo else 'casa'})",
                      "autor": "PULSE AI"})
    for a in AlertaAgente.query.filter(AlertaAgente.resolvido_em >= desde).all():
        itens.append({"ts": _iso(a.resolvido_em), "hm": momento(a.resolvido_em), "tipo": "resolvido",
                      "texto": f"Alerta resolvido: {a.titulo} ({a.dispositivo.nome if a.dispositivo else 'casa'})",
                      "autor": "PULSE AI" if a.resolvido_por_id is None else
                      _nome_autor(a.resolvido_por_id, usuario, a.resolvido_por.nome if a.resolvido_por else "")})
    for ac in AcaoAgente.query.filter(AcaoAgente.timestamp >= desde).all():
        itens.append({"ts": _iso(ac.timestamp), "hm": momento(ac.timestamp), "tipo": "acao",
                      "texto": f"PULSE AI executou: {ac.acao} {ac.dispositivo.nome}",
                      "autor": _nome_autor(ac.usuario_id, usuario, ac.usuario.nome)})

    itens.sort(key=lambda i: i["ts"], reverse=True)
    return itens[:limite]


# ---------------------------------------------------------------------------
# recomendações (cada uma com a justificativa calculada)
# ---------------------------------------------------------------------------
def _minuto_local(ts, tz):
    t = ts.astimezone(tz)
    return t.hour * 60 + t.minute


def _mediana_circular(minutos):
    """Mediana de horários que cruzam a meia-noite (23:30, 00:15...):
    desloca o eixo pro meio-dia antes de calcular."""
    deslocados = [(m + 720) % 1440 for m in minutos]
    return (int(median(deslocados)) - 720) % 1440


def _hhmm(minuto):
    return f"{minuto // 60:02d}:{minuto % 60:02d}"


def _perto(m, alvo, tolerancia=30):
    diff = abs(m - alvo) % 1440
    return min(diff, 1440 - diff) <= tolerancia


def recomendacoes():
    cfg = current_app.config
    tz = _tz()
    agora = _agora()
    inicio14, inicio7 = agora - timedelta(days=14), agora - timedelta(days=7)
    dispositivos = Dispositivo.query.join(Comodo).order_by(Comodo.id, Dispositivo.id).all()
    automacoes = Automacao.query.filter_by(ativa=True).all()
    acoes_por_disp = {}
    for auto in automacoes:
        for a in auto.acoes:
            acoes_por_disp.setdefault(a.dispositivo_id, []).append((auto, a.acao))
    recs = []

    # 1. consumo: quem pesa mais na conta da semana
    linhas = resumo_consumo(dispositivos, inicio7, agora)
    total = sum(k for _, k in linhas)
    tarifa = tarifa_atual()
    if total > 0:
        top, kwh_top = linhas[0]
        recs.append({
            "categoria": "Energia",
            "titulo": f"{top.nome} é o maior consumidor da semana",
            "justificativa": f"{kwh_top:.1f} kWh de {total:.1f} kWh nos últimos 7 dias "
                             f"({kwh_top / total * 100:.0f}% do total, R$ {custo(kwh_top, tarifa):.2f}).",
            "sugestao": "Reduzir 1 hora por dia de uso desse aparelho é a economia de maior efeito na conta.",
        })
    alerta = gerar_alerta(dispositivos, inicio7, agora)
    if alerta:
        recs.append({
            "categoria": "Energia",
            "titulo": f"Consumo do {alerta['dispositivo'].nome} subiu {alerta['variacao']:.0f}%",
            "justificativa": f"Comparação dos últimos 7 dias com os 7 anteriores: "
                             f"{alerta['kwh_atual']:.1f} kWh nesta semana.",
            "sugestao": "Revise os horários de uso ou crie uma automação de desligamento.",
        })

    # 2. tempo de uso (exclui o que fica ligado o tempo todo por natureza)
    uso = []
    for d in dispositivos:
        if isinstance(d, Camera) or d.tipo == "eletrodomestico":
            continue
        h = horas_ligado(d, inicio7, agora)
        if h > 0:
            uso.append((d, h))
    uso.sort(key=lambda x: x[1], reverse=True)
    if uso:
        recs.append({
            "categoria": "Padrão de uso",
            "titulo": "Dispositivos com maior tempo de utilização",
            "justificativa": "Últimos 7 dias: " + ", ".join(f"{d.nome} {h:.1f}h" for d, h in uso[:3]) + ".",
            "sugestao": f"Média diária do primeiro da lista: {uso[0][1] / 7:.1f}h. "
                        "Use isso como referência ao montar automações.",
        })

    # 3. luzes esquecidas + 4. sugestão de horário de automação
    for d in dispositivos:
        if not isinstance(d, (Luz, TV)):
            continue
        sessoes = intervalos_ligado(d, inicio14, agora)
        if len(sessoes) < 5:
            continue
        acoes = acoes_por_disp.get(d.id, [])
        tem_desligar = any(acao == "desligar" for _, acao in acoes)

        longas = [s for s in sessoes
                  if (s[1] - s[0]) >= timedelta(hours=cfg["PULSE_AI_LUZ_HORAS"])
                  or s[1].astimezone(tz).date() != s[0].astimezone(tz).date()]
        if isinstance(d, Luz) and not tem_desligar and len(longas) >= 3:
            media = sum((b - a).total_seconds() for a, b in sessoes) / len(sessoes) / 3600
            recs.append({
                "categoria": "Iluminação",
                "titulo": f"{d.nome} costuma ficar acesa por muito tempo",
                "justificativa": f"Em {len(longas)} dos {len(sessoes)} usos dos últimos 14 dias ela passou de "
                                 f"{cfg['PULSE_AI_LUZ_HORAS']:g}h ou da meia-noite (média de {media:.1f}h por uso).",
                "sugestao": f"Uma automação de desligamento no cômodo {d.comodo.nome} evitaria esquecimentos.",
            })

        if acoes:
            continue
        inicios = [_minuto_local(a, tz) for a, _ in sessoes]
        fins = [_minuto_local(b, tz) for _, b in sessoes]
        m_ini, m_fim = _mediana_circular(inicios), _mediana_circular(fins)
        regulares = sum(1 for i, f in zip(inicios, fins) if _perto(i, m_ini) and _perto(f, m_fim))
        if regulares / len(sessoes) >= 0.7:
            recs.append({
                "categoria": "Automação",
                "titulo": f"Horário sugerido para automatizar: {d.nome}",
                "justificativa": f"Em {regulares} de {len(sessoes)} usos nos últimos 14 dias ela foi ligada perto "
                                 f"das {_hhmm(m_ini)} e desligada perto das {_hhmm(m_fim)} (±30 min).",
                "sugestao": f"Criar as automações \"ligar às {_hhmm(m_ini)}\" e \"desligar às {_hhmm(m_fim)}\" "
                            f"reproduziria esse padrão.",
            })

    # 5. automação que liga mas nada desliga
    for auto in automacoes:
        for a in auto.acoes:
            if a.acao != "ligar" or a.dispositivo is None:
                continue
            if any(acao == "desligar" for _, acao in acoes_por_disp.get(a.dispositivo_id, [])):
                continue
            recs.append({
                "categoria": "Automação",
                "titulo": f"\"{auto.nome}\" liga {a.dispositivo.nome}, mas nada a desliga",
                "justificativa": f"Existe automação para ligar às {auto.horario} e nenhuma automação ativa de desligamento.",
                "sugestao": "Crie a automação de desligamento correspondente na tela do dispositivo.",
            })
    return recs


# ---------------------------------------------------------------------------
# payloads da API
# ---------------------------------------------------------------------------
def estado_completo(usuario):
    linhas = snapshot(usuario)
    abertos = alertas_abertos()
    historico = (AlertaAgente.query.filter(AlertaAgente.status == "resolvido")
                 .order_by(AlertaAgente.resolvido_em.desc()).limit(30).all())
    autos = automacoes_programadas()
    payload = {
        "indicadores": indicadores(linhas, abertos),
        "dispositivos": _publico(linhas),
        "categorias": [{"id": c, "nome": n} for c, n in CATEGORIAS],
        "alertas_ativos": [alerta_dict(a, usuario) for a in _ordenar_alertas(abertos)],
        "alertas_historico": [alerta_dict(a, usuario) for a in historico],
        "saude": saude(linhas, abertos),
        "garagem": garagem(linhas),
        "automacoes": [{k: v for k, v in x.items() if not k.startswith("_")} for x in autos],
        "resumo": resumo_diario(usuario),
        "linha_do_tempo": linha_do_tempo(usuario),
    }
    # `versao` muda só quando o conteúdo muda: a tela não redesenha à toa.
    payload["versao"] = hashlib.md5(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    agora_local = datetime.now(_tz())
    payload["atualizado_hm"] = agora_local.strftime("%H:%M:%S")
    payload["status"] = status_geral(abertos)
    return payload


def status_geral(abertos):
    if not abertos:
        return "ok"
    return max((a.prioridade for a in abertos), key=lambda p: PESO[p])


def badge():
    """Resumo mínimo pro ícone do PULSE AI no menu e no painel."""
    sincronizar_se_preciso()
    abertos = alertas_abertos()
    importantes = [a for a in abertos if a.prioridade in ("atencao", "critico") and a.status == "ativo"]
    return {
        "status": status_geral(abertos),
        "alertas": len(abertos),
        "importantes": len(importantes),
        "monitorados": Dispositivo.query.count(),
    }


def maquete():
    """O que a maquete 3D precisa pra sinalizar: alertas por dispositivo,
    pior prioridade por cômodo, cômodos com luz acesa e o que está aberto."""
    linhas = snapshot()
    abertos = alertas_abertos()
    comodos = {}
    for a in abertos:
        if a.dispositivo and a.prioridade in ("atencao", "critico"):
            nome = a.dispositivo.comodo.nome
            if PESO[a.prioridade] > PESO.get(comodos.get(nome), 0):
                comodos[nome] = a.prioridade
    return {
        "status": status_geral(abertos),
        "alertas": [{"dispositivo": a.dispositivo.nome, "prioridade": a.prioridade, "titulo": a.titulo,
                     "comodo": a.dispositivo.comodo.nome} for a in _ordenar_alertas(abertos) if a.dispositivo],
        "comodos": comodos,
        "luzes_por_comodo": sorted({l["comodo"] for l in linhas if l["categoria"] == "iluminacao" and l["ativo"]}),
        "abertos": [{"dispositivo": l["nome"], "tipo": l["categoria"]} for l in linhas
                    if l["categoria"] in ("portas", "janelas") and l["ativo"]],
    }
