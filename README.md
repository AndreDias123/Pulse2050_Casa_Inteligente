# PULSE2050 — Sistema Inteligente

O **PULSE2050** é um sistema de gerenciamento para uma residência inteligente,
desenvolvido no 4º semestre de Ciência da Computação para a **ExpoTech 2026.2**
(Missão 2050, categoria **INTELLIGENCE**).

O sistema centraliza o controle dos dispositivos da casa, executa automações
por horário e analisa o consumo de energia com base no histórico real de uso,
tornando a residência mais eficiente e fácil de gerenciar. Uma **maquete 3D
interativa** representa a casa e está ligada ao mesmo back-end: cada ação
feita nela altera o estado do dispositivo no banco de dados, e cada mudança
no banco aparece na maquete. O **PULSE AI**, agente de monitoramento da
residência, acompanha esses dados e gera alertas, recomendações e respostas
sobre o funcionamento da casa.

---

## 📄 Documentação

| Documento | Conteúdo |
|---|---|
| [Fluxograma](FLUXOGRAMA.md) | Fluxo da aplicação em diagramas, do login ao controle dos dispositivos. |
| [Processo](PROCESS.md) | Decisões técnicas, problemas encontrados e como foram resolvidos. |
| [Sprints](SPRINTS.md) | Evolução do projeto por sprint e acompanhamento no Kanban. |
| [Figma](https://www.figma.com/design/hzFawKAiLx3iq8FkzFOZxZ/ExpoTec?node-id=46-2&t=uojBmQ6G2defeyGk-0) | Protótipo das telas: login, painel, dispositivo, energia e maquete 3D. |

---

## 🛠️ Tecnologias

| Camada | Tecnologias |
|---|---|
| Back-end | Python 3.10+, Flask 3.0 |
| Banco de dados | SQLite, SQLAlchemy (Flask-SQLAlchemy) |
| Autenticação e segurança | Flask-Login, Flask-WTF (proteção CSRF) |
| Automações | APScheduler, tzdata |
| Front-end | HTML (Jinja2), CSS, JavaScript |
| Maquete 3D | Three.js r128 + OrbitControls (carregados via CDN) |

---

## ▶️ Como executar

**1. Pré-requisitos:** Python 3.10 ou superior, Git e acesso à internet
(o Three.js da maquete é carregado via CDN).

**2. Clonar o repositório**

```bash
git clone https://github.com/AndreDias123/Pulse2050_Casa_Inteligente.git
cd Pulse2050_Casa_Inteligente
```

**3. Criar o ambiente virtual**

```bash
python -m venv .venv
```

**4. Ativar o ambiente virtual**

```bash
# Windows
.venv\Scripts\activate

# Linux / macOS
source .venv/bin/activate
```

**5. Instalar as dependências**

```bash
pip install -r requirements.txt
```

**6. Criar e popular o banco de dados**

```bash
python seed.py
```

Cria o `pulse2050.db` com cômodos, dispositivos, usuários, automações e duas
semanas de histórico de uso. Rodar de novo recria o banco do zero.

**7. Iniciar a aplicação**

```bash
python app.py
```

**8. Acessar:** <http://localhost:5000>

---

## 🔑 Contas de demonstração

| Perfil | E-mail | Senha |
|---|---|---|
| Administrador | `admin@pulse2050.app` | `admin123` |
| Usuário Comum | `comum@pulse2050.app` | `comum123` |

---

## ⚙️ Funcionalidades

- **Dispositivos:** 13 dispositivos residenciais (luzes, TV, ar-condicionado,
  janela, câmeras, geladeira, robô aspirador, porta da garagem). A classe
  `Dispositivo` possui subclasses que sobrescrevem `status()`, `ligar()` e
  `desligar()` (herança e polimorfismo), persistidas em uma única tabela
  (Single Table Inheritance).
- **Permissões:** o Administrador controla todos os dispositivos; o Usuário
  Comum controla apenas os liberados. A regra fica em
  `Dispositivo.pode_controlar()` e é aplicada nas rotas e na interface.
- **Automações:** o agendador verifica a cada minuto as automações ativas e
  executa as ações no horário e nos dias da semana configurados.
- **Energia:** consumo (kWh) e custo calculados a partir do histórico de uso,
  com comparação semanal, projeção mensal, alerta de aumento de consumo,
  gráfico diário por cômodo e relatório por e-mail (ou prévia, sem SMTP).
- **Maquete 3D:** residência completa em Three.js, com todos os 13
  dispositivos representados.
  - Clicar em um objeto aciona a mesma rota dos cards
    (`POST /dispositivo/<id>/alternar`), respeitando as permissões.
  - A cena consulta `GET /api/dispositivos` a cada 5 segundos para refletir
    mudanças feitas por automações ou por outros usuários.
  - Inclui garagem com veículo que entra e sai conforme a porta, moradores
    animados, portas com sensor de presença, tour de câmera e modo dia/noite.
- **PULSE AI:** agente inteligente de monitoramento, acessível pelo painel e
  pelo menu lateral (`/pulse-ai/`).
  - **Monitoramento:** estado de cada dispositivo e há quanto tempo está assim,
    obtido do histórico de uso.
  - **Alertas** com prioridade (Informativo, Atenção, Crítico), por exemplo:
    porta aberta além do limite, luz ligada há horas, ar-condicionado ligado
    com a janela aberta e automação sem registro de execução. Podem ser
    marcados como vistos ou resolvidos e ficam no histórico.
  - **Recomendações** justificadas pelos dados: maior consumidor, aumento de
    consumo e horários sugeridos para automações.
  - **Assistente conversacional** que responde com os dados reais do banco.
    Ações sobre dispositivos exigem confirmação e respeitam as permissões.
  - **Na maquete 3D:** holograma do agente, marcadores sobre os dispositivos
    com alerta e sinalização do cômodo com ocorrência.
  - É um motor de regras (limites configuráveis em `config.py`), sem modelo de
    linguagem conectado; a arquitetura do assistente permite essa integração
    no futuro.

---

## 📁 Estrutura do projeto

| Arquivo / pasta | Responsabilidade |
|---|---|
| `app.py` | Cria a aplicação Flask e registra os blueprints |
| `config.py` | Configurações (banco, chave secreta, fuso horário, SMTP) |
| `extensions.py` | Instâncias do SQLAlchemy e do Flask-Login |
| `models.py` | Classes e tabelas do banco de dados |
| `auth.py` | Login e logout |
| `main.py` | Painel, controle dos dispositivos e API da maquete 3D |
| `energia.py` | Painel de energia e relatórios |
| `pulse_ai.py` | Rotas do PULSE AI (página e API do agente) |
| `services/` | Cálculo de energia, relatórios, agendador de automações e o PULSE AI (`pulse_ai.py`, `pulse_ai_chat.py`) |
| `templates/` | Páginas HTML (Jinja2) |
| `static/css/` · `static/js/` | Estilos, cena da maquete 3D (`casa3d.js`) e página do agente (`pulse_ai.js`) |
| `seed.py` | Popula o banco com dados de demonstração |
| `smoke_test.py` · `pulse_ai_test.py` | Testes automatizados do sistema e do PULSE AI |
| `docs/screenshots/` | Capturas de tela do sistema |

---

## ✅ Testes

```bash
python seed.py           # garante um banco limpo
python smoke_test.py

python seed.py
python pulse_ai_test.py
```

Os dois arquivos usam o cliente de testes do Flask (não precisam subir o
servidor) e mostram o resultado OK/FAIL de cada verificação.

- `smoke_test.py` — **24 verificações**: login dos dois perfis, controle de
  dispositivos, validação da intensidade da luz, painel de energia, geração de
  relatório, bloqueio de acesso sem login, respeito às permissões e resposta
  404 para rotas inexistentes.
- `pulse_ai_test.py` — **52 verificações** do agente: indicadores iguais ao
  banco, geração e escalonamento de alertas, resolução manual e automática,
  integração com a maquete, respostas do assistente, confirmação de ações,
  proteção CSRF, permissões do Usuário Comum e compatibilidade com as telas
  anteriores.
