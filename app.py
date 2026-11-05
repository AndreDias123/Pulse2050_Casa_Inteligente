from flask import Flask
from flask_login import current_user
from flask_wtf import CSRFProtect
from flask_wtf.csrf import generate_csrf
from markupsafe import Markup

from config import Config
from extensions import db, login_manager
from models import Usuario
from services.agendador import iniciar_agendador

csrf = CSRFProtect()


def create_app(config_class=Config):
    # "Application factory": monta o app aqui dentro de uma função (em vez de
    # direto no módulo) pra dar pra criar instâncias diferentes com configs
    # diferentes — por exemplo, os testes poderiam usar um banco separado.
    app = Flask(__name__)
    app.config.from_object(config_class)

    # Liga as extensões (banco, login, CSRF) a este app específico. Elas
    # foram criadas "vazias" em extensions.py pra evitar importação circular.
    db.init_app(app)
    login_manager.init_app(app)
    csrf.init_app(app)

    # Os blueprints (grupos de rotas) só são importados aqui dentro, e não lá
    # em cima do arquivo — eles importam models.py, que importa db de
    # extensions.py; importar antes do Flask existir causaria um ciclo.
    from auth import bp as auth_bp
    from main import bp as main_bp
    from energia import bp as energia_bp
    from pulse_ai import bp as pulse_ai_bp
    from docs import bp as docs_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(main_bp)
    app.register_blueprint(energia_bp)
    app.register_blueprint(pulse_ai_bp)
    app.register_blueprint(docs_bp)  # Swagger: /api/docs

    # Flask-Login chama isso pra recarregar o usuário logado a partir do id
    # guardado na sessão, a cada requisição.
    @login_manager.user_loader
    def carregar_usuario(usuario_id):
        return db.session.get(Usuario, int(usuario_id))

    # Deixa "usuario_logado" disponível em todo template automaticamente,
    # sem precisar passar explicitamente em cada render_template().
    @app.context_processor
    def injetar_usuario():
        return {"usuario_logado": current_user}

    # Helper de template pra gerar o campo escondido de CSRF nos formulários
    # (usado como {{ csrf_field() }} nos .html) — o Flask-WTF confere esse
    # token em todo POST.
    @app.template_global()
    def csrf_field():
        return Markup(f'<input type="hidden" name="csrf_token" value="{generate_csrf()}">')

    # Sobe o agendador de automações (services/agendador.py) em segundo
    # plano, junto com o app. O PULSE AI usa o mesmo agendador pra reavaliar
    # a casa a cada minuto (alertas aparecem mesmo sem a página aberta).
    scheduler = iniciar_agendador(app)
    if scheduler is not None:
        from services.pulse_ai import registrar_monitor
        registrar_monitor(scheduler, app)

    return app


app = create_app()

if __name__ == "__main__":
    # debug=True só para desenvolvimento local — desligue em produção.
    app.run(debug=True, port=5000)
