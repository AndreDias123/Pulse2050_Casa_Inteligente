# Como o projeto foi evoluindo

Aqui contamos o caminho até o PULSE2050 ficar pronto: o que a gente
tentou, o que deu errado e por que escolhemos cada solução.

## Em resumo

- **Tudo que aparece na tela é real:** consumo de energia vem do histórico
  de uso e a maquete 3D liga e desliga os dispositivos no banco.
- **Nenhuma lógica duplicada:** cards, automações e maquete usam o mesmo
  `ligar()`/`desligar()` e a mesma rota.
- **Testamos a cada mudança:** o `smoke_test.py` (24 checagens) pegou bug de
  verdade antes de virar problema.
- **Conferimos o edital item por item**, em vez de achar que estava pronto.

## Etapa por etapa

### 1. Automações disparando sozinhas
- **Problema:** as automações ficavam salvas no banco, mas nunca disparavam.
- **Solução:** APScheduler rodando junto do Flask, checando a cada minuto.
- **O que aprendemos:** o sistema usa UTC, mas "18:30" é hora local — criamos
  a config `TIMEZONE`. No Windows ainda precisou do pacote `tzdata`, e o modo
  debug do Flask fazia o agendador rodar duas vezes.

### 2. Painel de energia com análise
- **Problema:** só mostrar kWh era pouco pra categoria INTELLIGENCE.
- **Solução:** comparação com a semana anterior, projeção do mês, alerta de
  consumo e gráfico por cômodo.
- **O que aprendemos:** o alerta mostrou **+10794%** num dispositivo. Era
  falta de dado na semana anterior — passamos a exigir uma base mínima e o
  seed ganhou duas semanas de histórico.

### 3. Experiência e segurança
- **Solução:** ativar/desativar cada automação, próxima automação no painel,
  filtro por cômodo, "lembrar de mim" e **proteção CSRF** em todos os
  formulários (Flask-WTF).
- **O que aprendemos:** um `timedelta` sem import quebrou uma função nova — o
  smoke test acusou na hora.

### 4. Conferência do edital
- **Problema:** faltava o fluxograma e a explicação das estruturas de dados.
- **Solução:** criamos o `FLUXOGRAMA.md` e a seção de estruturas de dados
  aqui embaixo.

### 5. Maquete 3D
- **Como chegamos nela:** primeiro uma planta 2.5D pra testar a ideia de
  clicar e ver a casa reagir, depois juntamos isso com uma cena em Three.js.
- **Ligação com o sistema:** a maquete usa a **mesma rota** dos cards
  (`/dispositivo/<id>/alternar`) e confere o banco a cada 5 segundos em
  `/api/dispositivos`. O Three.js só carrega quando a aba é aberta.
- **Depois evoluímos:** carro que entra e sai da garagem, moradores andando
  pela casa, cômodos mobiliados e modo dia/noite — sem mexer no back-end.

### 6. PULSE AI — o agente da casa
- **Problema:** o sistema mostrava o estado de cada aparelho, mas ninguém
  avisava quando algo saía do normal (garagem aberta há meia hora, luz acesa a
  tarde toda, ar ligado com a janela aberta).
- **Solução:** um agente baseado em regras (`services/pulse_ai.py`) que lê o
  histórico de uso pra saber *há quanto tempo* cada coisa está assim e gera
  alertas com prioridade, recomendações justificadas e um assistente que
  responde com os dados do banco. Os alertas também aparecem na maquete.
- **Decisões:** não criamos estrutura paralela — o agente reaproveita o
  `RegistroUso`, o cálculo de energia, o agendador (roda a cada minuto) e o
  `pode_controlar()`. Ações pedidas ao assistente só acontecem depois de
  confirmação. Escolhemos regras transparentes em vez de um modelo de
  linguagem: cada alerta pode ser conferido no banco.
- **O que aprendemos:** resolver um alerta não podia fazer ele voltar no
  minuto seguinte. Cada alerta ganhou uma "chave" do episódio (aparelho +
  momento em que a situação começou), e quando a situação acaba ele é
  resolvido sozinho e vai pro histórico.

## Estruturas de dados — por que cada escolha

| Escolha | Por quê |
|---|---|
| **Single Table Inheritance** no `Dispositivo` | Listar os dispositivos de um cômodo é a consulta mais comum; com uma tabela só, não precisa de JOIN. |
| **Dicionário** por cômodo (cores, consumo) | Busca direta pelo nome, em vez de percorrer uma lista várias vezes por página. |
| **`set`** pros dias da semana da automação | O agendador checa a cada minuto, então a checagem precisa ser rápida. |
| **Ordenação no banco** | O SQLite já ordena bem; repetir isso em Python seria desperdício. |
| **Lista simples** pro ranking de consumo | Uma casa tem poucas dezenas de dispositivos — não precisa de algo mais complexo. |
| **Dicionário por chave de episódio** nos alertas do PULSE AI | Confere em uma busca se aquela situação já tem alerta, sem duplicar. |

## Como testamos

- `smoke_test.py` depois de cada mudança: login, dispositivos, permissões,
  energia e relatório — **24 checagens**.
- O agendador foi testado chamando a função direto, sem esperar o relógio.
- Na maquete, simulamos a mesma chamada que o clique faz e conferimos que o
  estado mudou no banco; a parte visual foi conferida no navegador.
- `pulse_ai_test.py` cria situações reais (abre a garagem e "adianta o relógio"
  do evento) e confere se o agente detecta, prioriza, resolve, responde e
  respeita as permissões — **52 checagens**.
