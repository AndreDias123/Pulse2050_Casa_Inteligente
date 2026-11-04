"""
Rotas do PULSE AI — a página do agente e a API que ela, o painel e a
maquete 3D consultam. A lógica fica em services/pulse_ai.py (monitoramento,
alertas, recomendações) e services/pulse_ai_chat.py (assistente).

Segurança: tudo exige login (Flask-Login), os POST passam pelo CSRF do
Flask-WTF (header X-CSRFToken, igual à maquete) e qualquer ação sobre um
dispositivo usa Dispositivo.pode_controlar() — a mesma regra do painel.
"""
from datetime import datetime, timezone

from flask import Blueprint, abort, current_app, g, jsonify, render_template, request
from flask_login import current_user, login_required

from extensions import db
from models import AcaoAgente, AlertaAgente, Dispositivo
from services import pulse_ai as cerebro
from services.pulse_ai_chat import obter_motor

bp = Blueprint("pulse_ai", __name__, url_prefix="/pulse-ai")


@bp.record_once
def _preparar(state):
    # banco antigo (criado antes do PULSE AI): cria só as tabelas novas
    cerebro.garantir_tabelas(state.app)


@bp.app_context_processor
def _injetar_badge():
    """Disponibiliza pulse_ai_badge() nos templates (menu lateral e painel).
    Calculado só quando o template chama; qualquer falha aqui não pode
    derrubar as outras páginas do sistema."""
    def pulse_ai_badge():
        if "pulse_ai_badge" in g:  # menu e painel usam na mesma página: calcula uma vez só
            return g.pulse_ai_badge
        try:
            g.pulse_ai_badge = cerebro.badge()
            return g.pulse_ai_badge
        except Exception:  # noqa: BLE001 - o menu nunca pode quebrar a página
            current_app.logger.exception("PULSE AI: falha ao calcular o badge")
            db.session.rollback()
            return {"status": "ok", "alertas": 0, "importantes": 0, "monitorados": 0}
    return {"pulse_ai_badge": pulse_ai_badge}


@bp.route("/")
@login_required
def painel():
    motor = obter_motor()
    cfg = current_app.config
    limites = {
        "luz_horas": cfg["PULSE_AI_LUZ_HORAS"], "porta_min": cfg["PULSE_AI_PORTA_MINUTOS"],
        "janela_min": cfg["PULSE_AI_JANELA_MINUTOS"], "ac_horas": cfg["PULSE_AI_AC_HORAS"],
    }
    return render_template("pulse_ai.html", motor=motor, limites=limites)


@bp.route("/api/estado")
@login_required
def api_estado():
    cerebro.sincronizar_se_preciso(intervalo=5)
    return jsonify(cerebro.estado_completo(current_user))


@bp.route("/api/recomendacoes")
@login_required
def api_recomendacoes():
    return jsonify(cerebro.recomendacoes())


@bp.route("/api/badge")
@login_required
def api_badge():
    return jsonify(cerebro.badge())


@bp.route("/api/maquete")
@login_required
def api_maquete():
    cerebro.sincronizar_se_preciso(intervalo=5)
    return jsonify(cerebro.maquete())


@bp.route("/api/alertas/<int:alerta_id>/<acao>", methods=["POST"])
@login_required
def api_alerta(alerta_id, acao):
    if acao not in ("visto", "resolver"):
        abort(404)
    alerta = db.session.get(AlertaAgente, alerta_id)
    if alerta is None:
        abort(404)
    if not cerebro.pode_gerenciar(alerta, current_user):
        return jsonify({"erro": "Seu perfil não pode gerenciar alertas deste dispositivo."}), 403
    if alerta.status == "resolvido":
        return jsonify(cerebro.alerta_dict(alerta, current_user))

    agora = datetime.now(timezone.utc)
    if acao == "visto":
        alerta.status, alerta.visto_em = "visto", agora
    else:
        alerta.status, alerta.resolvido_em, alerta.resolvido_por_id = "resolvido", agora, current_user.id
    db.session.commit()
    return jsonify(cerebro.alerta_dict(alerta, current_user))


@bp.route("/api/chat", methods=["POST"])
@login_required
def api_chat():
    dados = request.get_json(silent=True) or {}
    pergunta = (dados.get("mensagem") or "").strip()[:500]
    return jsonify(obter_motor().responder(pergunta, current_user))


@bp.route("/api/executar", methods=["POST"])
@login_required
def api_executar():
    """Executa uma ação proposta pelo assistente, depois da confirmação na
    tela. Revalida tudo no servidor: dispositivo, ação e permissão."""
    dados = request.get_json(silent=True) or {}
    acao = dados.get("acao")
    try:
        dispositivo = db.session.get(Dispositivo, int(dados.get("dispositivo_id")))
    except (TypeError, ValueError):
        dispositivo = None
    if dispositivo is None or acao not in ("ligar", "desligar"):
        return jsonify({"erro": "Pedido inválido."}), 400
    if not dispositivo.pode_controlar(current_user):
        return jsonify({"erro": f"Seu perfil não tem permissão para controlar {dispositivo.nome}."}), 403

    if dispositivo.ativo != (acao == "ligar"):
        # mesmo ligar()/desligar() do painel -> RegistroUso com o usuário
        getattr(dispositivo, acao)(current_user)
        db.session.add(AcaoAgente(usuario_id=current_user.id, dispositivo_id=dispositivo.id, acao=acao,
                                  pedido=(dados.get("pedido") or "")[:300]))
        db.session.commit()
        cerebro.sincronizar()
        texto = f"Pronto: {dispositivo.nome} agora está {cerebro.estado_legivel(dispositivo).lower()}."
    else:
        texto = f"{dispositivo.nome} já estava {cerebro.estado_legivel(dispositivo).lower()}."
    return jsonify({"texto": texto, "itens": [], "acao": None, "motor": "regras",
                    "dispositivo": {"id": dispositivo.id, "ativo": dispositivo.ativo}})
