"""
Documentação da API (Swagger / OpenAPI 3).

A especificação fica em static/openapi.yaml, escrita à mão a partir das rotas
reais (auth.py, main.py, energia.py, pulse_ai.py). Esta rota só abre o
Swagger UI (carregado via CDN, como o Three.js da maquete) apontando para
esse arquivo — não existe pacote novo no requirements.txt.

Exige login: o "Try it out" usa a mesma sessão do sistema, e a página já
entrega o token CSRF para o Swagger mandar nos POST (header X-CSRFToken).
"""
from flask import Blueprint, render_template
from flask_login import login_required

bp = Blueprint("docs", __name__)


@bp.route("/api/docs")
@login_required
def swagger():
    return render_template("swagger.html")
