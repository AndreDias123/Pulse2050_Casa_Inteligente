# O projeto em sprints

Esse documento organiza o desenvolvimento do PULSE2050 em sprints, mostrando
como o projeto foi crescendo, período por período. Cada sprint aqui
representa um pedaço real de trabalho, não uma data fixa de calendário.

---

## Sprint 0 — A base do projeto
### Semana 01 - 08/2026 do dia 02 ao dia 08

- Descrição: Planejamento, levantamento de requisitos, e alinhamento de processos, funções e cargos.

- Para atender as necessidades desse projeto utilizamos a seguintes linguagens disponiveis.
  * Python - **Obrigatório** utilização
  * JavaScript - Utilizado no FrontEnd e geração da Maquete 3D
  * Html e Css - Para geração do site e organização dos icones na
  * Sql - para o banco de dados, através das seeds

- Após decidirmos que a idéia é fazer uma casa automátizada, começamos definindo quais itens de uma casa podemos, criar a automação.

  1. Luz
  2. Janela
  3. Porta
  4. TV
  5. Ar-Condicionado
  6. Robo-Aspirador

- Cadastro de usuário no sistema, com validação de e-mail,  atravé do banco de dados

- Os administradores, podem definir niveis de acesso de outros usuários para aquela casa, podendo decidir quem é admin e quem é usuario comum. Realizando essa diferença em niveis de acesso no banco de dados. 

- Sistema calcula, quantos Kwh, consome a casa, com cada aparelho ligado. 

- histórico de quem ligou, ou desligou 

- Fluxograma

- Funções e cargos:

Reunião semanal concluida, foco no inicio das atividades.

----

## Sprint 1 — A base do projeto
### Semana 02 - 08/2026 do dia 09 ao dia 15

Focamos em desenvolvimento do projeto, arquivos, e estruturas de pastas.
 
- Desenvolvimento
  * Banco de dados.
    * desenvolvimento do MER.
    * Desenvolvimento do DER.
      * Inciado o desenvolvimento do arquivo `SEED.py`, com base no DER.
  * Back-end.
    * Desenvolvimento do Fluxograma do sistema ou MindMap do sistema.
  * Back-end e automação.
    * Desenvolvimento do sistema, com PYTHON utilizando as seguintes bibliotecas Flask.
  * front-end.
    * Desenvolvimento dos wireframes. 
    * Desenvolvimento do HTML e CSS com base nos wireframes.

Foi conversado na reunião semanal, sobre a possibilidade de utilizarnmos, uma maquete 3D para visualização dos comodos da casa, e a visualização dos equipamententos ligando ou desligando.


---

## Sprint 2 — Deixando o painel de energia mais inteligente
### Semana 03 - 08/2026 do dia 16 ao dia 22

Aqui o foco foi dar mais conteúdo real pra categoria INTELLIGENCE do
projeto. 

  - Finalizado as ativadades da semana, anterior. Porém algumas ficaram pendentes.
    - Desenvolvimento do MER *(Concluido)*
    - Desenvolvimento do DER *(Ainda Pendente)*
      - Arquivo `SEED.py`, *(Ainda Pendente, por conta do DER)*

  - MindMap do sistema, desenvolvido, *(concluido parcialmente)*, não realizaremos um Fluxograma geral do sistema.

  - Back-End e Automação.
    - Back-End *(Desenvolvimento em adamento)*
    - Automação *(Em andamento em conjunto com o back-end)*

  - Front-end 
    - Wireframes *(fase final de aprovação)*
    - Desenvolvimento do HTML e CSS *(Inciado)*


**Nesta reunião abordamos algumas necessidades a mais que vimos durante o processo.**

Será adicionado uma funcionalidade comparação com a semana anterior, projeção do gasto
do mês, um alerta que aponta o dispositivo que mais aumentou o consumo, e
um gráfico do consumo diário por cômodo.


Focamos bastante nos controles de arquivo e gerenciamento de pasta, quais pastas irá ter, qual será a estruta de arquivos, realiza o projeto de forma segura e estruturada, trazendo uma segurança no desenvolvimento, usando metodologia SOLID.


---

## Sprint 3 — Terminando a experiência e a segurança
### Semana 04 - 08/2026 do dia 23 ao dia 29 

"Focar nas alterações aqui, especificar arquivos do projeto e citar nome de pastas e também focar na apresentação do projeto"



- Cada automação ganhou um botão de ativar/desativar.
- O painel passou a mostrar a próxima automação a disparar.
- Adicionamos filtro por cômodo no painel.
- O login ganhou atalhos pra entrar como Administrador/Usuário Comum (só
  facilita testar) e a opção "lembrar de mim".
- Colocamos proteção contra CSRF em todos os formulários (Flask-WTF).

Um bug bobo apareceu aqui — uma função nova usando `timedelta` sem
importar. O smoke test acusou isso na hora e corrigimos rápido.

---

## Sprint 4 — Documentando e publicando

Criamos o `PROCESS.md` contando o processo de desenvolvimento, o
`.gitignore`, inicializamos o repositório Git e publicamos no GitHub. Esse
próprio arquivo (`SPRINTS.md`) também nasceu nessa etapa. 

---

## Sprint 5 — Conferindo contra o edital

Paramos de confiar só na nossa impressão de "acho que já tá tudo pronto" e
checamos item por item contra o roteiro oficial da categoria INTELLIGENCE.
Encontramos dois furos: não tínhamos fluxograma nenhum (item explícito da
lista), e nunca tínhamos escrito o porquê das escolhas de estrutura de
dados que o código já usava.

Resolvemos os dois: criamos o `FLUXOGRAMA.md` com o fluxo completo da
aplicação, e escrevemos a explicação das estruturas de dados no
`PROCESS.md`.

Assim, qualquer um do grupo consegue explicar qualquer parte do projeto,
não só quem escreveu aquele trecho específico.

---

## Sprint 6 — A maquete 3D

Essa foi a sprint que deu mais trabalho de decisão, porque passamos por
alguns protótipos antes de chegar no formato final:

1. Primeiro um mockup mais simples (planta baixa 2.5D) só pra testar se a
   ideia de "clicar num dispositivo e ver a casa reagir" valia o esforço.
2. Depois um passeio 3D pela casa (Three.js), bonito mas sem interação
   nenhuma ainda.
3. Juntamos os dois: a cena 3D ganhou os cliques interativos do primeiro
   protótipo.

E então veio a parte que mais importa: conectar isso ao Flask de verdade.
A maquete usa a mesma rota que os cards já usavam pra ligar/desligar um
dispositivo (nada de lógica duplicada), e criamos uma rota nova só de
consulta que ela confere a cada 5 segundos, pra pegar mudanças vindas do
agendador ou de outra pessoa mexendo em outra aba. As bibliotecas 3D só
carregam quando a aba é aberta, pra não deixar o painel normal mais lento.

No fim, completamos os três dispositivos que ainda faltavam objeto na
cena (Câmera da Sala, Geladeira, Luz da Garagem) — hoje os 13 dispositivos
do projeto aparecem na maquete.

**Testamos** rodando o smoke test de novo (nada quebrou) e simulando via
linha de comando exatamente a chamada que um clique na maquete faz,
confirmando que o dispositivo realmente muda de estado no banco.
