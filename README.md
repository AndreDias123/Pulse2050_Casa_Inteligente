# PULSE2050 — Sistema Inteligente

Casa inteligente feita no 4º semestre de Ciência da Computação para a
ExpoTech 2026.2 (Missão 2050, categoria INTELLIGENCE): banco de dados,
POO, autenticação, automações, painel de energia e uma maquete 3D
interativa ligada ao sistema real.

📄 [Fluxograma](FLUXOGRAMA.md) · [Processo](PROCESS.md) · [Sprints](SPRINTS.md) · [Figma](https://www.figma.com/design/hzFawKAiLx3iq8FkzFOZxZ/ExpoTec?node-id=46-2&t=uojBmQ6G2defeyGk-0)

## Tecnologias

Python 3.10+ · Flask · SQLAlchemy · Flask-Login · SQLite · Three.js

## Como rodar

```bash
python -m venv .venv
.venv\Scripts\activate          # Linux/Mac: source .venv/bin/activate
pip install -r requirements.txt
python seed.py                  # cria e popula o banco
python app.py                   # http://localhost:5000
```

| Perfil         | E-mail              | Senha    |
|----------------|---------------------|----------|
| Administrador  | admin@pulse2050.app | admin123 |
| Usuário Comum  | comum@pulse2050.app | comum123 |

## Funcionalidades

- **Dispositivos:** 13 aparelhos (luzes, TV, ar, janela, câmeras, robô,
  porta da garagem...) usando herança e polimorfismo numa tabela só
  (Single Table Inheritance).
- **Permissões:** o admin controla tudo; o usuário comum só o que foi liberado.
- **Automações:** disparam sozinhas no horário e dia configurados.
- **Energia:** consumo real calculado pelo histórico de uso, comparação
  semanal, projeção do mês e relatório por e-mail.
- **Maquete 3D:** casa completa em Three.js — clicar num objeto liga/desliga
  o dispositivo de verdade. Tem garagem com carro que entra e sai, moradores
  andando pela casa, portas automáticas e modo dia/noite.

## Estrutura

```
app.py / config.py / extensions.py   inicialização do Flask
models.py                            classes e tabelas
auth.py / main.py / energia.py       rotas
services/                            energia, relatórios e agendador
templates/ · static/                 telas, CSS e a cena 3D
seed.py · smoke_test.py              dados de exemplo e testes
```

## Testes

```bash
python seed.py
python smoke_test.py    # 24 checagens automáticas
```
