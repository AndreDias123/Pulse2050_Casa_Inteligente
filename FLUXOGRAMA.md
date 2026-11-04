# Fluxograma da aplicação

Em vez de um diagrama gigante, dividimos o fluxo do PULSE2050 em partes
menores. Primeiro a visão geral e depois cada caminho importante.

## 1. Visão geral

Toda ação começa de **uma pessoa** (cards ou maquete 3D) ou do **agendador**,
passa pela mesma regra de permissão e termina registrada no banco.

```mermaid
flowchart LR
    U["👤 Pessoa<br/>cards / maquete 3D"] --> R["Rotas Flask<br/>main.py"]
    A["⏰ Agendador<br/>a cada minuto"] --> M
    R --> P{"Pode<br/>controlar?"}
    P -- sim --> M["Dispositivo<br/>ligar() / desligar()"]
    P -- não --> X["❌ Bloqueado"]
    M --> DB[("SQLite<br/>RegistroUso")]
    DB --> E["⚡ Painel de energia"]
```

## 2. Login

```mermaid
flowchart LR
    A["Acessa o sistema"] --> B{"Já está<br/>logado?"}
    B -- sim --> D["Painel"]
    B -- não --> C["/login<br/>e-mail + senha"]
    C --> V{"Credenciais<br/>válidas?"}
    V -- sim --> D
    V -- não --> C
```

A sessão fica no Flask-Login, e há dois perfis: **Administrador** e
**Usuário Comum**.

## 3. Ligar / desligar um dispositivo

O caminho é o mesmo para o card e para a maquete 3D. Muda só a tela.

```mermaid
flowchart LR
    C["Clique no card"] --> R
    M["Clique na maquete 3D"] --> R
    R["POST /dispositivo/&lt;id&gt;/alternar"] --> P{"pode_controlar()?"}
    P -- não --> X["Mensagem: sem permissão"]
    P -- sim --> T["dispositivo.alternar()"]
    T --> DB[("RegistroUso<br/>quem + quando")]
```

Na tela de detalhe, as outras ações seguem a mesma ideia: **valida antes de
salvar**.

| Ação | Rota | Validação |
|---|---|---|
| Intensidade da luz | `/dispositivo/<id>/intensidade` | número inteiro de 1 a 100 |
| Criar automação | `/dispositivo/<id>/automacao` | nome + horário HH:MM válido |
| Ativar/desativar automação | `/dispositivo/<id>/automacao/<id>/alternar` | permissão do perfil |
| Liberar para o usuário comum | `/dispositivo/<id>/permissao` | só administrador |

## 4. Automações (sem ninguém clicar)

```mermaid
flowchart LR
    T(["⏰ A cada minuto"]) --> B{"Alguma automação ativa<br/>bate com hora + dia?"}
    B -- não --> T
    B -- sim --> L["dispositivo.ligar() / desligar()"]
    L --> DB[("RegistroUso<br/>usuário = sistema")]
```

O agendador chama os **mesmos métodos** que o botão da tela. Por isso a
automação também entra no cálculo de energia.

## 5. Energia e relatório

```mermaid
flowchart LR
    DB[("RegistroUso")] --> K["Calcula kWh<br/>e custo"]
    K --> S["Compara com a<br/>semana anterior"]
    S --> G["Alerta + gráfico<br/>por cômodo"]
    G --> Q{"Gerar<br/>relatório?"}
    Q -- sim --> E{"SMTP<br/>configurado?"}
    E -- sim --> M["📧 Envia e-mail"]
    E -- não --> V["Mostra prévia"]
```

## 6. Maquete 3D sempre atualizada

```mermaid
flowchart LR
    T(["A cada 5 s"]) --> G["GET /api/dispositivos"]
    G --> D{"Algo mudou?"}
    D -- não --> T
    D -- sim --> C["Atualiza a cena 3D"]
    C --> T
```

Se uma automação ligar algo ou outra pessoa mexer em outra aba, a maquete
mostra a mudança em poucos segundos, sem recarregar a página.

## O que vale reparar

- **Uma regra só de permissão:** `pode_controlar()` vale para os cards, a
  maquete e as automações.
- **Nada é salvo sem validação:** intensidade, horário e login são conferidos
  antes de mexer no banco.
- **Pessoa e agendador geram o mesmo histórico:** o `RegistroUso` alimenta o
  painel de energia nos dois casos.
- **A maquete não tem lógica própria:** ela é só outra tela por cima das
  mesmas rotas.
