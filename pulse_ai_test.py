"""
Testes do PULSE AI via Flask test client (mesmo estilo do smoke_test.py).
Cria situações reais no banco (liga/abre dispositivos pelas rotas do app e
"envelhece" o horário do evento no RegistroUso pra simular o tempo passando)
e confere se o agente detecta, prioriza, resolve e responde corretamente.

Uso:
    python seed.py && python pulse_ai_test.py
"""
import re
import sys
import traceback
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app import app
from extensions import db
from models import AcaoAgente, AlertaAgente, Automacao, AutomacaoAcao, Dispositivo, RegistroUso, Usuario
from services import pulse_ai as cerebro

results = []


def check(name, condition, extra=""):
    status = "OK " if condition else "FAIL"
    results.append((status, name, extra))
    print(f"[{status}] {name} {extra}")


def disp(nome):
    return Dispositivo.query.filter_by(nome=nome).first()


def envelhecer(nome, minutos):
    """Move o último evento ligou/desligou do dispositivo pra `minutos` atrás."""
    d = disp(nome)
    ev = cerebro.ultimo_evento(d)
    ev.timestamp = (datetime.now(timezone.utc) - timedelta(minutes=minutos)).replace(tzinfo=None)
    db.session.commit()


def alertas(tipo, nome):
    d = disp(nome)
    return AlertaAgente.query.filter_by(tipo=tipo, dispositivo_id=d.id).order_by(AlertaAgente.id).all()


def garantir(client, nome, ativo):
    """Coloca o dispositivo no estado pedido usando a rota real do painel."""
    with app.app_context():
        d = disp(nome)
        atual, did = d.ativo, d.id
    if atual != ativo:
        client.post(f"/dispositivo/{did}/alternar")


def chat(client, msg):
    return client.post("/pulse-ai/api/chat", json={"mensagem": msg}).get_json()


