/**
 * Página do PULSE AI — consome /pulse-ai/api/* (dados reais do banco).
 *
 * Atualização: consulta /api/estado a cada 6 s só enquanto a aba está
 * visível; o servidor manda uma `versao` (hash do conteúdo) e a tela só
 * redesenha quando ela muda. Recomendações (cálculo mais pesado) a cada 90 s.
 * Todo texto vindo do servidor entra via textContent (nunca innerHTML).
 */
(function () {
  "use strict";
  var CFG = window.PULSE_AI_CONFIG;
  var estado = null, versao = null, aba = "ativos";

  // ---------- utilidades de DOM ----------
  function el(tag, cls, texto) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    return e;
  }
  function svg(path, size) {
    var ns = "http://www.w3.org/2000/svg";
    var s = document.createElementNS(ns, "svg");
    s.setAttribute("width", size || 18); s.setAttribute("height", size || 18);
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "1.7");
    s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
    path.split("|").forEach(function (d) {
      var p = document.createElementNS(ns, "path"); p.setAttribute("d", d); s.appendChild(p);
    });
    return s;
  }
  var ICON = {
    total: "M4 11 L12 4 L20 11|M6 9.5 V20 H18 V9.5",
    on: "M12 3 V11|M7 6.5 A7 7 0 1 0 17 6.5",
    off: "M5 12 H19",
    portas: "M5 20 V4 H15 V20|M15 20 H19|M11.5 12.5 H12.5",
    janelas: "M4 4 H20 V20 H4 Z|M12 4 V20|M4 12 H20",
    alerta: "M12 3 L22 20 H2 Z|M12 9 V14|M12 17 V17.2",
    auto: "M12 3 A9 9 0 1 0 12 21 A9 9 0 1 0 12 3 Z|M12 7 V12 L15.5 14",
    iluminacao: "M9 18 H15|M10 21 H14|M12 3 A6 6 0 0 1 15.5 13.9 C14.9 14.4 14.5 15.1 14.5 16 H9.5 C9.5 15.1 9.1 14.4 8.5 13.9 A6 6 0 0 1 12 3 Z",
    clima: "M4 9 H16|M4 12 H19|M4 15 H14",
    cameras: "M3 7 H17 V18 H3 Z|M17 10 L21 8 V16 L17 14",
    outros: "M4 6 H20 V18 H4 Z|M8 10 H16|M8 14 H13",
    mapa: "M3 6 L9 3 L15 6 L21 3 V18 L15 21 L9 18 L3 21 Z|M9 3 V18|M15 6 V21"
  };
  var ROTULO_STATUS = {
    ok: "Tudo normal", info: "Avisos informativos", atencao: "Atenção necessária", critico: "Ocorrência crítica"
  };

  function duracao(iso) {
    if (!iso) return null;
    var min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 1) return "agora";
    if (min < 60) return "há " + min + " min";
    var h = Math.floor(min / 60), m = min % 60;
    if (h >= 48) return "há " + Math.floor(h / 24) + " dias";
    return "há " + h + "h" + (m ? " " + (m < 10 ? "0" : "") + m + "min" : "");
  }
  function linkMaquete(nome) { return CFG.maquete + "?foco=" + encodeURIComponent(nome) + "#maquete"; }

  function api(url, opts) {
    opts = opts || {};
    var headers = { "X-CSRFToken": CFG.csrf };
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch(url, { method: opts.method || "GET", headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined,
                        credentials: "same-origin" })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw j; return j; });
      });
  }

  // ---------- render: cabeçalho ----------
  function renderHero(d) {
    var pill = document.getElementById("ai-status-pill");
    pill.className = "ai-status-pill " + d.status;
    document.getElementById("ai-status-text").textContent = ROTULO_STATUS[d.status] || d.status;
    document.getElementById("ai-mon-count").textContent = d.indicadores.total;
    document.getElementById("ai-updated").textContent = d.atualizado_hm;
    var hh = document.getElementById("ai-hero-health");
    hh.textContent = "";
    hh.appendChild(ring(d.saude.percentual, d.status, 74));
    hh.appendChild(el("div", "lbl", d.saude.operacionais + "/" + d.saude.total + " operacionais"));
  }

  function ring(pct, status, size) {
    var ns = "http://www.w3.org/2000/svg", r = 15.5, c = 2 * Math.PI * r;
    var wrap = el("div", "ai-ring " + status);
    wrap.style.width = wrap.style.height = size + "px";
    var s = document.createElementNS(ns, "svg"); s.setAttribute("viewBox", "0 0 36 36");
    [["track", c], ["bar", c * (1 - pct / 100)]].forEach(function (p) {
      var ci = document.createElementNS(ns, "circle");
      ci.setAttribute("cx", 18); ci.setAttribute("cy", 18); ci.setAttribute("r", r);
      ci.setAttribute("class", p[0]);
      if (p[0] === "bar") { ci.setAttribute("stroke-dasharray", c); ci.setAttribute("stroke-dashoffset", p[1]); }
      s.appendChild(ci);
    });
    wrap.appendChild(s);
    wrap.appendChild(el("span", "pct", pct + "%"));
    return wrap;
  }

  // ---------- render: indicadores ----------
  var kpiAnterior = {};
  function renderKpis(i) {
    var box = document.getElementById("ai-kpis");
    box.textContent = "";
    var tiles = [
      ["total", "Dispositivos", i.total, "cadastrados no sistema"],
      ["on", "Ligados", i.ligados, "ativos agora"],
      ["off", "Desligados", i.desligados, "inativos agora"],
      ["portas", "Portas", i.portas_abertas + " aberta" + (i.portas_abertas === 1 ? "" : "s"), i.portas_fechadas + " fechada(s)", i.portas_abertas > 0],
      ["janelas", "Janelas", i.janelas_abertas + " aberta" + (i.janelas_abertas === 1 ? "" : "s"), i.janelas_fechadas + " fechada(s)", i.janelas_abertas > 0],
      ["alerta", "Com alertas", i.com_alerta, "dispositivo(s) com ocorrência", i.com_alerta > 0],
      ["auto", "Automações", i.automacoes, "programadas e ativas"]
    ];
    tiles.forEach(function (t) {
      var tile = el("div", "card ai-kpi" + (t[4] ? " warn" : ""));
      var top = el("div", "ai-kpi-top");
      var ic = el("span", "ai-kpi-icon"); ic.appendChild(svg(ICON[t[0]], 16));
      top.appendChild(ic); top.appendChild(el("span", "", t[1]));
      var val = el("div", "ai-kpi-value", String(t[2]));
      if (kpiAnterior[t[1]] !== undefined && kpiAnterior[t[1]] !== String(t[2])) val.classList.add("bump");
      kpiAnterior[t[1]] = String(t[2]);
      tile.appendChild(top); tile.appendChild(val); tile.appendChild(el("div", "ai-kpi-hint", t[3]));
      box.appendChild(tile);
    });
  }

  // ---------- render: alertas ----------
  function renderAlertas(d) {
    document.getElementById("ai-tab-ativos").textContent = d.alertas_ativos.length;
    var box = document.getElementById("ai-alerts");
    box.textContent = "";
    var lista = aba === "ativos" ? d.alertas_ativos : d.alertas_historico;
    if (!lista.length) {
      var vazio = el("div", "ai-empty");
      vazio.appendChild(svg("M5 12 L10 17 L19 7", 22));
      vazio.appendChild(el("div", "", aba === "ativos"
        ? "Nenhuma ocorrência agora. Todos os dispositivos estão dentro dos limites configurados."
        : "Nenhum alerta resolvido ainda."));
      box.appendChild(vazio);
      return;
    }
    lista.forEach(function (a) {
      var card = el("article", "ai-alert " + a.prioridade + (a.status === "visto" ? " visto" : "") + (a.status === "resolvido" ? " resolvido" : ""));
      var head = el("div", "ai-alert-head");
      head.appendChild(el("span", "ai-prio " + a.prioridade, a.prioridade_rotulo));
      head.appendChild(el("span", "ai-alert-type", a.tipo_rotulo));
      head.appendChild(el("span", "ai-alert-time", a.detectado_data + " · " + a.detectado_hm));
      card.appendChild(head);
      card.appendChild(el("div", "ai-alert-title", a.titulo));
      if (a.dispositivo) card.appendChild(el("div", "ai-alert-dev", a.dispositivo.nome + " · " + a.comodo));
      card.appendChild(el("p", "ai-alert-desc", a.descricao));
      var sug = el("div", "ai-alert-sug");
      sug.appendChild(el("b", "", "Sugestão: ")); sug.appendChild(document.createTextNode(a.sugestao));
      card.appendChild(sug);

      var acts = el("div", "ai-alert-actions");
      if (a.status === "resolvido") {
        acts.appendChild(el("span", "ai-alert-resolved", "Resolvido às " + (a.resolvido_hm || "—") + " · " + (a.resolvido_por || "")));
      } else if (a.pode_gerenciar) {
        if (a.status !== "visto") acts.appendChild(botao("Marcar como visto", "btn-ghost", function () { acaoAlerta(a.id, "visto"); }));
        acts.appendChild(botao("Resolver", "btn-accent", function () { acaoAlerta(a.id, "resolver"); }));
      } else {
        acts.appendChild(el("span", "ai-alert-resolved", "Sem permissão para gerenciar este dispositivo"));
      }
      if (a.dispositivo) {
        var link = el("a", "ai-map-link");
        link.href = linkMaquete(a.dispositivo.nome);
        link.appendChild(svg(ICON.mapa, 14)); link.appendChild(document.createTextNode("Ver na maquete"));
        acts.appendChild(link);
      }
      card.appendChild(acts);
      box.appendChild(card);
    });
  }
  function botao(texto, cls, fn) {
    var b = el("button", cls, texto); b.type = "button"; b.addEventListener("click", fn); return b;
  }
  function acaoAlerta(id, acao) {
    api(CFG.alertaBase + id + "/" + acao, { method: "POST" })
      .then(function () { carregar(true); })
      .catch(function (e) { alert((e && e.erro) || "Não foi possível atualizar o alerta."); });
  }

  // ---------- render: monitoramento ----------
  function renderMonitor(d) {
    var box = document.getElementById("ai-monitor");
    box.textContent = "";
    var alertaPorDisp = {};
    var peso = { info: 1, atencao: 2, critico: 3 };
    d.alertas_ativos.forEach(function (a) {
      if (!a.dispositivo) return;
      var atual = alertaPorDisp[a.dispositivo.id];
      if (!atual || peso[a.prioridade] > peso[atual]) alertaPorDisp[a.dispositivo.id] = a.prioridade;
    });
    d.categorias.forEach(function (cat) {
      var itens = d.dispositivos.filter(function (x) { return x.categoria === cat.id; });
      if (!itens.length) return;
      var card = el("div", "ai-mon-card");
      var head = el("div", "ai-mon-head");
      var ic = el("span", "ai-kpi-icon"); ic.appendChild(svg(ICON[cat.id] || ICON.outros, 16));
      head.appendChild(ic); head.appendChild(el("span", "ai-mon-title", cat.nome));
      var ativos = itens.filter(function (x) { return x.ativo; }).length;
      head.appendChild(el("span", "ai-mon-count", ativos + "/" + itens.length + (cat.id === "portas" || cat.id === "janelas" ? " abertas" : " ativos")));
      card.appendChild(head);
      itens.forEach(function (x) {
        var row = el("div", "ai-dev" + (x.ativo ? " on" : "") + (alertaPorDisp[x.id] ? " al-" + alertaPorDisp[x.id] : ""));
        row.appendChild(el("span", "ai-dev-dot"));
        var info = el("div", "ai-dev-info");
        var nome = el("a", "ai-dev-name", x.nome); nome.href = CFG.detalheBase + x.id;
        info.appendChild(nome);
        info.appendChild(el("div", "ai-dev-room", x.comodo));
        row.appendChild(info);
        var st = el("div", "ai-dev-state");
        st.appendChild(el("div", "v", x.estado));
        var desde = el("div", "t", x.desde ? (x.desde_hm + " · " + duracao(x.desde)) : "sem registro de horário");
        if (x.desde) { desde.dataset.desde = x.desde; desde.dataset.prefixo = x.desde_hm + " · "; }
        st.appendChild(desde);
        row.appendChild(st);
        card.appendChild(row);
      });
      if (cat.id === "portas" && d.garagem) {
        card.appendChild(el("div", "ai-mon-note", "Veículo: " + d.garagem.veiculo));
      }
      box.appendChild(card);
    });
  }

  // ---------- render: saúde, resumo, linha do tempo ----------
  function renderSaude(s, status) {
    var box = document.getElementById("ai-health");
    box.textContent = "";
    var top = el("div", "ai-health-top");
    top.appendChild(ring(s.percentual, status, 96));
    var nums = el("div", "ai-health-nums");
    [["ok", "Operacionais", s.operacionais], ["atencao", "Atenção", s.atencao.length], ["critico", "Críticos", s.criticos.length]]
      .forEach(function (n) {
        var row = el("div", "ai-health-row " + n[0]);
        row.appendChild(el("span", "dot")); row.appendChild(el("span", "", n[1])); row.appendChild(el("b", "", String(n[2])));
        nums.appendChild(row);
      });
    top.appendChild(nums);
    box.appendChild(top);
    s.criticos.concat(s.atencao).length && box.appendChild(el("div", "ai-health-list",
      "Precisam de atenção: " + s.criticos.concat(s.atencao).join(", ")));
    var det = el("details", "ai-criteria");
    det.appendChild(el("summary", "", "Como este indicador é calculado"));
    var ul = el("ul");
    s.criterios.forEach(function (c) { ul.appendChild(el("li", "", c)); });
    det.appendChild(ul);
    box.appendChild(det);
  }

  function renderResumo(r) {
    document.getElementById("ai-summary-date").textContent = r.data;
    var box = document.getElementById("ai-summary");
    box.textContent = "";
    var grid = el("div", "ai-sum-grid");
    [["Dispositivos usados", r.dispositivos_usados], ["Mudanças de estado", r.eventos],
     ["Consumo hoje", r.kwh.toFixed(2).replace(".", ",") + " kWh"], ["Custo hoje", "R$ " + r.custo.toFixed(2).replace(".", ",")]]
      .forEach(function (x) {
        var c = el("div", "ai-sum-item"); c.appendChild(el("div", "v", String(x[1]))); c.appendChild(el("div", "l", x[0])); grid.appendChild(c);
      });
    box.appendChild(grid);
    var linhas = el("ul", "ai-sum-list");
    linhas.appendChild(el("li", "", "Por pessoas: " + r.por_pessoas + " · por automação: " + r.por_automacao));
    linhas.appendChild(el("li", "", "Alertas hoje: " + r.alertas.critico + " crítico(s), " + r.alertas.atencao + " de atenção, " + r.alertas.info + " informativo(s)"));
    r.principais.forEach(function (p) { linhas.appendChild(el("li", "", "Ocorrência: " + p)); });
    linhas.appendChild(el("li", "", r.automacoes_restantes.length ? "Automações ainda hoje: " + r.automacoes_restantes.join(", ") : "Nenhuma automação restante hoje"));
    box.appendChild(linhas);
  }

  function renderTimeline(itens) {
    var box = document.getElementById("ai-timeline");
    box.textContent = "";
    if (!itens.length) { box.appendChild(el("div", "ai-empty", "Nada registrado nas últimas 24 horas.")); return; }
    itens.forEach(function (i) {
      var row = el("div", "ai-tl " + i.tipo + (i.prioridade ? " " + i.prioridade : ""));
      row.appendChild(el("span", "ai-tl-time", i.hm));
      row.appendChild(el("span", "ai-tl-dot"));
      var txt = el("div", "ai-tl-text");
      txt.appendChild(el("div", "", i.texto));
      txt.appendChild(el("div", "ai-tl-author", i.autor));
      row.appendChild(txt);
      box.appendChild(row);
    });
  }

  function renderRecs(recs) {
    var box = document.getElementById("ai-recs");
    box.textContent = "";
    if (!recs.length) { box.appendChild(el("div", "ai-empty", "Os dados atuais não indicam nenhuma melhoria clara.")); return; }
    recs.forEach(function (r) {
      var c = el("article", "ai-rec");
      c.appendChild(el("span", "ai-rec-cat", r.categoria));
      c.appendChild(el("div", "ai-rec-title", r.titulo));
      var j = el("div", "ai-rec-just"); j.appendChild(el("b", "", "Base nos dados: ")); j.appendChild(document.createTextNode(r.justificativa));
      c.appendChild(j);
      c.appendChild(el("div", "ai-rec-sug", r.sugestao));
      box.appendChild(c);
    });
  }

  // ---------- ciclo de atualização ----------
  function carregar(forcar) {
    if (document.hidden && !forcar) return;
    api(CFG.estado).then(function (d) {
      document.getElementById("ai-updated").textContent = d.atualizado_hm;
      if (!forcar && d.versao === versao) return;
      versao = d.versao; estado = d;
      renderHero(d); renderKpis(d.indicadores); renderAlertas(d); renderMonitor(d);
      renderSaude(d.saude, d.status); renderResumo(d.resumo); renderTimeline(d.linha_do_tempo);
    }).catch(function () {
      var pill = document.getElementById("ai-status-pill");
      pill.className = "ai-status-pill offline";
      document.getElementById("ai-status-text").textContent = "Sem conexão com o servidor";
    });
  }
  function carregarRecs() {
    if (document.hidden) return;
    api(CFG.recomendacoes).then(renderRecs).catch(function () {});
  }

  document.querySelectorAll(".ai-tabs .chip").forEach(function (b) {
    b.addEventListener("click", function () {
      aba = b.dataset.aba;
      document.querySelectorAll(".ai-tabs .chip").forEach(function (x) { x.classList.toggle("active", x === b); });
      if (estado) renderAlertas(estado);
    });
  });

  // durações "há X min" andam sozinhas, sem precisar consultar o servidor
  setInterval(function () {
    document.querySelectorAll("[data-desde]").forEach(function (n) { n.textContent = n.dataset.prefixo + duracao(n.dataset.desde); });
  }, 30000);

  carregar(true); carregarRecs();
  setInterval(carregar, 6000);
  setInterval(carregarRecs, 90000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) carregar(); });

  // ---------- assistente ----------
  var log = document.getElementById("ai-chat-log");
  var form = document.getElementById("ai-chat-form");
  var input = document.getElementById("ai-chat-input");
  var CHAVE = "pulse-ai-chat";
  var historico = [];
  try { historico = JSON.parse(sessionStorage.getItem(CHAVE) || "[]"); } catch (e) { historico = []; }

  function salvar() { try { sessionStorage.setItem(CHAVE, JSON.stringify(historico.slice(-40))); } catch (e) { /* ignore */ } }

  function bolha(msg) {
    var b = el("div", "ai-msg " + msg.de);
    if (msg.de === "ai") {
      var av = el("span", "ai-msg-avatar"); av.appendChild(svg("M12 4.5 V19.5|M12 7.5 H15 L16.5 6|M12 12 H17.5|M12 16.5 H15 L16.5 18|M12 5.2 A3 3 0 0 0 6.4 6.3 A3 3 0 0 0 4.3 10.5 A3.2 3.2 0 0 0 5 16 A3 3 0 0 0 9.3 19 A2.6 2.6 0 0 0 12 19.5", 15));
      b.appendChild(av);
    }
    var corpo = el("div", "ai-msg-body");
    corpo.appendChild(el("div", "", msg.texto));
    if (msg.itens && msg.itens.length) {
      var ul = el("ul");
      msg.itens.forEach(function (i) { ul.appendChild(el("li", "", i)); });
      corpo.appendChild(ul);
    }
    if (msg.acao && !msg.acaoFeita) {
      var acts = el("div", "ai-msg-actions");
      acts.appendChild(botao(msg.acao.rotulo + " " + msg.acao.nome, "btn-accent", function () { executar(msg); }));
      acts.appendChild(botao("Cancelar", "btn-ghost", function () { msg.acaoFeita = "cancelada"; salvar(); desenharChat(); }));
      corpo.appendChild(acts);
    } else if (msg.acaoFeita === "cancelada") {
      corpo.appendChild(el("div", "ai-msg-note", "Ação cancelada."));
    }
    b.appendChild(corpo);
    return b;
  }
  function desenharChat() {
    log.textContent = "";
    if (!historico.length) {
      log.appendChild(bolha({ de: "ai", texto: "Olá! Sou o PULSE AI. Pergunte sobre luzes, portas, garagem, consumo, alertas ou automações. Posso também ligar ou desligar dispositivos — sempre pedindo sua confirmação." }));
    }
    historico.forEach(function (m) { log.appendChild(bolha(m)); });
    log.scrollTop = log.scrollHeight;
  }
  function enviar(texto) {
    texto = (texto || "").trim();
    if (!texto) return;
    historico.push({ de: "user", texto: texto });
    var pensando = { de: "ai", texto: "Consultando os dados da casa…" };
    historico.push(pensando);
    desenharChat();
    api(CFG.chat, { method: "POST", body: { mensagem: texto } }).then(function (r) {
      historico[historico.indexOf(pensando)] = { de: "ai", texto: r.texto, itens: r.itens, acao: r.acao };
    }).catch(function () {
      historico[historico.indexOf(pensando)] = { de: "ai", texto: "Não consegui falar com o servidor agora." };
    }).then(function () { salvar(); desenharChat(); });
  }
  function executar(msg) {
    msg.acaoFeita = "executando";
    api(CFG.executar, { method: "POST", body: { dispositivo_id: msg.acao.dispositivo_id, acao: msg.acao.acao, pedido: msg.acao.pedido } })
      .then(function (r) { historico.push({ de: "ai", texto: r.texto }); })
      .catch(function (e) { historico.push({ de: "ai", texto: (e && e.erro) || "Não foi possível executar a ação." }); })
      .then(function () { salvar(); desenharChat(); carregar(true); });
    desenharChat();
  }

  form.addEventListener("submit", function (ev) { ev.preventDefault(); enviar(input.value); input.value = ""; });
  document.getElementById("ai-chat-suggest").addEventListener("click", function (ev) {
    var chip = ev.target.closest(".chip"); if (chip) enviar(chip.textContent);
  });
  document.getElementById("ai-chat-clear").addEventListener("click", function () { historico = []; salvar(); desenharChat(); });
  desenharChat();
})();
