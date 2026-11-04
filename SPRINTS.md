# 🗓️ PULSE2050 em Sprints

> Como o projeto cresceu, etapa por etapa. Cada sprint é um bloco real de
> trabalho — e cada uma também virou um card no nosso Kanban.

[![Kanban](https://img.shields.io/badge/Kanban-Gatilho%20do%20Projeto-2ea44f?logo=github)](https://github.com/users/AndreDias123/projects/2)
![Sprints](https://img.shields.io/badge/sprints-8-blue)
![Testes](https://img.shields.io/badge/smoke%20test-24%2F24-brightgreen)

## 🧭 Linha do tempo

```mermaid
flowchart LR
    S0["🧱 S0<br/>Base"] --> S1["⏰ S1<br/>Automações"] --> S2["⚡ S2<br/>Energia"] --> S3["🔒 S3<br/>Segurança"]
    S3 --> S4["🚀 S4<br/>Publicação"] --> S5["✅ S5<br/>Edital"] --> S6["🏠 S6<br/>Maquete 3D"] --> S7["🚗 S7<br/>Maquete 2.0"]
```

## 📋 Resumo das sprints

| Sprint | Foco | O que entregamos | 🐞 O que deu errado (e corrigimos) |
|:--:|---|---|---|
| **0** | Base | Dispositivos com herança, login com 2 perfis, energia, relatórios e 24 testes | Automações não disparavam sozinhas |
| **1** | Automações | Agendador (APScheduler) checando a cada minuto | Fuso horário UTC × local; agendador rodando 2× no modo debug |
| **2** | Energia | Comparação semanal, projeção do mês, alerta e gráfico por cômodo | Alerta mostrando **+10794%** por falta de dados — exigimos base mínima |
| **3** | Experiência e segurança | Liga/desliga de automações, filtro por cômodo, proteção CSRF | `timedelta` sem import — o smoke test pegou na hora |
| **4** | Publicação | `PROCESS.md`, `.gitignore`, repositório no GitHub | — |
| **5** | Edital | Conferência item a item da categoria INTELLIGENCE, `FLUXOGRAMA.md` | Faltava o fluxograma e a justificativa das estruturas de dados |
| **6** | Maquete 3D | Casa em Three.js ligada ao banco: clicar liga/desliga de verdade | 3 dispositivos sem objeto na cena — completamos os 13 |
| **7** | Maquete 2.0 | Carro que entra na garagem, moradores andando, cômodos mobiliados, dia/noite | Carro só anda com a porta 100% aberta, para não atravessá-la |

## 📌 O gatilho no Kanban

O projeto foi publicado em **10 entregas diárias** (o "gatilho"), cada uma um card no
quadro **[PULSE2050 — Gatilho do Projeto](https://github.com/users/AndreDias123/projects/2)**.

```mermaid
flowchart LR
    B["📥 Backlog"] --> C["🔨 Em construção"] --> D["✅ Concluído"]
```

As 10 publicações e as sprints estão lá como cards, todos já em **Concluído** —
dá pra acompanhar o que entrou em cada dia e quem subiu cada parte.