def main():
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False
    c = app.test_client()

    # 1. acesso e autenticação ------------------------------------------------
    r = c.get("/pulse-ai/")
    check("PULSE AI sem login redireciona", r.status_code in (301, 302), f"status={r.status_code}")
    r = c.get("/pulse-ai/api/estado")
    check("API sem login bloqueada", r.status_code in (301, 302, 401), f"status={r.status_code}")

    c.post("/login", data={"email": "admin@pulse2050.app", "senha": "admin123"})
    r = c.get("/pulse-ai/")
    check("GET /pulse-ai/ (admin)", r.status_code == 200 and b"PULSE AI" in r.data and b"Central de alertas" in r.data)
    r = c.get("/")
    check("painel tem o acesso PULSE AI", b'id="ai-entry"' in r.data and b"/pulse-ai/" in r.data)
    check("menu lateral tem o PULSE AI", b"ai-nav" in r.data)

    # 2. indicadores batem com o banco ----------------------------------------
    est = c.get("/pulse-ai/api/estado").get_json()
    with app.app_context():
        total, ligados = Dispositivo.query.count(), Dispositivo.query.filter_by(ativo=True).count()
    check("indicador total = banco", est["indicadores"]["total"] == total, f"{est['indicadores']['total']}={total}")
    check("indicador ligados = banco", est["indicadores"]["ligados"] == ligados, f"{est['indicadores']['ligados']}={ligados}")

    # inverte o estado atual (o seed acende a luz a partir de certo horário,
    # então "ligar" poderia não mudar nada dependendo da hora do teste)
    with app.app_context():
        sala_ligada = disp("Luz da Sala").ativo
    garantir(c, "Luz da Sala", not sala_ligada)
    est2 = c.get("/pulse-ai/api/estado").get_json()
    with app.app_context():
        ligados2 = Dispositivo.query.filter_by(ativo=True).count()
    check("indicador acompanha alteração do painel", est2["indicadores"]["ligados"] == ligados2 and est2["versao"] != est["versao"],
          f"ligados={est2['indicadores']['ligados']}")

    # 3. janela: aberta -> info; tempo passa -> atenção ------------------------
    garantir(c, "Janela do Quarto", True)
    est = c.get("/pulse-ai/api/estado").get_json()
    check("janela aberta contada", est["indicadores"]["janelas_abertas"] == 1)
    with app.app_context():
        cerebro.sincronizar()
        a = alertas("janela_aberta", "Janela do Quarto")
        check("alerta informativo de janela aberta", len(a) == 1 and a[0].prioridade == "info")
        envelhecer("Janela do Quarto", 90)
        cerebro.sincronizar()
        a2 = alertas("janela_aberta", "Janela do Quarto")
        check("janela aberta há 90 min vira Atenção", any(x.prioridade == "atencao" and x.status != "resolvido" for x in a2))

    # 4. ar-condicionado + janela aberta no mesmo cômodo ------------------------
    garantir(c, "Ar-condicionado", True)
    with app.app_context():
        cerebro.sincronizar()
        check("alerta AC ligado com janela aberta", any(x.status != "resolvido" for x in alertas("ac_janela", "Ar-condicionado")))

    # 5. porta da garagem aberta há 40 min -> crítico ---------------------------
    garantir(c, "Porta da Garagem", True)
    est = c.get("/pulse-ai/api/estado").get_json()
    check("porta aberta contada", est["indicadores"]["portas_abertas"] == 1)
    with app.app_context():
        envelhecer("Porta da Garagem", 40)
        cerebro.sincronizar()
        porta = [x for x in alertas("porta_aberta", "Porta da Garagem") if x.status != "resolvido"]
        check("porta aberta há 40 min = Crítico", porta and porta[-1].prioridade == "critico")

    # 6. câmera desligada com porta aberta -> crítico ---------------------------
    garantir(c, "Câmera Externa", False)
    with app.app_context():
        cerebro.sincronizar()
        cam = [x for x in alertas("camera_off", "Câmera Externa") if x.status != "resolvido"]
        check("câmera desligada + porta aberta = Crítico", cam and cam[-1].prioridade == "critico")

    # 7. luz acesa há 5h: sem automação -> atenção; com automação -> info -------
    garantir(c, "Luz da Cozinha", True)
    garantir(c, "Luz do Quarto", True)
    with app.app_context():
        envelhecer("Luz da Cozinha", 300)
        envelhecer("Luz do Quarto", 300)
        cerebro.sincronizar()
        coz = [x for x in alertas("luz_tempo", "Luz da Cozinha") if x.status != "resolvido"]
        qua = [x for x in alertas("luz_tempo", "Luz do Quarto") if x.status != "resolvido"]
        check("luz da cozinha 5h sem automação = Atenção", coz and coz[-1].prioridade == "atencao")
        check("luz do quarto 5h com automação de desligar = Informativo", qua and qua[-1].prioridade == "info")

    # 8. maquete recebe os alertas e o cômodo crítico ---------------------------
    m = c.get("/pulse-ai/api/maquete").get_json()
    check("maquete: alerta da porta da garagem", any(a["dispositivo"] == "Porta da Garagem" and a["prioridade"] == "critico" for a in m["alertas"]))
    check("maquete: cômodo Garagem sinalizado como crítico", m["comodos"].get("Garagem") == "critico", str(m["comodos"]))
    with app.app_context():
        acesas = {d.comodo.nome for d in Dispositivo.query.filter_by(tipo="luz", ativo=True)}
    check("maquete: cômodos com luz acesa = banco", set(m["luzes_por_comodo"]) == acesas
          and {"Cozinha", "Quarto"} <= acesas, str(m["luzes_por_comodo"]))
    check("status geral crítico", m["status"] == "critico")

    # 9. visto / resolvido / histórico / auto-resolução -------------------------
    with app.app_context():
        alvo = [x for x in alertas("luz_tempo", "Luz da Cozinha") if x.status != "resolvido"][-1]
        alvo_id, alvo_chave = alvo.id, alvo.chave
    r = c.post(f"/pulse-ai/api/alertas/{alvo_id}/visto")
    check("marcar alerta como visto", r.status_code == 200 and r.get_json()["status"] == "visto")
    r = c.post(f"/pulse-ai/api/alertas/{alvo_id}/resolver")
    check("resolver alerta", r.status_code == 200 and r.get_json()["status"] == "resolvido")
    with app.app_context():
        cerebro.sincronizar()
        mesmos = AlertaAgente.query.filter_by(chave=alvo_chave).all()
        admin = Usuario.query.filter_by(email="admin@pulse2050.app").first()
        check("alerta resolvido não reaparece no mesmo episódio", len(mesmos) == 1 and mesmos[0].status == "resolvido"
              and mesmos[0].resolvido_por_id == admin.id)

    garantir(c, "Janela do Quarto", False)
    with app.app_context():
        cerebro.sincronizar()
        jan = alertas("janela_aberta", "Janela do Quarto")
        check("janela fechada: alerta resolvido automaticamente", all(x.status == "resolvido" for x in jan)
              and jan[-1].resolvido_por_id is None)
    est = c.get("/pulse-ai/api/estado").get_json()
    check("histórico mostra alertas resolvidos", any(a["tipo"] == "janela_aberta" for a in est["alertas_historico"]))
    tipos = {i["tipo"] for i in est["linha_do_tempo"]}
    check("linha do tempo tem estado, alerta e resolução", {"estado", "alerta", "resolvido"} <= tipos, str(tipos))
    check("saúde usa os alertas abertos", "Porta da Garagem" in est["saude"]["criticos"], str(est["saude"]["criticos"]))
    check("resumo do dia conta alertas", est["resumo"]["alertas"]["critico"] >= 1)

    # 10. automação sem registro de execução ------------------------------------
    with app.app_context():
        agora_local = datetime.now(ZoneInfo(app.config["TIMEZONE"]))
        if agora_local.hour == 0 and agora_local.minute < 40:
            print("    (pulando teste de automação não executada: perto da meia-noite)")
        else:
            horario = (agora_local - timedelta(minutes=30)).strftime("%H:%M")
            tv = disp("TV da Sala")
            if tv.ativo:
                tv.desligar(None)
            admin = Usuario.query.filter_by(email="admin@pulse2050.app").first()
            auto = Automacao(nome="Teste TV", horario=horario, criado_por=admin)
            auto.acoes.append(AutomacaoAcao(dispositivo=tv, acao="ligar"))
            db.session.add(auto)
            db.session.commit()
            cerebro.sincronizar()
            check("automação sem registro de execução detectada", bool(alertas("auto_nao_exec", "TV da Sala")))
            db.session.delete(auto)
            db.session.commit()

    # 11. assistente responde com dados reais -----------------------------------
    with app.app_context():
        luzes_on = Dispositivo.query.filter_by(tipo="luz", ativo=True).count()
    r = chat(c, "Quantas luzes estão ligadas?")
    check("chat: quantas luzes", r["texto"].startswith(f"{luzes_on} de"), r["texto"])
    r = chat(c, "Existe alguma porta aberta?")
    check("chat: porta aberta", r["texto"].startswith("Sim"), r["texto"])
    r = chat(c, "Como está a garagem?")
    check("chat: garagem", "aberta" in r["texto"] and any("Veículo" in i for i in r["itens"]), r["texto"])
    r = chat(c, "Existem alertas pendentes?")
    check("chat: alertas", "alerta(s) pendente(s)" in r["texto"] and r["itens"], r["texto"])
    r = chat(c, "Quais automações estão programadas?")
    check("chat: automações", len(r["itens"]) == 4, r["texto"])
    r = chat(c, "Qual cômodo está consumindo mais energia?")
    check("chat: consumo por cômodo", "kWh" in r["texto"] and r["itens"], r["texto"])
    r = chat(c, "O que posso melhorar na minha casa?")
    check("chat: recomendações", bool(r["itens"]), r["texto"])
    r = chat(c, "Quais dispositivos estão funcionando?")
    check("chat: dispositivos funcionando", re.match(r"\d+ dispositivo", r["texto"]) is not None, r["texto"])
    check("chat: diz que é motor de regras", r["motor"] == "regras")

    # 12. comando só com confirmação + registro da ação -------------------------
    r = chat(c, "desligar a luz da cozinha")
    with app.app_context():
        coz = disp("Luz da Cozinha")
        ainda_ligada, coz_id = coz.ativo, coz.id
        n_acoes = AcaoAgente.query.count()
    check("chat propõe ação sem executar", r["acao"] and r["acao"]["dispositivo_id"] == coz_id and ainda_ligada)
    r = c.post("/pulse-ai/api/executar", json={"dispositivo_id": coz_id, "acao": "desligar", "pedido": "desligar a luz da cozinha"})
    with app.app_context():
        coz = disp("Luz da Cozinha")
        ultimo = cerebro.ultimo_evento(coz)
        admin = Usuario.query.filter_by(email="admin@pulse2050.app").first()
        check("ação confirmada executa e registra", r.status_code == 200 and not coz.ativo
              and AcaoAgente.query.count() == n_acoes + 1 and ultimo.usuario_id == admin.id)
    check("pedido inválido rejeitado", c.post("/pulse-ai/api/executar", json={"dispositivo_id": "x", "acao": "explodir"}).status_code == 400)

    # 13. CSRF continua valendo nas rotas do agente -----------------------------
    app.config["WTF_CSRF_ENABLED"] = True
    r = c.post("/pulse-ai/api/chat", json={"mensagem": "oi"})
    check("POST sem token CSRF é recusado", r.status_code == 400, f"status={r.status_code}")
    app.config["WTF_CSRF_ENABLED"] = False

    # 14. permissões do Usuário Comum -------------------------------------------
    c.get("/logout")
    c.post("/login", data={"email": "comum@pulse2050.app", "senha": "comum123"})
    check("comum acessa o PULSE AI", c.get("/pulse-ai/").status_code == 200)
    with app.app_context():
        ac = disp("Ar-condicionado")
        ac_id, ac_antes = ac.id, ac.ativo
        porta_alerta = [x for x in alertas("porta_aberta", "Porta da Garagem") if x.status != "resolvido"][-1].id
    r = chat(c, "desligar o ar condicionado")
    check("chat recusa comando sem permissão", r["acao"] is None and "permissão" in r["texto"], r["texto"])
    r = c.post("/pulse-ai/api/executar", json={"dispositivo_id": ac_id, "acao": "desligar"})
    with app.app_context():
        check("executar sem permissão = 403 e estado igual", r.status_code == 403 and disp("Ar-condicionado").ativo == ac_antes)
    r = c.post(f"/pulse-ai/api/alertas/{porta_alerta}/resolver")
    check("comum não resolve alerta de dispositivo restrito", r.status_code == 403)
    est = c.get("/pulse-ai/api/estado").get_json()
    autores = {i["autor"] for i in est["linha_do_tempo"]}
    check("comum não vê nome de outros usuários", "André" not in autores, str(autores))

    # 15. funcionalidades antigas continuam de pé -------------------------------
    for url in ["/", "/energia/", "/api/dispositivos", f"/dispositivo/{ac_id}"]:
        check(f"GET {url} continua 200", c.get(url).status_code == 200)

    failed = [x for x in results if x[0] == "FAIL"]
    print("\n" + "=" * 50)
    print(f"TOTAL: {len(results)}  FAIL: {len(failed)}")
    if failed:
        for f in failed:
            print(" -", f[1], f[2])
        sys.exit(1)
    print("TUDO OK")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        sys.exit(2)
