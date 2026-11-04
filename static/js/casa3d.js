/**
 * Maquete 3D do dashboard — residência inteligente PULSE2050 em Three.js,
 * conectada ao banco de verdade: os 13 dispositivos do seed têm objeto
 * correspondente na cena (mapeados por nome, ver NAME_TO_SCENE), refletem
 * dispositivo.ativo ao carregar, clicar chama a mesma rota
 * POST /dispositivo/<id>/alternar que o resto do app usa, e um poll periódico
 * em /api/dispositivos pega mudanças feitas pelo agendador ou por outra aba.
 *
 * Organização do arquivo (cada bloco é independente e comentado):
 *   1. renderer, cena, câmera e luz natural (dia/noite)
 *   2. texturas procedurais (madeira, porcelanato, concreto, grama...)
 *   3. fábricas de geometria (box/cyl/sph/at/wall/glassWall/floorAt)
 *   4. arquitetura: planta baixa, paredes, vidros, fachada
 *   5. cômodos: garagem, sala, cozinha, quarto, hall/escritório, banheiro
 *   6. área externa: jardim, piscina, entrada, rua
 *   7. dispositivos (registerDevice) — a ponte com o banco
 *   8. carro + sequência da garagem inteligente
 *   9. moradores (casal + cachorro) com caminhada por waypoints
 *  10. portas automáticas com sensor de presença
 *  11. tour automático, HUD, integração com o back-end e laço de animação
 *  12. PULSE AI: holograma do agente, varredura, marcadores de alerta e foco
 *
 * Planta (metros; +z é a frente da casa, voltada pra rua):
 *   Garagem  x[-13,-7] z[0,6]   |  Sala     x[-7,0] z[0,6]  | Hall/Escritório x[0,7] z[0,6]
 *   Deck     x[-11.6,-7.2] z<0  |  Cozinha  x[-7,0] z[-6,0] | Quarto          x[0,7] z[-6,0]
 *                                                             Banheiro        x[4,7] z[0,3]
 *
 * Carregada só quando a aba "Maquete 3D" é aberta pela primeira vez (ver
 * dashboard.html) — não pesa no carregamento normal do painel.
 */
window.iniciarCasa3D = function (opts) {
  "use strict";

  var NAME_TO_SCENE = {
    "Luz da Sala": "luz-sala",
    "TV da Sala": "tv-sala",
    "Luz da Cozinha": "luz-cozinha",
    "Robô Aspirador": "robo",
    "Luz do Quarto": "luz-quarto",
    "Ar-condicionado": "ac",
    "Janela do Quarto": "janela-quarto",
    "Porta da Garagem": "porta-garagem",
    "Luz Externa": "luz-externa",
    "Câmera Externa": "camera-externa",
    "Câmera da Sala": "camera-sala",
    "Geladeira": "geladeira",
    "Luz da Garagem": "luz-garagem"
  };

  opts.deviceMap = {};
  (opts.dispositivos || []).forEach(function (d) {
    var sceneId = NAME_TO_SCENE[d.nome];
    if (sceneId) opts.deviceMap[sceneId] = d;
  });

  // reducedMotion: respeita a preferência de acessibilidade do sistema —
  // desliga as animações (moradores, carro, tour automático).
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var wrap = document.getElementById('iso3d-wrap');
  var appEl = document.getElementById('iso3d-app');

  var PI = Math.PI;
  var ACCENT = 0x2fd8cf, WARM = 0xffc489, COOL = 0xbfe0ff;
  var WALL_H = 2.8, WALL_T = 0.2;
  var C = {
    wall: 0xe9e5de, coping: 0x2b2f34, metal: 0x2b2f35, steel: 0xaab1b8, glass: 0xa9d6e8,
    oak: 0xb98b5f, walnut: 0x6a4630, fabric: 0x8f8b84, fabricDark: 0x4f4c48, white: 0xf2f0eb,
    black: 0x121315, stone: 0xedebe6, plant: 0x2f6a38, plantDark: 0x1d4424, pot: 0x34363a,
    graphite: 0x3a3e44, concrete: 0x8b8984
  };

  // =====================================================================
  // 1. renderer, cena, câmera e iluminação natural
  // =====================================================================
  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (renderer.outputEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  appEl.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070a12);
  scene.fog = new THREE.Fog(0x070a12, 32, 80);

  var camera = new THREE.PerspectiveCamera(50, wrap.clientWidth / wrap.clientHeight, 0.08, 220);
  camera.position.set(16, 13, 24);

  var hemi = new THREE.HemisphereLight(0x3a4866, 0x0c0c0c, 0.5);
  scene.add(hemi);
  var ambient = new THREE.AmbientLight(0xffffff, 0.07);
  scene.add(ambient);
  // "sun" é o sol de dia e o luar à noite — a mesma luz direcional com sombra,
  // só muda cor/intensidade/posição (ver applyDayNight).
  var sun = new THREE.DirectionalLight(0x9fb6d9, 0.5);
  sun.position.set(-14, 22, 12);
  sun.target.position.set(-3, 0, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -24; sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24; sun.shadow.camera.bottom = -24;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun); scene.add(sun.target);

  var starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, transparent: true, opacity: 0.65, fog: false });
  (function stars() {
    var n = 700, pos = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var r = 80 + Math.random() * 30, theta = Math.random() * PI * 2, phi = Math.random() * PI * 0.5;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = 10 + r * Math.cos(phi) * 0.6;
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, starMat));
  })();

  // Dia/noite: dayT vai de 0 (noite) a 1 (dia) suavemente; o padrão segue o
  // relógio de quem está vendo (dia entre 7h e 18h).
  var NIGHT = { sky: new THREE.Color(0x070a12), hs: new THREE.Color(0x3a4866), hg: new THREE.Color(0x0c0c0c), sun: new THREE.Color(0x9fb6d9), pos: new THREE.Vector3(-14, 22, 12) };
  var DAY = { sky: new THREE.Color(0xa9c9e6), hs: new THREE.Color(0xe4f0ff), hg: new THREE.Color(0x6b5a45), sun: new THREE.Color(0xfff1dc), pos: new THREE.Vector3(14, 26, 16) };
  var hourNow = new Date().getHours();
  var isDay = hourNow >= 7 && hourNow < 18;
  var dayT = isDay ? 1 : 0;
  var sunBase = new THREE.Vector3();
  function applyDayNight(t) {
    scene.background.copy(NIGHT.sky).lerp(DAY.sky, t);
    scene.fog.color.copy(scene.background);
    scene.fog.far = 80 + 40 * t;
    hemi.color.copy(NIGHT.hs).lerp(DAY.hs, t);
    hemi.groundColor.copy(NIGHT.hg).lerp(DAY.hg, t);
    hemi.intensity = 0.32 + 0.53 * t;
    sun.color.copy(NIGHT.sun).lerp(DAY.sun, t);
    sun.intensity = 0.3 + 1.3 * t;
    sunBase.copy(NIGHT.pos).lerp(DAY.pos, t);
    sun.position.copy(sun.target.position).add(sunBase);
    starMat.opacity = 0.65 * (1 - t);
    renderer.toneMappingExposure = 1.12 - 0.14 * t;
  }
  applyDayNight(dayT);

  // =====================================================================
  // 2. texturas procedurais (desenhadas num <canvas>, sem arquivos externos)
  // =====================================================================
  var maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function canvasTex(w, h, draw) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = Math.min(8, maxAniso);
    return t;
  }
  function texRep(base, rx, ry) { var t = base.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return t; }
  function speckle(g, w, h, n, dark, light) {
    for (var i = 0; i < n; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,' + (dark * Math.random()) + ')' : 'rgba(255,255,255,' + (light * Math.random()) + ')';
      g.fillRect(Math.random() * w, Math.random() * h, rnd(1, 2.5), rnd(1, 2.5));
    }
  }
  function drawPlank(g, x, y, len, rh, col, gap) {
    g.fillStyle = col; g.fillRect(x, y, len, rh);
    for (var k = 0; k < 7; k++) {
      g.strokeStyle = 'rgba(40,22,10,' + rnd(0.04, 0.12) + ')';
      g.lineWidth = rnd(0.6, 1.6);
      var yy = y + rnd(2, rh - 2);
      g.beginPath(); g.moveTo(x, yy);
      g.bezierCurveTo(x + len * 0.3, yy + rnd(-3, 3), x + len * 0.6, yy + rnd(-3, 3), x + len, yy + rnd(-2, 2));
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(x, y, gap, rh);
    g.fillRect(x, y, len, gap * 0.6);
  }
  function planks(g, s, rows, hue, sat, lum, gap) {
    var rh = s / rows;
    for (var r = 0; r < rows; r++) {
      var y = r * rh, x0 = rnd(0, s), covered = 0;
      while (covered < s - 1) {
        var len = Math.min(rnd(s * 0.3, s * 0.75), s - covered);
        var col = 'hsl(' + (hue + rnd(-3, 3)) + ',' + (sat + rnd(-5, 5)) + '%,' + (lum + rnd(-6, 6)) + '%)';
        var x = (x0 + covered) % s;
        drawPlank(g, x, y, len, rh, col, gap);
        if (x + len > s) drawPlank(g, x - s, y, len, rh, col, gap);
        covered += len;
      }
    }
  }
  var TEX = {
    wood: canvasTex(512, 512, function (g, s) { planks(g, s, 8, 30, 38, 50, 2); }),
    deck: canvasTex(512, 512, function (g, s) { planks(g, s, 6, 26, 28, 34, 5); }),
    tile: canvasTex(512, 512, function (g, s) {
      var n = 4, ts = s / n;
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) { g.fillStyle = 'hsl(40,6%,' + rnd(84, 89) + '%)'; g.fillRect(i * ts, j * ts, ts, ts); }
      speckle(g, s, s, 2500, 0.06, 0.1);
      g.fillStyle = 'rgba(80,75,70,0.35)';
      for (var k = 0; k <= n; k++) { g.fillRect(k * ts - 1.5, 0, 3, s); g.fillRect(0, k * ts - 1.5, s, 3); }
    }),
    concrete: canvasTex(512, 512, function (g, s) {
      g.fillStyle = '#8f8d88'; g.fillRect(0, 0, s, s);
      for (var i = 0; i < 40; i++) {
        var x = rnd(0, s), y = rnd(0, s), r = rnd(20, 90), a = rnd(0.03, 0.08);
        var gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, Math.random() < 0.5 ? 'rgba(0,0,0,' + a + ')' : 'rgba(255,255,255,' + a + ')');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      speckle(g, s, s, 6000, 0.12, 0.1);
    }),
    grass: canvasTex(512, 512, function (g, s) {
      g.fillStyle = '#2c4424'; g.fillRect(0, 0, s, s);
      for (var i = 0; i < 9000; i++) { g.fillStyle = 'hsl(' + rnd(85, 115) + ',' + rnd(30, 50) + '%,' + rnd(14, 32) + '%)'; g.fillRect(rnd(0, s), rnd(0, s), rnd(1, 2), rnd(2, 5)); }
    }),
    paver: canvasTex(512, 512, function (g, s) {
      g.fillStyle = '#4b4a47'; g.fillRect(0, 0, s, s);
      var rows = 8, rh = s / rows, cw = s / 4;
      for (var r = 0; r < rows; r++) {
        var off = (r % 2) * cw / 2;
        for (var c = -1; c < 5; c++) { g.fillStyle = 'hsl(30,4%,' + rnd(52, 62) + '%)'; g.fillRect(c * cw + off + 2, r * rh + 2, cw - 4, rh - 4); }
      }
      speckle(g, s, s, 3000, 0.12, 0.08);
    }),
    asphalt: canvasTex(256, 256, function (g, s) { g.fillStyle = '#232427'; g.fillRect(0, 0, s, s); speckle(g, s, s, 4000, 0.25, 0.12); }),
    slats: canvasTex(64, 256, function (g, w, h) {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      for (var y = 0; y < h; y += 16) { g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, y, w, 3); }
    }),
    solar: canvasTex(256, 256, function (g, s) {
      g.fillStyle = '#0d1a33'; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(160,190,230,0.45)'; g.lineWidth = 2;
      for (var i = 0; i <= s; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, s); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(s, i); g.stroke(); }
    })
  };
  function paintingTex(seed) {
    var pal = [['#1f3b4d', '#2fd8cf', '#e9d8b4', '#c96f4a'], ['#2b2b33', '#d9b26f', '#7aa6a1', '#efe7da'], ['#e8e2d6', '#26413c', '#b75d3c', '#1b1b1f']][seed % 3];
    return canvasTex(256, 320, function (g, w, h) {
      g.fillStyle = pal[0]; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 6; i++) {
        g.fillStyle = pal[1 + (i % 3)]; g.globalAlpha = rnd(0.55, 0.95);
        if (i % 2) { g.beginPath(); g.arc(rnd(40, w - 40), rnd(40, h - 40), rnd(20, 70), 0, PI * 2); g.fill(); }
        else g.fillRect(rnd(0, w * 0.6), rnd(0, h * 0.7), rnd(40, 140), rnd(10, 90));
      }
      g.globalAlpha = 1;
    });
  }
  var tvTex = canvasTex(512, 288, function (g, w, h) {
    var gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#061a2e'); gr.addColorStop(0.55, '#0d5b66'); gr.addColorStop(1, '#1d1f4d');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 6; i++) {
      var x = rnd(0, w), y = rnd(0, h), r = rnd(40, 120);
      var rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'rgba(47,216,207,0.35)'); rg.addColorStop(1, 'rgba(47,216,207,0)');
      g.fillStyle = rg; g.fillRect(0, 0, w, h);
    }
    g.fillStyle = '#e9fffd'; g.font = 'bold 46px "Space Grotesk", sans-serif'; g.fillText('PULSE2050', 34, 150);
    g.font = '20px "Manrope", sans-serif'; g.fillStyle = 'rgba(233,255,253,0.75)'; g.fillText('Casa inteligente · todos os sistemas ok', 36, 186);
  });
  tvTex.wrapS = tvTex.wrapT = THREE.ClampToEdgeWrapping;
  var signTex = canvasTex(1024, 192, function (g, w, h) {
    g.clearRect(0, 0, w, h);
    g.shadowColor = '#2fd8cf'; g.shadowBlur = 28;
    g.fillStyle = '#e9fffd'; g.font = 'bold 120px "Space Grotesk", sans-serif';
    g.fillText('PULSE 2050', 30, 140);
  });
  signTex.wrapS = signTex.wrapT = THREE.ClampToEdgeWrapping;

  // =====================================================================
  // 3. fábricas de geometria — escondem o "boilerplate" do Three.js atrás
  // de chamadas curtas. Materiais iguais são reaproveitados (cache), exceto
  // os de dispositivos (uniq: true), que mudam de brilho individualmente.
  // =====================================================================
  var matCache = {};
  function mat(color, o) {
    o = o || {};
    var key = o.uniq ? null : [color, o.r, o.m, o.e, o.ei, o.op, o.map ? o.map.uuid : '', o.flat ? 1 : 0].join('|');
    if (key && matCache[key]) return matCache[key];
    var m = new THREE.MeshStandardMaterial({
      color: color, roughness: o.r !== undefined ? o.r : 0.8, metalness: o.m || 0,
      emissive: o.e !== undefined ? o.e : 0x000000, emissiveIntensity: o.ei !== undefined ? o.ei : 1
    });
    if (o.map) m.map = o.map;
    if (o.flat) m.flatShading = true;
    if (o.op !== undefined && o.op < 1) { m.transparent = true; m.opacity = o.op; m.depthWrite = false; }
    if (key) matCache[key] = m;
    return m;
  }
  function glowMat(color, intensity) { return mat(color, { e: color, ei: intensity, r: 0.4, uniq: true }); }
  function mesh(geo, material, o) {
    o = o || {};
    var m = new THREE.Mesh(geo, material);
    var transparent = material.transparent;
    m.castShadow = o.cast !== undefined ? o.cast : !transparent;
    m.receiveShadow = o.recv !== false;
    return m;
  }
  function box(w, h, d, color, o) { o = o || {}; return mesh(new THREE.BoxGeometry(w, h, d), o.mat || mat(color, o), o); }
  function cyl(rt, rb, h, color, o, seg) { o = o || {}; return mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 20), o.mat || mat(color, o), o); }
  function sph(r, color, o) { o = o || {}; return mesh(new THREE.SphereGeometry(r, 18, 14), o.mat || mat(color, o), o); }
  function at(m, x, y, z, ry, parent) { m.position.set(x, y, z); if (ry) m.rotation.y = ry; (parent || scene).add(m); return m; }
  function group(x, y, z, ry, parent) { var g = new THREE.Group(); return at(g, x, y, z, ry, parent); }
  function floorAt(x0, z0, x1, z1, base, tile, o) {
    o = o || {};
    var w = x1 - x0, d = z1 - z0;
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({
      map: texRep(base, w / tile, d / tile), color: o.tint || 0xffffff, roughness: o.r !== undefined ? o.r : 0.7, metalness: o.m || 0
    }));
    m.rotation.x = -PI / 2;
    m.position.set((x0 + x1) / 2, o.y !== undefined ? o.y : 0.005, (z0 + z1) / 2);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  // Caixa com textura repetida no topo (piso externo, deck, entrada).
  function slab(x0, z0, x1, z1, top, h, base, tile, o) {
    o = o || {};
    var w = x1 - x0, d = z1 - z0;
    var m = box(w, h, d, o.tint || 0xffffff, { map: texRep(base, w / tile, d / tile), r: o.r !== undefined ? o.r : 0.85 });
    m.castShadow = false;
    return at(m, (x0 + x1) / 2, top - h / 2, (z0 + z1) / 2);
  }

  // Paredes: axis 'x' = parede corre ao longo de x (em z = fixed); 'z' = ao
  // longo de z (em x = fixed). openings = vãos {a, b, bottom, top} — portas
  // (bottom 0) e janelas (bottom > 0); o helper preenche peitoril e verga.
  function wallSeg(axis, fixed, s, e, y0, y1) {
    var len = e - s, h = y1 - y0, c = (s + e) / 2;
    if (len <= 0.001 || h <= 0.001) return;
    var m = axis === 'x' ? box(len, h, WALL_T, C.wall, { r: 0.92 }) : box(WALL_T, h, len, C.wall, { r: 0.92 });
    if (axis === 'x') m.position.set(c, y0 + h / 2, fixed); else m.position.set(fixed, y0 + h / 2, c);
    scene.add(m);
    if (y1 >= WALL_H - 0.001) {
      var cap = axis === 'x' ? box(len, 0.05, WALL_T + 0.04, C.coping, { r: 0.5, m: 0.4 }) : box(WALL_T + 0.04, 0.05, len, C.coping, { r: 0.5, m: 0.4 });
      cap.castShadow = false;
      if (axis === 'x') cap.position.set(c, WALL_H + 0.025, fixed); else cap.position.set(fixed, WALL_H + 0.025, c);
      scene.add(cap);
    }
  }
  function wall(axis, fixed, a, b, openings) {
    var ops = (openings || []).slice().sort(function (p, q) { return p.a - q.a; });
    var cur = a;
    ops.forEach(function (op) {
      wallSeg(axis, fixed, cur, op.a, 0, WALL_H);
      wallSeg(axis, fixed, op.a, op.b, 0, op.bottom || 0);
      wallSeg(axis, fixed, op.a, op.b, op.top, WALL_H);
      cur = op.b;
    });
    wallSeg(axis, fixed, cur, b, 0, WALL_H);
  }
  var glassMat = mat(C.glass, { op: 0.18, r: 0.05, m: 0.3 });
  function glassWall(axis, fixed, a, b, y0, y1, nDiv) {
    var len = b - a, h = y1 - y0, c = (a + b) / 2, yc = y0 + h / 2;
    var g = axis === 'x' ? box(len, h, 0.03, 0, { mat: glassMat }) : box(0.03, h, len, 0, { mat: glassMat });
    if (axis === 'x') g.position.set(c, yc, fixed); else g.position.set(fixed, yc, c);
    scene.add(g);
    function frame(p, y, w, hh) {
      var f = axis === 'x' ? box(w, hh, 0.12, C.metal, { r: 0.4, m: 0.6 }) : box(0.12, hh, w, C.metal, { r: 0.4, m: 0.6 });
      if (axis === 'x') f.position.set(p, y, fixed); else f.position.set(fixed, y, p);
      scene.add(f);
    }
    frame(c, y0 + 0.03, len, 0.06);
    frame(c, y1 - 0.03, len, 0.06);
    for (var i = 0; i <= nDiv; i++) frame(a + len * i / nDiv, yc, 0.06, h);
  }

  // Elementos decorativos reutilizados em vários cômodos.
  function pottedPlant(x, z, s) {
    s = s || 1;
    at(cyl(0.2 * s, 0.15 * s, 0.42 * s, C.pot, { r: 0.6 }), x, 0.21 * s, z);
    at(cyl(0.18 * s, 0.18 * s, 0.02, 0x3b2a1e), x, 0.42 * s, z);
    for (var i = 0; i < 7; i++) {
      var a = i / 7 * PI * 2;
      var leaf = sph(0.15 * s, i % 2 ? C.plant : C.plantDark, { r: 0.9 });
      leaf.scale.set(0.55, 1.7, 0.55);
      leaf.position.set(x + Math.cos(a) * 0.12 * s, 0.72 * s + (i % 3) * 0.06 * s, z + Math.sin(a) * 0.12 * s);
      leaf.rotation.z = Math.cos(a) * 0.45; leaf.rotation.x = Math.sin(a) * 0.45;
      scene.add(leaf);
    }
  }
  function tree(x, z, s) {
    at(cyl(0.09 * s, 0.14 * s, 1.7 * s, 0x4a3626, { r: 1 }), x, 0.85 * s - 0.15, z);
    var cols = [0x24472a, 0x2d5530, 0x1e3f22];
    [[0, 2.1, 0, 0.9], [0.45, 1.8, 0.2, 0.65], [-0.4, 1.9, -0.25, 0.7], [0.1, 2.6, -0.1, 0.6]].forEach(function (p, i) {
      var m = mesh(new THREE.IcosahedronGeometry(p[3] * s, 1), mat(cols[i % 3], { r: 0.95, flat: true }));
      at(m, x + p[0] * s, p[1] * s - 0.15, z + p[2] * s);
    });
  }
  function shrub(x, z, s) {
    var m = mesh(new THREE.IcosahedronGeometry(0.35 * s, 1), mat(C.plantDark, { r: 0.95, flat: true }));
    m.scale.y = 0.75;
    return at(m, x, 0.18 * s - 0.1, z);
  }
  function painting(x, y, z, ry, w, h, seed) {
    var g = group(x, y, z, ry);
    at(box(w + 0.06, h + 0.06, 0.03, 0x1a1a1a, { r: 0.5 }), 0, 0, 0, 0, g);
    var p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: paintingTex(seed), roughness: 0.9 }));
    at(p, 0, 0, 0.017, 0, g);
    return g;
  }
  function wallPanel(x, y, z, ry) {
    // tablet de automação na parede (interface física da casa)
    var g = group(x, y, z, ry);
    at(box(0.26, 0.18, 0.02, 0x101214, { r: 0.3 }), 0, 0, 0, 0, g);
    at(box(0.22, 0.14, 0.005, ACCENT, { e: ACCENT, ei: 0.55, r: 0.3 }), 0, 0, 0.012, 0, g).castShadow = false;
    return g;
  }

  // =====================================================================
  // 4. arquitetura: pisos, paredes, vidros e fachada
  // =====================================================================
  floorAt(-45, -45, 45, 45, TEX.grass, 4, { y: -0.15, r: 1 });
  at(box(14.4, 0.16, 12.4, C.concrete, { r: 0.92 }), 0, -0.08, 0).castShadow = false;
  at(box(6.2, 0.16, 6.4, C.concrete, { r: 0.92 }), -10.1, -0.08, 3.0).castShadow = false;

  floorAt(-7, 0, 0, 6, TEX.wood, 1.6);                                     // sala
  floorAt(-7, -6, 0, 0, TEX.tile, 2.4, { r: 0.35 });                       // cozinha
  floorAt(0, -6, 7, 0, TEX.wood, 1.6, { tint: 0xe2d2c2 });                 // quarto
  floorAt(0, 0, 7, 6, TEX.wood, 1.6);                                      // hall / escritório
  floorAt(4, 0, 7, 3, TEX.tile, 1.6, { y: 0.008, r: 0.3, tint: 0xc9c6c0 }); // banheiro
  floorAt(-13, 0, -7, 6, TEX.concrete, 3, { r: 0.35, m: 0.1, tint: 0xb8bcc2 }); // garagem (epóxi)

  // Perímetro
  wall('x', -6, -7.1, 7.1, []);                                                           // fundos
  wall('z', 7, -6.1, 6.1, [{ a: -4.2, b: -1.8, bottom: 0.8, top: 2.3 }]);                 // leste (janela do quarto)
  wall('z', -7, -6.1, 6.1, [{ a: -4.4, b: -0.8, bottom: 0, top: 2.4 }, { a: 0.4, b: 1.3, bottom: 0, top: 2.15 }]); // oeste (porta de vidro da cozinha + porta garagem→sala)
  wall('x', 6, -0.1, 7.1, [{ a: 1.0, b: 2.0, bottom: 0, top: 2.3 }, { a: 2.2, b: 3.9, bottom: 0.85, top: 2.3 }]); // fachada do hall
  // Garagem
  wall('x', 0, -13.1, -7.1, []);
  wall('z', -13, -0.1, 6.1, []);
  wall('x', 6, -13.1, -7.1, [{ a: -11.8, b: -8.2, bottom: 0, top: 2.45 }]);
  // Internas
  wall('x', 0, -6.9, -0.1, [{ a: -6.0, b: -1.0, bottom: 0, top: 2.55 }]);  // sala ↔ cozinha (integradas)
  wall('z', 0, -5.9, 5.9, [{ a: 3.5, b: 5.0, bottom: 0, top: 2.3 }]);      // sala ↔ hall
  wall('x', 0, 0.1, 6.9, [{ a: 0.8, b: 1.8, bottom: 0, top: 2.2 }]);       // hall ↔ quarto
  wall('z', 4, 0.1, 3.1, [{ a: 1.9, b: 2.8, bottom: 0, top: 2.2 }]);       // banheiro
  wall('x', 3, 4.1, 6.9, []);

  // Vidros: fachada da sala, porta da cozinha pro deck, janela do escritório.
  glassWall('x', 6, -6.9, -0.1, 0, WALL_H, 4);
  glassWall('z', -7, -4.4, -0.8, 0, 2.4, 2);
  glassWall('x', 6, 2.2, 3.9, 0.85, 2.3, 1);

  // Revestimentos da fachada: ripado de madeira, pilares grafite da garagem
  // e letreiro iluminado.
  at(box(3.05, WALL_H, 0.04, 0xffffff, { map: texRep(TEX.deck, 1.2, 1), r: 0.8 }), 5.55, WALL_H / 2, 6.12);
  at(box(1.25, WALL_H, 0.04, C.graphite, { r: 0.6, m: 0.3 }), -12.45, WALL_H / 2, 6.12);
  at(box(1.25, WALL_H, 0.04, C.graphite, { r: 0.6, m: 0.3 }), -7.55, WALL_H / 2, 6.12);
  at(box(3.6, 0.35, 0.04, C.graphite, { r: 0.6, m: 0.3 }), -10, 2.625, 6.12);
  var signMat = new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.9, transparent: true, roughness: 0.4 });
  at(new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.41), signMat), 5.55, 1.95, 6.15);
  // Marquise da entrada
  at(box(2.8, 0.12, 1.7, C.white, { r: 0.6 }), 1.5, 2.86, 6.85);
  var canopyLights = [];
  [0.75, 2.25].forEach(function (x) { var d = at(cyl(0.07, 0.07, 0.02, 0xffffff, { mat: null }), x, 2.79, 7.1); canopyLights.push(d); });

  // Fitas de LED arquitetônicas no topo das paredes externas (Luz Externa).
  var extStripMat = glowMat(ACCENT, 0.9);
  function extStrip(axis, fixed, a, b, side) {
    var len = b - a, c = (a + b) / 2, off = side * (WALL_T / 2 + 0.015);
    var m = axis === 'x' ? box(len, 0.03, 0.03, 0, { mat: extStripMat, cast: false }) : box(0.03, 0.03, len, 0, { mat: extStripMat, cast: false });
    if (axis === 'x') m.position.set(c, WALL_H - 0.1, fixed + off); else m.position.set(fixed + off, WALL_H - 0.1, c);
    scene.add(m);
  }
  extStrip('x', 6, -13.1, -6.9, 1); extStrip('x', 6, -0.1, 7.1, 1);
  extStrip('z', 7, -6.1, 6.1, 1); extStrip('x', -6, -7.1, 7.1, -1);
  extStrip('x', 0, -13.1, -7.1, -1); extStrip('z', -13, -0.1, 6.1, -1); extStrip('z', -7, -6.1, -0.1, -1);

  // =====================================================================
  // 5. cômodos
  // =====================================================================

  // ---------- GARAGEM ----------
  // Porta de enrolar: o painel "enrola" pra dentro do cassete no alto da
  // abertura (escala em y), então nunca invade o espaço do carro.
  var GDOOR_H = 2.45;
  var garageDoorMat = new THREE.MeshStandardMaterial({ color: 0x5a616a, map: texRep(TEX.slats, 1, 1), metalness: 0.5, roughness: 0.45 });
  var garageDoor = at(mesh(new THREE.BoxGeometry(3.6, GDOOR_H, 0.08), garageDoorMat), -10, GDOOR_H / 2, 6.0);
  var garageDoorLed = at(box(3.5, 0.03, 0.02, 0, { mat: glowMat(ACCENT, 1.0), cast: false }), -10, 0.03, 6.05);
  at(box(3.8, 0.32, 0.34, C.metal, { r: 0.4, m: 0.5 }), -10, 2.62, 5.78);
  // vigas do teto + fitas de LED (Luz da Garagem)
  var garageStripMat = glowMat(0xf4f8ff, 1.2);
  var garageStrips = [];
  [1.8, 4.2].forEach(function (z) {
    at(box(5.8, 0.12, 0.18, C.graphite, { r: 0.5, m: 0.3 }), -10, 2.72, z);
    garageStrips.push(at(box(5.4, 0.02, 0.08, 0, { mat: garageStripMat, cast: false }), -10, 2.65, z));
  });
  var garageLamp = new THREE.PointLight(0xf4f8ff, 0.8, 10, 2); garageLamp.position.set(-10, 2.4, 3); scene.add(garageLamp);
  // guias de LED no piso: acendem pelo sensor de presença quando o carro se move
  var guideMat = glowMat(ACCENT, 0.05);
  [-11.3, -8.7].forEach(function (x) { at(box(0.05, 0.012, 4.8, 0, { mat: guideMat, cast: false }), x, 0.012, 3.2); });
  at(box(1.6, 0.012, 0.08, 0xd9d9d9, { r: 0.6 }), -10, 0.012, 0.55);   // faixa de parada
  at(box(1.8, 0.1, 0.12, 0xd8b43a, { r: 0.6 }), -10, 0.05, 0.35);      // batente
  // sensor de presença sobre a porta (LED vermelho pisca quando detecta)
  at(box(0.16, 0.08, 0.1, 0xf2f2f2, { r: 0.4 }), -8.6, 2.42, 5.6);
  var sensorLedMat = glowMat(0xff4d4d, 0.2);
  at(sph(0.02, 0, { mat: sensorLedMat, cast: false }), -8.6, 2.37, 5.55);
  // carregador do carro elétrico na parede do fundo
  at(box(0.36, 0.5, 0.14, 0xf2f2f2, { r: 0.35 }), -8.2, 1.15, 0.17);
  var chargerLedMat = glowMat(ACCENT, 0.8);
  at(box(0.04, 0.3, 0.01, 0, { mat: chargerLedMat, cast: false }), -8.2, 1.15, 0.245);
  at(cyl(0.02, 0.02, 0.9, 0x111111), -8.2, 0.5, 0.2);
  // armários e bancada de ferramentas na parede oeste
  at(box(0.55, 2.1, 3.2, 0xdedbd4, { r: 0.6 }), -12.6, 1.05, 3.2);
  for (var gi = 0; gi < 4; gi++) at(box(0.01, 2.0, 0.01, 0x8a8a8a), -12.32, 1.05, 1.8 + gi * 0.8);
  at(box(0.4, 0.05, 1.4, 0x5a4636), -12.68, 1.0, 5.2);
  wallPanel(-7.11, 1.3, 1.6, -PI / 2);
  // porta garagem → sala (fechada)
  at(box(0.06, 2.12, 0.88, C.oak, { r: 0.6 }), -7.0, 1.06, 0.85);

  // ---------- SALA ----------
  // Painel ripado de madeira atrás da TV, TV fixada na parede, rack embaixo.
  at(box(0.03, WALL_H - 0.05, 3.4, 0xffffff, { map: texRep(TEX.deck, 1, 1.4), r: 0.75 }), -6.885, (WALL_H - 0.05) / 2, 3.2);
  var tvGroup = group(-6.85, 1.45, 3.2);
  var tvFrame = at(box(0.05, 0.98, 1.72, 0x0b0b0c, { r: 0.3, m: 0.4 }), 0, 0, 0, 0, tvGroup);
  var tvScreenMat = new THREE.MeshStandardMaterial({ color: 0x050607, emissive: 0xffffff, emissiveMap: tvTex, emissiveIntensity: 0, roughness: 0.2, metalness: 0.2 });
  var tvScreen = at(new THREE.Mesh(new THREE.PlaneGeometry(1.66, 0.92), tvScreenMat), 0.027, 0, 0, PI / 2, tvGroup);
  var tvBacklightMat = glowMat(ACCENT, 0);
  at(box(0.01, 1.2, 2.0, 0, { mat: tvBacklightMat, cast: false }), -0.03, 0, 0, 0, tvGroup);
  var tvGlow = new THREE.PointLight(0x7fd8ff, 0, 4.5, 2); tvGlow.position.set(-6.2, 1.45, 3.2); scene.add(tvGlow);
  // rack
  at(box(0.45, 0.42, 2.4, C.walnut, { r: 0.55 }), -6.65, 0.29, 3.2);
  at(box(0.38, 0.08, 2.3, 0x111111), -6.65, 0.04, 3.2);
  at(box(0.12, 0.08, 0.9, 0x1a1a1a, { r: 0.4 }), -6.62, 0.54, 3.2);       // soundbar
  at(cyl(0.06, 0.05, 0.22, 0xe7e2d8, { r: 0.4 }), -6.62, 0.61, 2.2);       // vaso
  at(box(0.18, 0.05, 0.25, 0x2a5b6b), -6.62, 0.525, 4.1);                  // livros
  at(box(0.18, 0.04, 0.24, 0xc96f4a), -6.62, 0.57, 4.1);
  // tapete, sofá e mesa de centro
  at(box(2.8, 0.015, 2.4, 0xcfc6b5, { r: 1 }), -4.5, 0.012, 3.2).castShadow = false;
  at(box(2.5, 0.016, 2.1, 0xb8ac97, { r: 1 }), -4.5, 0.014, 3.2).castShadow = false;
  var sofa = group(-2.75, 0, 3.2);
  at(box(0.95, 0.36, 2.5, C.fabricDark, { r: 0.95 }), 0, 0.24, 0, 0, sofa);
  at(box(0.9, 0.06, 2.4, 0x111111), 0, 0.03, 0, 0, sofa);
  [-0.8, 0, 0.8].forEach(function (z) {
    at(box(0.72, 0.14, 0.78, C.fabric, { r: 0.95 }), -0.1, 0.49, z, 0, sofa);
    at(box(0.2, 0.42, 0.76, C.fabric, { r: 0.95 }), 0.33, 0.76, z, 0, sofa);
  });
  [-1.16, 1.16].forEach(function (z) { at(box(0.95, 0.24, 0.18, C.fabricDark, { r: 0.95 }), 0, 0.54, z, 0, sofa); });
  at(box(0.12, 0.3, 0.38, 0x2fb5ad, { r: 0.9 }), 0.16, 0.7, -0.95, 0.15, sofa);
  at(box(0.12, 0.3, 0.38, 0xe0c38c, { r: 0.9 }), 0.16, 0.7, 0.95, -0.15, sofa);
  at(cyl(0.5, 0.5, 0.05, C.stone, { r: 0.3 }, 32), -4.3, 0.4, 3.2);
  at(cyl(0.22, 0.28, 0.38, C.walnut, { r: 0.5 }, 24), -4.3, 0.19, 3.2);
  at(box(0.28, 0.04, 0.2, 0x1f3b4d), -4.15, 0.445, 3.05);
  at(cyl(0.06, 0.05, 0.12, 0xe7e2d8), -4.45, 0.485, 3.35);
  at(sph(0.08, C.plant), -4.45, 0.58, 3.35);
  // luminária de piso (Luz da Sala) + sanca de LED + luz ambiente
  at(cyl(0.16, 0.18, 0.03, C.metal, { m: 0.6, r: 0.4 }), -3.55, 0.015, 1.75);
  at(cyl(0.015, 0.015, 1.5, C.metal, { m: 0.6, r: 0.4 }), -3.55, 0.78, 1.75);
  var salaLampMat = glowMat(WARM, 0.9);
  var salaLampShade = at(cyl(0.17, 0.22, 0.3, 0, { mat: salaLampMat }), -3.55, 1.62, 1.75);
  var salaCove = [
    at(box(0.03, 0.03, 5.6, 0, { mat: salaLampMat, cast: false }), -6.86, 2.62, 3.0),
    at(box(0.03, 0.03, 3.2, 0, { mat: salaLampMat, cast: false }), -0.13, 2.62, 1.8)
  ];
  var salaLight = new THREE.PointLight(WARM, 0.9, 10, 2); salaLight.position.set(-3.5, 2.4, 3); scene.add(salaLight);
  // câmera de segurança no canto
  var salaCam = group(-6.72, 2.45, 5.55, PI / 4);
  at(box(0.08, 0.06, 0.06, 0xeeeeee), -0.05, 0.08, 0, 0, salaCam);
  var salaCamHead = at(box(0.22, 0.12, 0.13, 0xf2f2f2, { r: 0.4 }), 0.06, 0, 0, 0, salaCam);
  at(cyl(0.04, 0.04, 0.03, 0x0a0a0a, {}, 16), 0.18, 0, 0, 0, salaCam).rotation.z = PI / 2;
  var salaCamLedMat = glowMat(0xff4d4d, 1.2);
  at(sph(0.015, 0, { mat: salaCamLedMat, cast: false }), 0.18, 0.05, 0.03, 0, salaCam);
  var salaCamBase = PI / 4;
  // decoração
  pottedPlant(-6.45, 5.5, 1.15);
  pottedPlant(-0.45, 0.5, 0.9);
  painting(-0.115, 1.6, 1.4, -PI / 2, 0.9, 1.1, 0);
  wallPanel(-0.11, 1.3, 3.15, -PI / 2);
  // caminha do cachorro
  at(cyl(0.38, 0.4, 0.12, 0x7a6a5a, { r: 1 }, 24), -4.9, 0.06, 5.2);
  at(cyl(0.3, 0.3, 0.04, 0xc9b9a3, { r: 1 }, 24), -4.9, 0.12, 5.2);

  // ---------- COZINHA ----------
  // geladeira (canto noroeste), bancada com pia e cooktop, armários,
  // coluna de forno/micro-ondas, ilha com banquetas e pendentes.
  var fridge = group(-6.45, 0, -5.52);
  var fridgeBodyMat = mat(0xb9bec4, { m: 0.7, r: 0.3, uniq: true });
  var fridgeBody = at(box(0.9, 2.0, 0.74, 0, { mat: fridgeBodyMat }), 0, 1.0, 0, 0, fridge);
  at(box(0.005, 1.9, 0.01, 0x333333), 0, 1.0, 0.375, 0, fridge);
  at(box(0.02, 0.6, 0.03, 0x444444, { m: 0.8 }), -0.06, 1.15, 0.39, 0, fridge);
  at(box(0.02, 0.6, 0.03, 0x444444, { m: 0.8 }), 0.06, 1.15, 0.39, 0, fridge);
  var fridgeScreenMat = glowMat(ACCENT, 0.6);
  var fridgeScreen = at(box(0.22, 0.3, 0.01, 0, { mat: fridgeScreenMat, cast: false }), 0.22, 1.35, 0.375, 0, fridge);
  // bancada
  at(box(4.95, 0.08, 0.6, 0x111111), -3.475, 0.04, -5.6);
  at(box(4.95, 0.8, 0.62, C.graphite, { r: 0.55 }), -3.475, 0.48, -5.59);
  for (var ki = 0; ki < 8; ki++) at(box(0.005, 0.76, 0.01, 0x15171a), -5.95 + 0.62 * (ki + 1), 0.48, -5.275);
  at(box(5.0, 0.04, 0.68, C.stone, { r: 0.25 }), -3.475, 0.9, -5.58);
  at(box(4.95, 0.62, 0.02, 0xd9d3c7, { r: 0.4 }), -3.475, 1.23, -5.89);
  // pia
  at(box(0.7, 0.02, 0.42, 0x6f747a, { m: 0.8, r: 0.3 }), -4.6, 0.915, -5.55);
  at(cyl(0.015, 0.015, 0.32, C.steel, { m: 0.9, r: 0.2 }), -4.6, 1.08, -5.78);
  at(box(0.03, 0.03, 0.22, C.steel, { m: 0.9, r: 0.2 }), -4.6, 1.23, -5.68);
  // cooktop + coifa
  at(box(0.72, 0.012, 0.5, 0x070707, { r: 0.1, m: 0.3 }), -2.7, 0.926, -5.55);
  var cookRings = [];
  [[-0.17, -0.11], [0.17, -0.11], [-0.17, 0.12], [0.17, 0.12]].forEach(function (p) {
    var r = mesh(new THREE.RingGeometry(0.06, 0.08, 24), glowMat(0xff5a2a, 0.0), { cast: false });
    r.rotation.x = -PI / 2; cookRings.push(at(r, -2.7 + p[0], 0.934, -5.55 + p[1]));
  });
  at(box(0.8, 0.12, 0.5, C.steel, { m: 0.8, r: 0.3 }), -2.7, 1.95, -5.65);
  at(box(0.3, 0.7, 0.28, C.steel, { m: 0.8, r: 0.3 }), -2.7, 2.36, -5.75);
  // armários superiores (com fita de LED por baixo — Luz da Cozinha)
  at(box(2.7, 0.75, 0.36, C.white, { r: 0.5 }), -4.6, 2.2, -5.72);
  at(box(1.15, 0.75, 0.36, C.white, { r: 0.5 }), -1.58, 2.2, -5.72);
  for (var ui = 0; ui < 4; ui++) at(box(0.005, 0.7, 0.01, 0xbdbab3), -5.95 + 0.675 * (ui + 1), 2.2, -5.535);
  var kitchenLightMat = glowMat(0xfff2d9, 1.1);
  var kitchenStrips = [
    at(box(2.6, 0.015, 0.04, 0, { mat: kitchenLightMat, cast: false }), -4.6, 1.81, -5.6),
    at(box(1.05, 0.015, 0.04, 0, { mat: kitchenLightMat, cast: false }), -1.58, 1.81, -5.6)
  ];
  // coluna de forno + micro-ondas
  at(box(0.8, 2.3, 0.64, C.graphite, { r: 0.55 }), -0.5, 1.15, -5.58);
  var microwaveDisplayMat = glowMat(ACCENT, 0.7);
  at(box(0.6, 0.36, 0.02, 0x0a0a0a, { r: 0.1, m: 0.4 }), -0.5, 1.5, -5.25);
  at(box(0.1, 0.04, 0.005, 0, { mat: microwaveDisplayMat, cast: false }), -0.32, 1.62, -5.237);
  at(box(0.6, 0.55, 0.02, 0x0a0a0a, { r: 0.1, m: 0.4 }), -0.5, 0.85, -5.25);
  at(box(0.5, 0.02, 0.03, C.steel, { m: 0.9 }), -0.5, 1.08, -5.23);
  // utensílios e decoração da bancada
  at(cyl(0.08, 0.09, 0.22, 0xe7e2d8, { r: 0.4 }), -5.6, 1.03, -5.65);
  at(cyl(0.07, 0.08, 0.2, C.black, { r: 0.3 }), -3.6, 1.02, -5.7);
  at(box(0.4, 0.02, 0.28, 0xb98b5f), -3.9, 0.93, -5.5);
  at(cyl(0.04, 0.04, 0.16, C.steel, { m: 0.8 }), -1.3, 1.0, -5.7);
  // ilha central
  at(box(2.6, 0.86, 1.0, 0xffffff, { map: texRep(TEX.wood, 1.2, 0.5), r: 0.6 }), -3.5, 0.45, -2.6);
  at(box(2.8, 0.05, 1.25, C.stone, { r: 0.25 }), -3.5, 0.905, -2.5);
  at(cyl(0.22, 0.16, 0.1, 0xe7e2d8, { r: 0.4 }, 24), -3.9, 0.98, -2.55);
  [[-3.95, -2.55], [-3.82, -2.48], [-3.9, -2.65]].forEach(function (p, i) { at(sph(0.05, [0xd84b3a, 0xf0b23a, 0x6aa84f][i]), p[0], 1.06, p[1]); });
  at(cyl(0.05, 0.06, 0.2, 0x2a2d33), -2.8, 1.03, -2.7);
  at(sph(0.09, C.plant), -2.8, 1.18, -2.7);
  // banquetas
  [-4.3, -3.5, -2.7].forEach(function (x) {
    at(cyl(0.2, 0.2, 0.02, C.metal, { m: 0.6 }), x, 0.01, -1.55);
    at(cyl(0.025, 0.025, 0.64, C.metal, { m: 0.6 }), x, 0.33, -1.55);
    at(cyl(0.19, 0.18, 0.06, C.walnut, { r: 0.6 }), x, 0.68, -1.55);
    at(box(0.32, 0.18, 0.03, C.walnut, { r: 0.6 }), x, 0.86, -1.38);
  });
  // viga + pendentes sobre a ilha
  at(box(6.8, 0.12, 0.18, C.graphite, { r: 0.5, m: 0.3 }), -3.5, 2.72, -2.6);
  var pendants = [];
  [-4.4, -3.5, -2.6].forEach(function (x) {
    at(cyl(0.006, 0.006, 0.75, 0x111111), x, 2.28, -2.6);
    at(cyl(0.05, 0.16, 0.18, C.black, { r: 0.4, m: 0.4 }), x, 1.83, -2.6);
    pendants.push(at(sph(0.07, 0, { mat: kitchenLightMat, cast: false }), x, 1.74, -2.6));
  });
  var kitchenLight = new THREE.PointLight(0xfff2d9, 0.9, 8, 2); kitchenLight.position.set(-3.5, 1.9, -2.8); scene.add(kitchenLight);
  wallPanel(-0.11, 1.3, -2.0, -PI / 2);
  pottedPlant(-6.5, -0.45, 0.8);
  // base + robô aspirador
  at(box(0.36, 0.1, 0.16, 0x1a1a1a, { r: 0.4 }), -0.5, 0.05, -5.15);
  var ROBOT_HOME = new THREE.Vector2(-0.5, -4.85);
  var robot = group(ROBOT_HOME.x, 0, ROBOT_HOME.y);
  at(cyl(0.17, 0.17, 0.08, 0x1a1a1a, { r: 0.35, m: 0.3 }, 28), 0, 0.05, 0, 0, robot);
  at(cyl(0.06, 0.06, 0.02, 0x333333), 0, 0.1, 0.05, 0, robot);
  var robotRingMat = glowMat(ACCENT, 1.4);
  var robotRing = mesh(new THREE.RingGeometry(0.12, 0.15, 28), robotRingMat, { cast: false });
  robotRing.rotation.x = -PI / 2;
  at(robotRing, 0, 0.092, 0, 0, robot);

  // ---------- QUARTO ----------
  at(box(3.6, WALL_H - 0.05, 0.03, 0xffffff, { map: texRep(TEX.deck, 1.4, 1), r: 0.75 }), 3.6, (WALL_H - 0.05) / 2, -5.885);
  var bed = group(3.6, 0, -4.8);
  at(box(1.86, 0.28, 2.12, C.walnut, { r: 0.6 }), 0, 0.2, 0, 0, bed);
  at(box(1.7, 0.08, 2.0, 0x111111), 0, 0.04, 0, 0, bed);
  at(box(1.76, 0.22, 2.02, C.white, { r: 0.95 }), 0, 0.45, 0, 0, bed);
  at(box(1.8, 0.07, 1.4, 0x5b6f7a, { r: 0.95 }), 0, 0.59, 0.33, 0, bed);
  at(box(1.82, 0.03, 0.3, 0xe0c38c, { r: 0.95 }), 0, 0.63, 0.75, 0, bed);
  [-0.42, 0.42].forEach(function (x) { at(box(0.7, 0.14, 0.38, 0xf6f4ef, { r: 0.95 }), x, 0.63, -0.72, 0, bed); });
  at(box(2.6, 1.1, 0.1, 0x6b5b4c, { r: 0.95 }), 3.6, 0.8, -5.84);
  var bedroomLightMat = glowMat(WARM, 0.8);
  var headboardLed = at(box(2.5, 0.03, 0.02, 0, { mat: bedroomLightMat, cast: false }), 3.6, 1.37, -5.86);
  var bedLamps = [];
  [2.25, 4.95].forEach(function (x, i) {
    at(box(0.5, 0.42, 0.4, C.walnut, { r: 0.6 }), x, 0.25, -5.55);
    at(box(0.46, 0.04, 0.36, 0x111111), x, 0.02, -5.55);
    at(cyl(0.05, 0.07, 0.25, 0x2b2b2b, { m: 0.5 }), x, 0.585, -5.6);
    bedLamps.push(at(cyl(0.12, 0.15, 0.2, 0, { mat: bedroomLightMat }), x, 0.81, -5.6));
    painting(x, 1.8, -5.86, 0, 0.5, 0.64, i + 1);
  });
  at(box(0.08, 0.3, 0.2, 0x111111), 4.82, 0.52, -5.5);   // celular carregando
  var bedroomLight = new THREE.PointLight(WARM, 0.8, 7, 2); bedroomLight.position.set(3.6, 1.7, -4.4); scene.add(bedroomLight);
  // tapete e recamier
  at(box(2.6, 0.015, 1.8, 0xb9ab95, { r: 1 }), 3.6, 0.012, -3.25).castShadow = false;
  at(box(1.4, 0.4, 0.42, 0xd9cfc0, { r: 0.95 }), 3.6, 0.22, -3.45);
  // guarda-roupa planejado
  at(box(0.62, 2.5, 3.2, 0xe6e1d8, { r: 0.55 }), 0.41, 1.25, -4.1);
  for (var wi = 0; wi < 4; wi++) {
    at(box(0.01, 2.4, 0.005, 0x9a958c), 0.725, 1.25, -5.7 + 0.8 * (wi + 1));
    at(box(0.02, 0.5, 0.02, C.metal, { m: 0.7 }), 0.735, 1.2, -5.7 + 0.8 * wi + 0.7);
  }
  at(box(0.02, 2.3, 0.02, 0, { mat: bedroomLightMat, cast: false }), 0.735, 1.25, -2.5);
  // painel de TV + console
  at(box(1.4, 0.8, 0.04, 0x0b0b0c, { r: 0.3, m: 0.4 }), 3.6, 1.4, -0.13);
  at(box(1.6, 0.35, 0.38, C.walnut, { r: 0.55 }), 3.6, 0.2, -0.3);
  at(box(0.16, 0.2, 0.16, 0x2a2d33), 3.0, 0.475, -0.3);
  // poltrona de leitura + planta
  var chair = group(6.2, 0, -5.2, -PI / 4 * 3);
  at(box(0.75, 0.4, 0.75, 0xc2a27f, { r: 0.95 }), 0, 0.22, 0, 0, chair);
  at(box(0.75, 0.5, 0.15, 0xc2a27f, { r: 0.95 }), 0, 0.6, -0.3, 0, chair);
  pottedPlant(6.55, -0.5, 1.0);
  // janela do quarto (painel deslizante) + persiana inteligente
  at(box(0.22, 0.05, 2.45, C.metal, { m: 0.6, r: 0.4 }), 7, 0.82, -3.0);
  at(box(0.22, 0.05, 2.45, C.metal, { m: 0.6, r: 0.4 }), 7, 2.28, -3.0);
  at(box(0.22, 1.5, 0.05, C.metal, { m: 0.6, r: 0.4 }), 7, 1.55, -4.18);
  at(box(0.22, 1.5, 0.05, C.metal, { m: 0.6, r: 0.4 }), 7, 1.55, -1.82);
  var winFixed = at(box(0.025, 1.42, 1.2, 0, { mat: glassMat }), 6.96, 1.55, -2.4);
  var winSlideMat = mat(C.glass, { op: 0.25, r: 0.05, m: 0.3, uniq: true });
  var winSlide = at(box(0.025, 1.42, 1.2, 0, { mat: winSlideMat }), 7.04, 1.55, -3.6);
  var winSlideFrame = at(box(0.03, 1.44, 0.03, C.metal, { m: 0.6 }), 7.04, 1.55, -3.0);
  var blindsMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, map: texRep(TEX.slats, 1, 1.5), roughness: 0.8 });
  var blinds = at(mesh(new THREE.BoxGeometry(0.03, 1.5, 2.4), blindsMat), 6.84, 1.55, -3.0);
  at(box(0.12, 0.1, 2.5, C.white, { r: 0.5 }), 6.84, 2.36, -3.0);
  // ar-condicionado acima da cabeceira
  var ac = group(3.6, 2.45, -5.78);
  var acBodyMat = mat(0xf4f4f2, { r: 0.4, uniq: true });
  var acBody = at(box(1.0, 0.3, 0.22, 0, { mat: acBodyMat }), 0, 0, 0, 0, ac);
  var acFlap = at(box(0.9, 0.02, 0.08, 0xdedede), 0, -0.14, 0.1, 0, ac);
  var acLedMat = glowMat(ACCENT, 0);
  at(box(0.12, 0.015, 0.005, 0, { mat: acLedMat, cast: false }), 0.36, 0.05, 0.112, 0, ac);
  var airMat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  var airFlows = [];
  for (var ai = 0; ai < 3; ai++) {
    var af = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), airMat);
    af.rotation.x = -PI / 3; af.userData.phase = ai / 3;
    airFlows.push(at(af, 3.6, 2.1, -5.4));
  }

  // ---------- HALL / ESCRITÓRIO / BANHEIRO ----------
  // console de entrada, mesa de trabalho na janela, estante e o hub de automação
  at(box(0.35, 0.8, 1.2, C.walnut, { r: 0.55 }), 0.28, 0.4, 2.0);
  at(cyl(0.07, 0.05, 0.25, 0xe7e2d8), 0.28, 0.93, 1.6);
  painting(0.115, 1.6, 2.0, PI / 2, 0.7, 0.9, 2);
  wallPanel(0.11, 1.3, 5.45, PI / 2);
  at(box(1.5, 0.04, 0.65, C.oak, { r: 0.5 }), 3.05, 0.75, 5.5);
  [2.33, 3.77].forEach(function (x) { at(box(0.04, 0.73, 0.6, C.metal, { m: 0.5 }), x, 0.365, 5.5); });
  at(box(0.7, 0.4, 0.03, 0x0b0b0c, { r: 0.3 }), 3.05, 1.1, 5.72);
  at(box(0.66, 0.36, 0.005, 0x1b3a52, { e: 0x1b3a52, ei: 0.6 }), 3.05, 1.1, 5.703).castShadow = false;
  at(box(0.05, 0.3, 0.05, C.metal), 3.05, 0.92, 5.75);
  at(box(0.4, 0.015, 0.14, 0xdddddd), 3.05, 0.78, 5.35);
  var desk = group(3.05, 0, 4.85);
  at(cyl(0.24, 0.24, 0.06, 0x2a2d33, { r: 0.7 }), 0, 0.48, 0, 0, desk);
  at(cyl(0.03, 0.03, 0.45, C.metal, { m: 0.6 }), 0, 0.24, 0, 0, desk);
  at(cyl(0.25, 0.25, 0.02, C.metal, { m: 0.6 }), 0, 0.01, 0, 0, desk);
  at(box(0.42, 0.45, 0.05, 0x2a2d33, { r: 0.7 }), 0, 0.78, -0.24, 0, desk);
  at(box(0.35, 2.0, 1.2, C.oak, { r: 0.6 }), 3.72, 1.0, 1.0);
  for (var si = 0; si < 4; si++) {
    at(box(0.3, 0.02, 1.1, 0x8a6142), 3.68, 0.3 + si * 0.45, 1.0);
    for (var bk = 0; bk < 5; bk++) at(box(0.2, rnd(0.22, 0.3), 0.06, [0x2a5b6b, 0xc96f4a, 0xe0c38c, 0x3a3e44, 0x7aa6a1][bk]), 3.66, 0.43 + si * 0.45, 0.6 + bk * 0.15);
  }
  // hub PULSE (central de automação da casa)
  at(cyl(0.26, 0.3, 0.9, C.white, { r: 0.4 }, 32), 5.4, 0.45, 4.6);
  at(cyl(0.2, 0.2, 0.5, 0, { mat: glassMat }, 32), 5.4, 1.15, 4.6);
  var hubCoreMat = glowMat(ACCENT, 1.2);
  at(sph(0.08, 0, { mat: hubCoreMat, cast: false }), 5.4, 1.15, 4.6);
  var hubRing = at(mesh(new THREE.TorusGeometry(0.15, 0.008, 8, 48), hubCoreMat, { cast: false }), 5.4, 1.15, 4.6);
  pottedPlant(6.55, 3.45, 1.1);
  var hallLight = new THREE.PointLight(0xfff6ea, 0.45, 7, 2); hallLight.position.set(2.0, 2.4, 3.0); scene.add(hallLight);
  // banheiro
  at(box(1.2, 0.35, 0.45, C.walnut, { r: 0.55 }), 5.0, 0.62, 0.33);
  at(box(1.22, 0.03, 0.47, C.stone, { r: 0.25 }), 5.0, 0.81, 0.33);
  at(cyl(0.18, 0.15, 0.06, 0xffffff, { r: 0.2 }), 5.0, 0.85, 0.35);
  at(box(1.0, 0.8, 0.02, 0xcfe3ea, { r: 0.05, m: 0.8 }), 5.0, 1.6, 0.115);
  at(box(1.06, 0.86, 0.01, 0, { mat: glowMat(0xfff2d9, 0.7), cast: false }), 5.0, 1.6, 0.105);
  at(box(0.9, 0.04, 1.4, 0x6f6f6f, { r: 0.4 }), 6.45, 0.02, 0.8);
  at(box(0.02, 2.0, 1.4, 0, { mat: glassMat }), 6.0, 1.0, 0.8);
  at(cyl(0.12, 0.12, 0.02, C.steel, { m: 0.9 }), 6.45, 2.15, 0.7);
  at(box(0.38, 0.32, 0.5, 0xffffff, { r: 0.2 }), 6.65, 0.42, 2.35);
  at(box(0.1, 0.5, 0.42, 0xffffff, { r: 0.2 }), 6.85, 0.75, 2.35);
  at(box(0.03, 0.03, 0.6, C.steel, { m: 0.9 }), 4.12, 1.2, 0.9);

  // =====================================================================
  // 6. área externa
  // =====================================================================
  slab(-12.2, 6.2, -7.8, 14, 0.0, 0.15, TEX.paver, 1.2);                       // acesso da garagem
  for (var pz = 6.6; pz < 13.8; pz += 0.9) slab(0.8, pz - 0.32, 2.2, pz + 0.32, -0.02, 0.14, TEX.concrete, 1.4, { tint: 0xd8d6d0 });
  slab(-40, 13.8, 40, 15.4, -0.03, 0.12, TEX.concrete, 2, { tint: 0xcfcdc7 });  // calçada
  slab(-40, 15.4, 40, 21.4, -0.08, 0.1, TEX.asphalt, 3);                        // rua
  for (var lx = -38; lx < 40; lx += 4) at(box(2, 0.01, 0.14, 0xdedede, { e: 0xdedede, ei: 0.15 }), lx, -0.07, 18.4).castShadow = false;
  // cerca viva frontal (com aberturas pro carro e pra entrada)
  [[-20, -12.6], [-7.4, 0.5], [2.5, 13]].forEach(function (s) {
    at(box(s[1] - s[0], 0.75, 0.5, C.plantDark, { r: 0.95 }), (s[0] + s[1]) / 2, 0.22, 13.3);
  });
  // jardineira em frente à fachada de vidro
  at(box(6.3, 0.4, 0.6, C.graphite, { r: 0.7 }), -3.5, 0.05, 6.75);
  for (var sx = -6.3; sx <= -0.7; sx += 0.8) shrub(sx, 6.75, 0.9);
  // piscina com deck
  slab(2.6, 7.2, 10.4, 7.8, -0.02, 0.13, TEX.deck, 1.5);
  slab(2.6, 11.0, 10.4, 12.6, -0.02, 0.13, TEX.deck, 1.5);
  slab(2.6, 7.8, 4.0, 11.0, -0.02, 0.13, TEX.deck, 1.5);
  slab(9.6, 7.8, 10.4, 11.0, -0.02, 0.13, TEX.deck, 1.5);
  [[6.8, 7.86, 5.75, 0.12], [6.8, 10.94, 5.75, 0.12]].forEach(function (p) { at(box(p[2], 0.03, p[3], C.white, { r: 0.5 }), p[0], -0.005, p[1]); });
  [[4.06, 9.4], [9.54, 9.4]].forEach(function (p) { at(box(0.12, 0.03, 3.2, C.white, { r: 0.5 }), p[0], -0.005, p[1]); });
  at(box(5.6, 0.04, 3.2, 0x0f4f66, { r: 0.6 }), 6.8, -0.4, 9.4).castShadow = false;
  var poolMat = mat(0x0d6688, { e: 0x0fa6c8, ei: 0.25, r: 0.08, m: 0.3, op: 0.92, uniq: true });
  var pool = at(mesh(new THREE.PlaneGeometry(5.6, 3.2), poolMat, { cast: false }), 6.8, -0.08, 9.4);
  pool.rotation.x = -PI / 2;
  var poolLight = new THREE.PointLight(0x3fe0ff, 0.6, 6, 2); poolLight.position.set(6.8, 0.4, 9.4); scene.add(poolLight);
  [5.0, 7.6].forEach(function (x) {
    var l = group(x, 0, 11.8);
    at(box(0.65, 0.1, 1.2, C.white, { r: 0.6 }), 0, 0.3, 0.2, 0, l);
    var back = at(box(0.65, 0.08, 0.7, C.white, { r: 0.6 }), 0, 0.5, -0.5, 0, l); back.rotation.x = -0.6;
    at(box(0.6, 0.25, 0.06, C.metal), 0, 0.12, 0.65, 0, l);
    at(box(0.6, 0.25, 0.06, C.metal), 0, 0.12, -0.3, 0, l);
  });
  // deck dos fundos com pergolado solar, mesa e cadeiras
  slab(-11.6, -5.8, -7.2, -0.5, 0.0, 0.15, TEX.deck, 1.5);
  [[-11.4, -5.6], [-7.4, -5.6], [-11.4, -0.7], [-7.4, -0.7]].forEach(function (p) { at(box(0.12, 2.6, 0.12, C.metal, { m: 0.5 }), p[0], 1.3, p[1]); });
  [-5.0, -3.15, -1.3].forEach(function (z) {
    var sp = at(box(4.2, 0.05, 1.7, 0xffffff, { map: TEX.solar, r: 0.2, m: 0.5 }), -9.4, 2.68, z);
    sp.rotation.x = 0.12;
  });
  at(cyl(0.6, 0.6, 0.04, C.oak, { r: 0.5 }, 32), -9.4, 0.74, -3.2);
  at(cyl(0.05, 0.08, 0.72, C.metal, { m: 0.5 }), -9.4, 0.36, -3.2);
  [0, PI / 2, PI, PI * 1.5].forEach(function (a) {
    var cx = -9.4 + Math.sin(a) * 1.0, cz = -3.2 + Math.cos(a) * 1.0;
    var ch = group(cx, 0, cz, a + PI);
    at(box(0.45, 0.05, 0.45, 0xe6e1d8, { r: 0.8 }), 0, 0.45, 0, 0, ch);
    at(box(0.45, 0.45, 0.05, 0xe6e1d8, { r: 0.8 }), 0, 0.7, -0.2, 0, ch);
    [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]].forEach(function (p) { at(box(0.03, 0.45, 0.03, C.metal), p[0], 0.22, p[1], 0, ch); });
  });
  // árvores e arbustos
  tree(-15.5, 8.5, 1.2); tree(-16.2, -2, 1.35); tree(-9.2, -8.6, 1.1); tree(0, -9.2, 1.3);
  tree(6.5, -8.8, 1.0); tree(11.6, -3, 1.25); tree(12.2, 5, 1.1); tree(12.4, 11.5, 0.95); tree(-4.2, 10.3, 0.85);
  [[-14.2, 5], [-14.2, 2], [8.2, -1.5], [8.2, 1.5], [-2.2, 11.2], [-5.8, 11.6], [11.2, 8.4]].forEach(function (p) { shrub(p[0], p[1], 1.1); });
  // armário inteligente de entregas
  at(box(0.55, 1.2, 0.45, C.graphite, { r: 0.5, m: 0.3 }), 3.0, 0.6, 13.0);
  at(box(0.4, 0.02, 0.01, ACCENT, { e: ACCENT, ei: 0.8 }), 3.0, 1.0, 13.23).castShadow = false;
  // postes, balizadores e luz da piscina (Luz Externa)
  var extLightMat = glowMat(WARM, 1.1);
  var extLamps = [];
  var extPointLights = [];
  [[-7.4, 12.2], [0.35, 12.6]].forEach(function (p) {
    at(box(0.1, 2.4, 0.1, C.metal, { m: 0.5, r: 0.4 }), p[0], 1.2, p[1]);
    at(box(0.5, 0.06, 0.18, C.metal, { m: 0.5, r: 0.4 }), p[0], 2.42, p[1]);
    extLamps.push(at(box(0.44, 0.03, 0.14, 0, { mat: extLightMat, cast: false }), p[0], 2.38, p[1]));
    var pl = new THREE.PointLight(WARM, 1.0, 9, 2); pl.position.set(p[0], 2.2, p[1]); scene.add(pl); extPointLights.push(pl);
  });
  [[2.6, 7.6], [2.6, 9.6], [2.6, 11.6], [0.4, 8.6], [0.4, 10.6], [-7.55, 7.4], [-7.55, 9.8]].forEach(function (p) {
    at(box(0.12, 0.5, 0.12, C.metal, { m: 0.5 }), p[0], 0.1, p[1]);
    extLamps.push(at(box(0.13, 0.06, 0.13, 0, { mat: extLightMat, cast: false }), p[0], 0.38, p[1]));
  });
  canopyLights.forEach(function (m) { m.material = extLightMat; extLamps.push(m); });
  // câmera externa na quina da garagem
  var extCam = group(-12.75, 2.35, 6.3, -PI / 2 + 0.45);
  at(box(0.06, 0.06, 0.2, 0xeeeeee), -0.08, 0.06, 0, PI / 2, extCam);
  var extCamHead = at(box(0.3, 0.16, 0.16, 0xf2f2f2, { r: 0.4 }), 0.08, 0, 0, 0, extCam);
  at(cyl(0.05, 0.05, 0.03, 0x0a0a0a, {}, 16), 0.24, 0, 0, 0, extCam).rotation.z = PI / 2;
  var extCamLedMat = glowMat(0xff4d4d, 1.2);
  at(sph(0.018, 0, { mat: extCamLedMat, cast: false }), 0.24, 0.06, 0.04, 0, extCam);
  var extCamBase = -PI / 2 + 0.45;

  // =====================================================================
  // 7. registro de dispositivos — a ponte entre o banco (opts.deviceMap) e
  // os objetos 3D. Cada dispositivo guarda estado, permissão, os meshes
  // clicáveis e uma função apply(on) que atualiza a cena.
  // =====================================================================
  var devices = {}, deviceOrder = [], interactive = [], sceneReady = false;
  function registerDevice(sceneId, meshes, apply) {
    var d = (opts.deviceMap || {})[sceneId];
    var initialOn = d ? d.ativo : false;
    meshes = [].concat(meshes);
    devices[sceneId] = { name: d ? d.nome : sceneId, realId: d ? d.id : null, podeControlar: d ? d.pode_controlar : false, meshes: meshes, on: initialOn, apply: apply };
    deviceOrder.push(sceneId);
    meshes.forEach(function (m) {
      m.traverse(function (o) { if (o.isMesh) { o.userData.deviceId = sceneId; interactive.push(o); } });
    });
    apply(initialOn);
  }

  var robotActive = false, camExtActive = true, camSalaActive = true, acOn = false, tvOn = false, windowOpen = false;
  var windowT = 0;

  registerDevice('luz-sala', [salaLampShade].concat(salaCove), function (on) {
    salaLight.intensity = on ? 0.9 : 0;
    salaLampMat.emissiveIntensity = on ? 0.9 : 0.04;
  });
  registerDevice('tv-sala', [tvFrame, tvScreen], function (on) {
    tvOn = on;
    tvScreenMat.emissiveIntensity = on ? 1.0 : 0;
    tvBacklightMat.emissiveIntensity = on ? 0.6 : 0;
    tvGlow.intensity = on ? 0.5 : 0;
  });
  registerDevice('luz-cozinha', kitchenStrips.concat(pendants), function (on) {
    kitchenLight.intensity = on ? 0.9 : 0;
    kitchenLightMat.emissiveIntensity = on ? 1.1 : 0.04;
  });
  registerDevice('robo', robot, function (on) {
    robotActive = on;
    robotRingMat.emissiveIntensity = on ? 1.4 : 0.25;
  });
  registerDevice('luz-quarto', bedLamps.concat([headboardLed]), function (on) {
    bedroomLight.intensity = on ? 0.8 : 0;
    bedroomLightMat.emissiveIntensity = on ? 0.8 : 0.04;
  });
  registerDevice('ac', ac, function (on) {
    acOn = on;
    acLedMat.emissiveIntensity = on ? 1.2 : 0;
  });
  registerDevice('janela-quarto', [winFixed, winSlide, winSlideFrame, blinds], function (on) {
    windowOpen = on;
    if (!sceneReady) windowT = on ? 1 : 0;
  });
  registerDevice('luz-externa', extLamps, function (on) {
    extLightMat.emissiveIntensity = on ? 1.1 : 0.05;
    extStripMat.emissiveIntensity = on ? 0.9 : 0.03;
    signMat.emissiveIntensity = on ? 0.9 : 0.12;
    extPointLights.forEach(function (l) { l.intensity = on ? 1.0 : 0; });
    poolLight.intensity = on ? 0.6 : 0;
    poolMat.emissiveIntensity = on ? 0.35 : 0.08;
  });
  registerDevice('camera-externa', extCam, function (on) {
    camExtActive = on;
    extCamLedMat.emissiveIntensity = on ? 1.1 : 0.1;
  });
  registerDevice('camera-sala', salaCam, function (on) {
    camSalaActive = on;
    salaCamLedMat.emissiveIntensity = on ? 1.1 : 0.1;
  });
  registerDevice('geladeira', [fridgeBody, fridgeScreen], function (on) {
    fridgeScreenMat.emissiveIntensity = on ? 0.7 : 0;
    fridgeBodyMat.color.set(on ? 0xb9bec4 : 0x9a9fa5);
  });
  registerDevice('luz-garagem', garageStrips, function (on) {
    garageLamp.intensity = on ? 0.8 : 0;
    garageStripMat.emissiveIntensity = on ? 1.2 : 0.04;
  });

  // =====================================================================
  // 8. carro + garagem inteligente
  // Sequência: porta abre → (aberta) o carro entra ou sai → estaciona →
  // se quem abriu foi um clique nesta maquete, a porta fecha sozinha
  // (chamando a mesma rota do back-end, então o estado real acompanha).
  // Enquanto o carro está passando, a porta fica aberta mesmo que o banco
  // diga "fechada" — ela só fecha depois que o vão está livre.
  // =====================================================================
  var CAR_OUT_Z = 10.6, CAR_IN_Z = 2.9, CAR_X = -10, WHEEL_R = 0.36;
  function makeCar() {
    var g = new THREE.Group();
    var paint = mat(0xe4e8ec, { r: 0.22, m: 0.55 });
    var dark = mat(0x15181c, { r: 0.4, m: 0.3 });
    var tint = mat(0x0c1218, { r: 0.08, m: 0.9 });
    at(box(1.9, 0.42, 4.4, 0, { mat: paint }), 0, 0.5, 0, 0, g);
    at(box(1.84, 0.1, 1.3, 0, { mat: paint }), 0, 0.76, -1.45, 0, g);
    at(box(1.84, 0.1, 0.9, 0, { mat: paint }), 0, 0.76, 1.7, 0, g);
    at(box(1.62, 0.46, 2.1, 0, { mat: tint }), 0, 0.99, 0.15, 0, g);
    at(box(1.5, 0.05, 1.6, 0, { mat: tint }), 0, 1.245, 0.25, 0, g);
    at(box(1.94, 0.14, 3.2, 0, { mat: dark }), 0, 0.32, 0, 0, g);
    at(box(1.8, 0.18, 0.08, 0, { mat: dark }), 0, 0.42, -2.2, 0, g);
    at(box(1.8, 0.18, 0.08, 0, { mat: dark }), 0, 0.42, 2.2, 0, g);
    at(box(1.955, 0.025, 3.6, 0, { mat: glowMat(ACCENT, 0.5), cast: false }), 0, 0.56, 0, 0, g);
    var headMat = glowMat(0xeafcff, 0.15), tailMat = glowMat(0xff2a3a, 0.25);
    at(box(1.7, 0.045, 0.03, 0, { mat: headMat, cast: false }), 0, 0.66, -2.215, 0, g);
    at(box(1.78, 0.05, 0.03, 0, { mat: tailMat, cast: false }), 0, 0.66, 2.215, 0, g);
    var wheels = [];
    [-0.86, 0.86].forEach(function (sx) {
      [-1.38, 1.38].forEach(function (sz) {
        var w = group(sx, WHEEL_R, sz, 0, g);
        at(cyl(WHEEL_R, WHEEL_R, 0.24, 0x0d0d0d, { r: 0.9 }, 24), 0, 0, 0, 0, w).rotation.z = PI / 2;
        at(cyl(0.24, 0.24, 0.25, 0x9aa1a8, { m: 0.8, r: 0.3 }, 24), 0, 0, 0, 0, w).rotation.z = PI / 2;
        at(box(0.26, 0.05, 0.4, 0x3a3e44, { m: 0.6 }), 0, 0, 0, 0, w);
        wheels.push(w);
      });
    });
    return { group: g, wheels: wheels, headMat: headMat, tailMat: tailMat };
  }
  var car = makeCar();
  at(car.group, CAR_X, 0, CAR_OUT_Z);

  var garage = { doorOn: false, doorT: 0, carState: 'outside', carZ: CAR_OUT_Z, transit: null, pendingMove: false, autoClose: false, sensorT: 0 };
  // Clicar no carro também aciona a porta da garagem (é o jeito natural de "chamar" o carro).
  registerDevice('porta-garagem', [garageDoor, car.group], function (on) {
    var was = garage.doorOn;
    garage.doorOn = on;
    if (!sceneReady) { garage.doorT = on ? 1 : 0; return; }
    if (on && !was && !garage.transit) garage.pendingMove = true;
    if (!on) garage.pendingMove = false;
  });

  function easeInOut(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
  function updateGarage(dt, t) {
    var wantOpen = garage.doorOn || !!garage.transit;
    var speed = reducedMotion ? 100 : 1 / 2.2;
    garage.doorT = Math.max(0, Math.min(1, garage.doorT + (wantOpen ? 1 : -1) * dt * speed));
    var e = easeInOut(garage.doorT);
    var h = GDOOR_H * (1 - 0.94 * e);
    garageDoor.scale.y = h / GDOOR_H;
    garageDoor.position.y = GDOOR_H - h / 2;
    garageDoorLed.position.y = GDOOR_H - h + 0.03;

    if (garage.pendingMove && garage.doorT >= 0.999 && !garage.transit) {
      garage.pendingMove = false;
      garage.transit = { from: garage.carZ, to: garage.carState === 'outside' ? CAR_IN_Z : CAR_OUT_Z, t: 0, dur: reducedMotion ? 0.01 : 5.2 };
    }
    if (garage.transit) {
      var tr = garage.transit;
      tr.t = Math.min(1, tr.t + dt / tr.dur);
      var z = tr.from + (tr.to - tr.from) * easeInOut(tr.t);
      var dz = z - garage.carZ;
      garage.carZ = z;
      car.group.position.z = z;
      car.wheels.forEach(function (w) { w.rotation.x += dz / WHEEL_R; });
      car.headMat.emissiveIntensity = 1.6;
      car.tailMat.emissiveIntensity = tr.t > 0.8 ? 1.6 : 0.8;   // "freio" no fim da manobra
      if (tr.t >= 1) {
        garage.transit = null;
        garage.carState = tr.to === CAR_IN_Z ? 'inside' : 'outside';
        garage.sensorT = 2.5;
        if (garage.autoClose) {
          garage.autoClose = false;
          setTimeout(function () {
            if (devices['porta-garagem'].on && !garage.transit) toggleDevice('porta-garagem', { auto: true });
          }, 1200);
        }
      }
    } else {
      car.headMat.emissiveIntensity += ((garage.sensorT > 0 ? 0.8 : 0.15) - car.headMat.emissiveIntensity) * Math.min(1, dt * 3);
      car.tailMat.emissiveIntensity += (0.25 - car.tailMat.emissiveIntensity) * Math.min(1, dt * 3);
    }
    garage.sensorT = Math.max(0, garage.sensorT - dt);
    var sensing = !!garage.transit || garage.sensorT > 0;
    guideMat.emissiveIntensity += ((sensing ? 1.3 : 0.05) - guideMat.emissiveIntensity) * Math.min(1, dt * 5);
    sensorLedMat.emissiveIntensity = sensing ? (Math.sin(t * 14) > 0 ? 1.6 : 0.2) : 0.2;
    // carregador: verde pulsando com o carro estacionado, ciano em espera
    if (garage.carState === 'inside' && !garage.transit) {
      chargerLedMat.emissive.set(0x3dff8a);
      chargerLedMat.emissiveIntensity = reducedMotion ? 1 : 0.6 + Math.sin(t * 2.2) * 0.5;
    } else {
      chargerLedMat.emissive.set(ACCENT);
      chargerLedMat.emissiveIntensity = 0.7;
    }
  }

  // =====================================================================
  // 9. moradores: casal + cachorro. Cada um segue uma lista de waypoints
  // desenhada pra passar só por áreas livres (portas e vãos, nunca paredes
  // ou móveis), com pausas em pontos que fazem sentido (pia, cooktop,
  // geladeira, em frente à TV, caminha do cachorro).
  // =====================================================================
  function makePerson(c) {
    var g = new THREE.Group(), body = new THREE.Group();
    g.add(body);
    var legs = [], arms = [];
    [-1, 1].forEach(function (s) {
      var hip = group(s * 0.095, 0.9, 0, 0, body);
      at(cyl(0.068, 0.055, 0.84, c.pants, { r: 0.9 }, 12), 0, -0.42, 0, 0, hip);
      at(box(0.11, 0.07, 0.25, c.shoes, { r: 0.6 }), 0, -0.85, 0.04, 0, hip);
      legs.push(hip);
      var sh = group(s * 0.215, 1.44, 0, 0, body);
      at(cyl(0.052, 0.044, 0.56, c.top, { r: 0.9 }, 12), 0, -0.28, 0, 0, sh);
      at(sph(0.05, c.skin, { r: 0.7 }), 0, -0.6, 0, 0, sh);
      arms.push(sh);
    });
    at(box(0.3, 0.16, 0.19, c.pants, { r: 0.9 }), 0, 0.95, 0, 0, body);
    var torso = at(cyl(0.18, 0.15, 0.56, c.top, { r: 0.9 }, 16), 0, 1.2, 0, 0, body);
    torso.scale.z = 0.72;
    at(cyl(0.05, 0.055, 0.1, c.skin, { r: 0.7 }), 0, 1.52, 0, 0, body);
    var head = at(sph(0.115, c.skin, { r: 0.7 }), 0, 1.67, 0, 0, body);
    head.scale.set(0.92, 1.05, 1);
    var hair = at(sph(0.122, c.hair, { r: 0.9 }), 0, 1.7, -0.015, 0, body);
    hair.scale.set(1, 0.92, 1);
    if (c.longHair) at(box(0.22, 0.34, 0.08, c.hair, { r: 0.9 }), 0, 1.52, -0.08, 0, body);
    [-0.04, 0.04].forEach(function (x) { at(sph(0.014, 0x1a1a1a, { cast: false }), x, 1.69, 0.103, 0, body); });
    return {
      group: g,
      animate: function (a, t) {
        var s = Math.sin(a.phase) * a.walkAmt;
        legs[0].rotation.x = s * 0.55; legs[1].rotation.x = -s * 0.55;
        var work = a.pose === 'work' ? 1 : 0;
        a.workAmt += (work - a.workAmt) * 0.08;
        var wk = a.workAmt;
        arms[0].rotation.x = -s * 0.45 * (1 - wk) + wk * (-0.95 + Math.sin(t * 3.1) * 0.12);
        arms[1].rotation.x = s * 0.45 * (1 - wk) + wk * (-0.85 + Math.sin(t * 2.7 + 1) * 0.12);
        body.position.y = Math.abs(Math.cos(a.phase)) * 0.03 * a.walkAmt + Math.sin(t * 1.8) * 0.004;
      }
    };
  }
  function makeDog() {
    var g = new THREE.Group(), body = new THREE.Group();
    g.add(body);
    var col = 0xc58b4a, dark = 0x7a512a, light = 0xe0b07a;
    at(box(0.24, 0.22, 0.56, col, { r: 0.95 }), 0, 0.4, 0, 0, body);
    at(box(0.2, 0.12, 0.4, light, { r: 0.95 }), 0, 0.3, 0.02, 0, body);
    var head = group(0, 0.56, 0.33, 0, body);
    at(box(0.19, 0.18, 0.2, col, { r: 0.95 }), 0, 0, 0, 0, head);
    at(box(0.11, 0.09, 0.13, light, { r: 0.95 }), 0, -0.03, 0.14, 0, head);
    at(box(0.05, 0.04, 0.03, 0x111111, { r: 0.4 }), 0, -0.01, 0.215, 0, head);
    [-1, 1].forEach(function (s) {
      at(box(0.05, 0.13, 0.09, dark, { r: 0.95 }), s * 0.11, -0.02, -0.02, 0, head).rotation.z = s * 0.25;
      at(sph(0.016, 0x111111, { cast: false }), s * 0.05, 0.03, 0.1, 0, head);
    });
    var tail = group(0, 0.47, -0.27, 0, body);
    var tailMesh = at(cyl(0.025, 0.018, 0.26, col, { r: 0.95 }, 8), 0, 0.12, 0, 0, tail);
    tail.rotation.x = -0.6;
    var legs = [];
    [[-0.08, 0.19], [0.08, 0.19], [-0.08, -0.19], [0.08, -0.19]].forEach(function (p) {
      var hip = group(p[0], 0.3, p[1], 0, body);
      at(cyl(0.035, 0.03, 0.3, col, { r: 0.95 }, 8), 0, -0.15, 0, 0, hip);
      legs.push(hip);
    });
    void tailMesh;
    return {
      group: g,
      animate: function (a, t) {
        var s = Math.sin(a.phase) * a.walkAmt * 0.6;
        legs[0].rotation.x = s; legs[3].rotation.x = s;
        legs[1].rotation.x = -s; legs[2].rotation.x = -s;
        tail.rotation.y = Math.sin(t * (a.walkAmt > 0.5 ? 14 : 7)) * 0.55;
        head.rotation.x = Math.sin(t * 1.3) * 0.08 * (1 - a.walkAmt);
        body.position.y = Math.abs(Math.cos(a.phase)) * 0.02 * a.walkAmt;
      }
    };
  }

  var agents = [];
  var robotObstacle = { x: ROBOT_HOME.x, z: ROBOT_HOME.y, radius: 0.2 };
  function angDiff(a, b) { var d = b - a; while (d > PI) d -= 2 * PI; while (d < -PI) d += 2 * PI; return d; }
  function Agent(rig, path, o) {
    this.rig = rig; this.obj = rig.group; this.path = path;
    this.speed = o.speed; this.radius = o.radius; this.loop = !!o.loop; this.stride = o.stride;
    this.i = 1; this.dir = 1; this.lastIdx = 0;
    this.wait = (path[0].wait || 0) * Math.random();
    this.pose = path[0].pose || null;
    this.heading = path[0].face !== undefined ? path[0].face : 0;
    this.x = path[0].x; this.z = path[0].z;
    this.phase = Math.random() * 6; this.walkAmt = 0; this.workAmt = 0; this.blockT = 0;
    at(this.obj, this.x, 0, this.z, this.heading);
    agents.push(this);
  }
  Agent.prototype.advance = function () {
    var n = this.path.length;
    if (this.loop) { this.i = (this.i + 1) % n; return; }
    if (this.i + this.dir >= n || this.i + this.dir < 0) this.dir = -this.dir;
    this.i += this.dir;
  };
  // Espera se alguém (outro morador ou o robô) estiver logo à frente; depois
  // de 2,5s desiste de esperar, pra nunca travar a casa num impasse.
  Agent.prototype.blocked = function (fx, fz, dt) {
    var others = agents.concat(robotActive ? [robotObstacle] : []);
    for (var k = 0; k < others.length; k++) {
      var o = others[k];
      if (o === this) continue;
      var dx = o.x - this.x, dz = o.z - this.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d < this.radius + o.radius + 0.12 && d > 0.0001 && (dx * fx + dz * fz) / d > 0.25) {
        if (this.blockT < 2.5) { this.blockT += dt; return true; }
        return false;
      }
    }
    this.blockT = 0;
    return false;
  };
  Agent.prototype.update = function (dt, t) {
    var moving = false, faceTo = null;
    if (this.wait > 0) {
      this.wait -= dt;
      var p = this.path[this.lastIdx];
      if (p && p.face !== undefined) faceTo = p.face;
    } else {
      var tg = this.path[this.i], dx = tg.x - this.x, dz = tg.z - this.z, dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 0.04) {
        this.lastIdx = this.i; this.wait = tg.wait || 0; this.pose = tg.pose || null;
        this.advance();
      } else {
        var want = Math.atan2(dx, dz);
        faceTo = want; this.pose = null;
        if (Math.abs(angDiff(this.heading, want)) < 0.7 && !this.blocked(dx / dist, dz / dist, dt)) {
          var step = Math.min(dist, this.speed * dt);
          this.x += dx / dist * step; this.z += dz / dist * step;
          moving = true;
        }
      }
    }
    if (faceTo !== null) this.heading += angDiff(this.heading, faceTo) * Math.min(1, dt * 6);
    this.walkAmt += ((moving ? 1 : 0) - this.walkAmt) * Math.min(1, dt * 8);
    if (moving) this.phase += dt * this.speed * this.stride;
    this.obj.position.set(this.x, 0, this.z);
    this.obj.rotation.y = this.heading;
    this.rig.animate(this, t);
  };

  var NORTH = PI, WEST = -PI / 2;
  // Ana: cozinha (pia → cooktop) ↔ sala (atrás do sofá, olhando a TV)
  new Agent(makePerson({ skin: 0xc69c7b, hair: 0x2b1d14, top: 0x2fb5ad, pants: 0x2a2d35, shoes: 0xf2f2f2, longHair: true }), [
    { x: -4.6, z: -4.65, wait: 4, face: NORTH, pose: 'work' },
    { x: -2.7, z: -4.65, wait: 5, face: NORTH, pose: 'work' },
    { x: -1.5, z: -3.7 }, { x: -1.5, z: -0.9 }, { x: -1.55, z: 1.2 },
    { x: -1.5, z: 3.4, wait: 6, face: WEST }
  ], { speed: 0.85, radius: 0.25, stride: 7 });
  // Leo: geladeira → sala → hall → quarto (passa pela porta automática)
  new Agent(makePerson({ skin: 0x8d5e3f, hair: 0x1a1410, top: 0xe9e4da, pants: 0x3b4a5e, shoes: 0x222222 }), [
    { x: -6.3, z: -4.6, wait: 4, face: NORTH, pose: 'work' },
    { x: -5.6, z: -3.9 }, { x: -5.6, z: -1.0 }, { x: -4.8, z: 1.0 }, { x: -1.15, z: 1.3 },
    { x: -0.75, z: 4.1 }, { x: 0.75, z: 4.2 }, { x: 1.3, z: 2.5 }, { x: 1.3, z: 0.6 }, { x: 1.35, z: -0.6 },
    { x: 2.0, z: -1.6, wait: 5, face: 2.68 }
  ], { speed: 0.9, radius: 0.25, stride: 7 });
  // Thor, o cachorro: circuito pela sala e cozinha, com parada na caminha
  new Agent(makeDog(), [
    { x: -4.4, z: 1.3 }, { x: -3.2, z: -0.7, wait: 3, face: NORTH }, { x: -2.0, z: 1.5 },
    { x: -2.0, z: 4.95 }, { x: -3.8, z: 5.25 }, { x: -4.9, z: 5.15, wait: 6 }, { x: -5.4, z: 2.3 }
  ], { speed: 1.1, radius: 0.18, stride: 11, loop: true });

  // Robô aspirador: elipse em volta da ilha; desligado, volta pra base.
  var robotA = 0;
  function updateRobot(dt) {
    var tx, tz;
    if (robotActive) {
      robotA += dt * 0.28;
      tx = -3.5 + Math.cos(robotA) * 2.2; tz = -2.6 + Math.sin(robotA) * 1.75;
    } else { tx = ROBOT_HOME.x; tz = ROBOT_HOME.y; }
    var dx = tx - robot.position.x, dz = tz - robot.position.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0.005) {
      var step = Math.min(d, 0.55 * dt);
      robot.position.x += dx / d * step; robot.position.z += dz / d * step;
      robot.rotation.y += angDiff(robot.rotation.y, Math.atan2(dx, dz)) * Math.min(1, dt * 4);
    }
    robotObstacle.x = robot.position.x; robotObstacle.z = robot.position.z;
  }

  // =====================================================================
  // 10. portas automáticas (sensor de presença): abrem quando a câmera do
  // tour ou um morador chega perto, e deslizam pra dentro da parede.
  // =====================================================================
  var autoDoors = [];
  function autoDoor(m, axis, closed, open, cx, cz, r) { autoDoors.push({ mesh: m, axis: axis, closed: closed, open: open, cx: cx, cz: cz, r: r, t: 0 }); }
  var entryDoor = group(1.5, 0, 6.0);
  at(box(1.0, 2.3, 0.06, C.walnut, { r: 0.5 }), 0, 1.15, 0, 0, entryDoor);
  at(box(0.16, 2.0, 0.065, 0, { mat: glassMat }), -0.25, 1.15, 0, 0, entryDoor);
  at(box(0.02, 0.6, 0.08, ACCENT, { e: ACCENT, ei: 0.9 }), 0.38, 1.1, 0, 0, entryDoor).castShadow = false;
  autoDoor(entryDoor, 'x', 1.5, 0.52, 1.5, 6.0, 3.2);
  var bedroomDoor = at(box(1.0, 2.2, 0.05, C.oak, { r: 0.6 }), 1.3, 1.1, 0);
  autoDoor(bedroomDoor, 'x', 1.3, 2.3, 1.3, 0, 1.8);
  var bathDoor = at(box(0.05, 2.2, 0.9, C.oak, { r: 0.6 }), 4, 1.1, 2.35);
  autoDoor(bathDoor, 'z', 2.35, 1.45, 4, 2.35, 1.6);
  function updateDoors(dt) {
    autoDoors.forEach(function (d) {
      var near = false, dx, dz;
      if (camera.position.y < 3.2) { dx = camera.position.x - d.cx; dz = camera.position.z - d.cz; near = dx * dx + dz * dz < d.r * d.r; }
      for (var i = 0; !near && i < agents.length; i++) { dx = agents[i].x - d.cx; dz = agents[i].z - d.cz; near = dx * dx + dz * dz < d.r * d.r; }
      d.t = Math.max(0, Math.min(1, d.t + (near ? 1 : -1) * dt * (reducedMotion ? 100 : 1.4)));
      d.mesh.position[d.axis] = d.closed + (d.open - d.closed) * easeInOut(d.t);
    });
  }

  sceneReady = true;

  // =====================================================================
  // 11. tour automático, HUD, back-end e laço principal
  // =====================================================================
  var countOnEl = document.getElementById('iso3d-count-on');
  var countTotalEl = document.getElementById('iso3d-count-total');
  countTotalEl.textContent = deviceOrder.length;
  function refreshCount() {
    var n = 0;
    for (var i = 0; i < deviceOrder.length; i++) if (devices[deviceOrder[i]].on) n++;
    countOnEl.textContent = n;
  }
  refreshCount();

  // Trajeto da câmera: posPts é por onde ela passa, lookPts pra onde mira.
  // Os pontos internos passam pelos vãos de porta (as portas automáticas
  // abrem com a aproximação), sem atravessar paredes.
  function V(x, y, z) { return new THREE.Vector3(x, y, z); }
  var tourPts = [
    [V(16, 13, 24), V(-3, 0.5, 1), 'Vista aérea'],
    [V(-2, 2.4, 17), V(-6, 1.2, 8), 'Área Externa'],
    [V(-6.5, 4.8, 12), V(-10, 0.6, 4), 'Garagem'],
    [V(-9.5, 5.2, 8.2), V(-10, 0.4, 2.5), null],
    [V(1.5, 1.7, 10.5), V(1.5, 1.4, 5), 'Entrada'],
    [V(1.5, 1.65, 6.8), V(1.5, 1.4, 3), null],
    [V(1.4, 1.65, 4.4), V(-2.5, 1.3, 4.2), 'Hall'],
    [V(-0.5, 1.65, 4.3), V(-6.9, 1.4, 3.2), 'Sala'],
    [V(-1.0, 1.75, 2.6), V(-6.9, 1.3, 3.2), null],
    [V(-1.3, 1.75, 0.6), V(-3.6, 1.0, -3.0), 'Cozinha'],
    [V(-0.6, 1.8, -1.4), V(-3.2, 1.2, -5.4), null],
    [V(-1.3, 1.7, 1.6), V(0.5, 1.4, 4.2), 'Sala'],
    [V(-0.4, 1.65, 4.2), V(1.5, 1.4, 4.0), null],
    [V(1.4, 1.65, 3.0), V(1.3, 1.4, -2), 'Hall'],
    [V(1.3, 1.65, 0.0), V(3.6, 0.8, -4.2), 'Quarto'],
    [V(2.0, 1.7, -1.3), V(3.6, 0.8, -4.8), null],
    [V(5.8, 1.7, -1.0), V(6.9, 1.5, -3.0), null],
    [V(1.4, 1.7, -0.7), V(1.3, 1.5, 3), null],
    [V(1.3, 1.65, 0.9), V(1.5, 1.4, 6), 'Hall'],
    [V(1.5, 1.65, 5.0), V(1.5, 1.4, 9), null],
    [V(1.5, 2.0, 8.5), V(-2, 1, 10), 'Área Externa'],
    [V(14, 11, 22), V(-3, 0.5, 1), 'Vista aérea']
  ];
  var posCurve = new THREE.CatmullRomCurve3(tourPts.map(function (p) { return p[0]; }), false, 'centripetal', 0.5);
  var lookCurve = new THREE.CatmullRomCurve3(tourPts.map(function (p) { return p[1]; }), false, 'centripetal', 0.5);
  var NPTS = tourPts.length;
  var segDur = [5, 3, 2.5, 4, 2.5, 2.5, 2.5, 3, 3, 2.5, 3, 2, 2.5, 2, 3, 3.5, 3, 2, 2.5, 2.5, 5];
  var segCum = [0];
  for (var sgi = 0; sgi < segDur.length; sgi++) segCum.push(segCum[sgi] + segDur[sgi]);
  var TOTAL = segCum[segCum.length - 1];
  function smoothstep(x) { return x * x * (3 - 2 * x); }
  function uFromElapsed(sec) {
    var s = Math.max(0, Math.min(sec, TOTAL - 0.0001)), i = 0;
    while (i < segDur.length - 1 && s >= segCum[i + 1]) i++;
    var localT = (s - segCum[i]) / segDur[i];
    return Math.min(0.9999, (i + smoothstep(Math.max(0, Math.min(1, localT)))) / (NPTS - 1));
  }
  var labelStops = [];
  tourPts.forEach(function (p, i) { if (p[2]) labelStops.push({ at: segCum[i] / TOTAL, label: p[2] }); });
  function labelFor(frac) { var lbl = labelStops[0].label; for (var i = 0; i < labelStops.length; i++) if (frac >= labelStops[i].at - 0.002) lbl = labelStops[i].label; return lbl; }

  var elapsed = 0, playing = !reducedMotion, freeMode = !!reducedMotion;
  var clock = new THREE.Clock();
  var orbit = new THREE.OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true; orbit.dampingFactor = 0.08;
  orbit.minDistance = 3; orbit.maxDistance = 60; orbit.maxPolarAngle = PI * 0.48;
  orbit.target.set(-3, 0.8, 1); orbit.enabled = freeMode;
  if (freeMode) { camera.position.set(16, 13, 24); orbit.update(); }

  var playBtn = document.getElementById('iso3d-play');
  var playIcon = document.getElementById('iso3d-play-icon');
  var pauseIcon = document.getElementById('iso3d-pause-icon');
  var restartBtn = document.getElementById('iso3d-restart');
  var freeToggle = document.getElementById('iso3d-freetoggle');
  var dayToggle = document.getElementById('iso3d-daynight');
  var roomLabel = document.getElementById('iso3d-room');
  var fill = document.getElementById('iso3d-fill');
  var toast = document.getElementById('iso3d-toast');
  var toastName = document.getElementById('iso3d-toast-name');
  var toastState = document.getElementById('iso3d-toast-state');
  var hoverEl = document.createElement('div');
  hoverEl.className = 'iso3d-hover';
  wrap.appendChild(hoverEl);

  var toastTimer = null;
  function showToast(name, on, texto) {
    toastName.textContent = name;
    toastState.textContent = texto || (on ? 'Ligado / ativo' : 'Desligado / inativo');
    toastState.className = 's' + (on ? ' on' : '');
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 2400);
  }

  function syncPlayIcon() {
    playIcon.style.display = playing ? 'none' : 'block';
    pauseIcon.style.display = playing ? 'block' : 'none';
    playBtn.setAttribute('aria-label', playing ? 'Pausar tour' : 'Retomar tour');
  }
  function setFreeMode(on) {
    freeMode = on; orbit.enabled = on;
    freeToggle.classList.toggle('active', on);
    freeToggle.textContent = on ? 'Tour automático' : 'Controle livre';
    if (on) { orbit.target.copy(lookCurve.getPoint(uFromElapsed(elapsed))); orbit.update(); }
  }
  function syncDayButton() {
    if (!dayToggle) return;
    dayToggle.textContent = isDay ? '☀ Dia' : '☾ Noite';
    dayToggle.setAttribute('aria-label', isDay ? 'Mudar para noite' : 'Mudar para dia');
  }
  setFreeMode(freeMode);
  syncPlayIcon();
  syncDayButton();
  roomLabel.textContent = reducedMotion ? 'Explore livremente' : labelFor(0);

  playBtn.addEventListener('click', function () { if (freeMode) setFreeMode(false); playing = !playing; syncPlayIcon(); });
  restartBtn.addEventListener('click', function () { elapsed = 0; playing = true; syncPlayIcon(); if (freeMode) setFreeMode(false); });
  freeToggle.addEventListener('click', function () { setFreeMode(!freeMode); });
  if (dayToggle) dayToggle.addEventListener('click', function () { isDay = !isDay; syncDayButton(); });

  // ---------- integração com o back-end ----------
  function csrfHeaders() { return { 'X-CSRFToken': opts.csrfToken }; }

  function toggleDevice(sceneId, o) {
    o = o || {};
    var d = devices[sceneId];
    if (!d || !d.realId) return;
    if (!d.podeControlar) { showToast(d.name, d.on, 'Sem permissão pra controlar'); return; }

    var novoEstado = !d.on;
    if (sceneId === 'porta-garagem' && novoEstado && !o.auto) garage.autoClose = true;
    d.on = novoEstado;
    d.apply(novoEstado);
    refreshCount();
    showToast(d.name, novoEstado, o.auto ? 'Fechamento automático' : null);
    if (!o.auto && playing && !freeMode) { playing = false; syncPlayIcon(); }

    fetch('/dispositivo/' + d.realId + '/alternar', { method: 'POST', headers: csrfHeaders() })
      .catch(function () {})
      .then(function () { setTimeout(syncFromServer, 300); setTimeout(syncPulseAi, 900); });
  }

  function syncFromServer() {
    fetch('/api/dispositivos').then(function (r) { return r.json(); }).then(function (lista) {
      lista.forEach(function (real) {
        var sceneId = NAME_TO_SCENE[real.nome];
        if (!sceneId) return;
        var d = devices[sceneId];
        if (!d) return;
        d.realId = real.id;
        d.podeControlar = real.pode_controlar;
        if (d.on !== real.ativo) {
          d.on = real.ativo;
          d.apply(d.on);
          refreshCount();
          showToast(d.name, d.on, (d.on ? 'Ligado' : 'Desligado') + ' — atualizado');
        }
      });
    }).catch(function () {});
  }
  setInterval(syncFromServer, 5000);

  // =====================================================================
  // 12. PULSE AI na maquete — o agente aparece como um holograma sobre o
  // hub do escritório (o "cérebro" da casa), um anel de varredura mostra
  // que o monitoramento está ativo, marcadores flutuam sobre os
  // dispositivos com ocorrência e o piso do cômodo é sinalizado quando há
  // Atenção/Crítico. Os dados vêm de GET /pulse-ai/api/maquete (os mesmos
  // alertas da página do agente); sem essa URL, nada disso é criado.
  // =====================================================================
  var AI_COR = { ok: 0x2fd8cf, info: 0x2fd8cf, atencao: 0xfab219, critico: 0xff4d4d };
  var AI_CSS = { ok: '#2fd8cf', info: '#2fd8cf', atencao: '#fab219', critico: '#ff4d4d' };
  // limites (x0, z0, x1, z1) de cada cômodo do banco na planta da maquete
  var ROOM_BOUNDS = { 'Garagem': [-13, 0, -7, 6], 'Sala': [-7, 0, 0, 6], 'Cozinha': [-7, -6, 0, 0], 'Quarto': [0, -6, 7, 0] };
  var aiState = { status: 'ok', alertas: [], comodos: {}, luzes: [], abertos: [], ativo: false };
  var flight = null;

  // holograma do agente sobre o hub (escritório)
  var aiHolo = group(5.4, 1.85, 4.6);
  var aiHoloMat = new THREE.MeshBasicMaterial({ color: AI_COR.ok, wireframe: true, transparent: true, opacity: 0.85 });
  var aiHoloCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), aiHoloMat);
  aiHolo.add(aiHoloCore);
  var aiHoloRingMat = new THREE.MeshBasicMaterial({ color: AI_COR.ok, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  var aiHoloRings = [0.26, 0.34].map(function (r) {
    var ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.008, r, 48), aiHoloRingMat);
    ring.rotation.x = -PI / 2; aiHolo.add(ring); return ring;
  });
  var aiBeamMat = new THREE.MeshBasicMaterial({ color: AI_COR.ok, transparent: true, opacity: 0.18, depthWrite: false });
  at(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.14, 0.62, 16, 1, true), aiBeamMat), 0, -0.36, 0, 0, aiHolo);
  var aiHoloLight = new THREE.PointLight(AI_COR.ok, 0.35, 3, 2);
  aiHolo.add(aiHoloLight);
  aiHolo.scale.setScalar(1.5);
  aiHolo.visible = false;

  // anel de varredura (monitoramento ativo) a partir do hub
  var aiScanMat = new THREE.MeshBasicMaterial({ color: AI_COR.ok, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  var aiScan = at(new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 96), aiScanMat), -3, 0.06, 0);
  aiScan.rotation.x = -PI / 2; aiScan.visible = false;

  // marcador (sprite) com "!" para alerta e "i" para informativo
  var aiTexCache = {};
  function aiMarkerTex(prioridade) {
    if (aiTexCache[prioridade]) return aiTexCache[prioridade];
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var g = c.getContext('2d'), cor = AI_CSS[prioridade];
    g.fillStyle = 'rgba(8,10,16,0.85)'; g.beginPath(); g.arc(64, 64, 54, 0, PI * 2); g.fill();
    g.lineWidth = 8; g.strokeStyle = cor; g.beginPath(); g.arc(64, 64, 50, 0, PI * 2); g.stroke();
    g.fillStyle = cor; g.font = 'bold 70px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(prioridade === 'info' ? 'i' : '!', 64, 68);
    var tex = new THREE.CanvasTexture(c);
    if (tex.encoding !== undefined) tex.encoding = THREE.sRGBEncoding;
    return (aiTexCache[prioridade] = tex);
  }
  var aiMarkers = {};   // sceneId -> { sprite, prioridade }
  var aiOverlays = {};  // cômodo -> mesh
  var aiBox = new THREE.Box3(), aiTmp = new THREE.Vector3();

  function deviceCenter(sceneId, out) {
    var d = devices[sceneId];
    // a porta da garagem registra [porta, carro]: o alvo é a porta
    aiBox.setFromObject(d.meshes[0]);
    return aiBox.getCenter(out);
  }
  function aplicarPulseAi(dados) {
    aiState.ativo = true;
    aiState.status = dados.status;
    aiState.alertas = dados.alertas || [];
    aiState.comodos = dados.comodos || {};
    aiState.luzes = dados.luzes_por_comodo || [];
    aiState.abertos = dados.abertos || [];
    var cor = AI_COR[dados.status] || AI_COR.ok;
    aiHolo.visible = true; aiScan.visible = !reducedMotion;
    aiHoloMat.color.setHex(cor); aiHoloRingMat.color.setHex(cor); aiBeamMat.color.setHex(cor);
    aiHoloLight.color.setHex(cor); aiScanMat.color.setHex(cor);

    // marcadores: pior prioridade por dispositivo (+ "i" pra porta/janela aberta sem alerta)
    var peso = { info: 1, atencao: 2, critico: 3 }, alvo = {};
    aiState.alertas.forEach(function (a) {
      var id = NAME_TO_SCENE[a.dispositivo];
      if (id && devices[id] && (!alvo[id] || peso[a.prioridade] > peso[alvo[id]])) alvo[id] = a.prioridade;
    });
    aiState.abertos.forEach(function (o) {
      var id = NAME_TO_SCENE[o.dispositivo];
      if (id && devices[id] && !alvo[id]) alvo[id] = 'info';
    });
    Object.keys(aiMarkers).forEach(function (id) {
      if (!alvo[id]) { scene.remove(aiMarkers[id].sprite); delete aiMarkers[id]; }
    });
    Object.keys(alvo).forEach(function (id) {
      var m = aiMarkers[id];
      if (!m) {
        var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: aiMarkerTex(alvo[id]), depthTest: false, transparent: true }));
        sp.renderOrder = 10; sp.scale.set(0.85, 0.85, 1);
        scene.add(sp);
        m = aiMarkers[id] = { sprite: sp, prioridade: alvo[id], fase: Math.random() * PI * 2 };
      } else if (m.prioridade !== alvo[id]) {
        m.sprite.material.map = aiMarkerTex(alvo[id]); m.sprite.material.needsUpdate = true; m.prioridade = alvo[id];
      }
    });

    // piso do cômodo com ocorrência de Atenção/Crítico
    Object.keys(aiOverlays).forEach(function (nome) {
      if (!aiState.comodos[nome]) { scene.remove(aiOverlays[nome]); delete aiOverlays[nome]; }
    });
    Object.keys(aiState.comodos).forEach(function (nome) {
      var b = ROOM_BOUNDS[nome];
      if (!b) return;
      var corCom = AI_COR[aiState.comodos[nome]];
      var ov = aiOverlays[nome];
      if (!ov) {
        // preenchimento translúcido + moldura brilhante no contorno do cômodo
        var w = b[2] - b[0] - 0.3, dpt = b[3] - b[1] - 0.3;
        ov = group((b[0] + b[2]) / 2, 0.035, (b[1] + b[3]) / 2);
        var fillMat = new THREE.MeshBasicMaterial({ color: corCom, transparent: true, opacity: 0.2, depthWrite: false });
        var fill = new THREE.Mesh(new THREE.PlaneGeometry(w, dpt), fillMat);
        fill.rotation.x = -PI / 2; ov.add(fill);
        var bordaMat = new THREE.MeshBasicMaterial({ color: corCom, transparent: true, opacity: 0.85, depthWrite: false });
        [[w, 0.07, 0, dpt / 2], [w, 0.07, 0, -dpt / 2], [0.07, dpt, w / 2, 0], [0.07, dpt, -w / 2, 0]].forEach(function (e) {
          var s = new THREE.Mesh(new THREE.PlaneGeometry(e[0], e[1]), bordaMat);
          s.rotation.x = -PI / 2; s.position.set(e[2], 0.004, e[3]); ov.add(s);
        });
        ov.userData.fill = fillMat; ov.userData.borda = bordaMat;
        aiOverlays[nome] = ov;
      }
      ov.userData.fill.color.setHex(corCom); ov.userData.borda.color.setHex(corCom);
      ov.userData.critico = aiState.comodos[nome] === 'critico';
    });
    renderAiHud();
  }

  // painel do agente no HUD da maquete
  var aiHud = document.createElement('div');
  aiHud.className = 'iso3d-ai';
  aiHud.hidden = true;
  wrap.appendChild(aiHud);
  function renderAiHud() {
    aiHud.hidden = false;
    aiHud.className = 'iso3d-ai ' + aiState.status;
    aiHud.textContent = '';
    var head = document.createElement('div'); head.className = 'iso3d-ai-head';
    var dot = document.createElement('span'); dot.className = 'dot'; head.appendChild(dot);
    head.appendChild(document.createTextNode('PULSE AI · monitorando'));
    if (opts.pulseAiPagina) {
      var a = document.createElement('a'); a.href = opts.pulseAiPagina; a.textContent = 'abrir'; head.appendChild(a);
    }
    aiHud.appendChild(head);
    var sub = document.createElement('div'); sub.className = 'iso3d-ai-sub';
    sub.textContent = (aiState.alertas.length ? aiState.alertas.length + ' ocorrência(s)' : 'Sem ocorrências')
      + ' · luz acesa: ' + (aiState.luzes.length ? aiState.luzes.join(', ') : 'nenhum cômodo');
    aiHud.appendChild(sub);
    if (aiState.alertas.length) {
      var ul = document.createElement('ul'); ul.className = 'iso3d-ai-list';
      aiState.alertas.slice(0, 4).forEach(function (al) {
        var li = document.createElement('li'), b = document.createElement('button');
        b.type = 'button';
        var p = document.createElement('span'); p.className = 'p ' + al.prioridade; b.appendChild(p);
        b.appendChild(document.createTextNode(al.titulo + ' — ' + al.dispositivo));
        b.addEventListener('click', function () { focusDevice(NAME_TO_SCENE[al.dispositivo], al.titulo); });
        li.appendChild(b); ul.appendChild(li);
      });
      aiHud.appendChild(ul);
    }
  }

  function syncPulseAi() {
    if (!opts.pulseAiUrl || document.hidden) return;
    fetch(opts.pulseAiUrl, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw r; return r.json(); })
      .then(aplicarPulseAi)
      .catch(function () {});
  }
  if (opts.pulseAiUrl) { syncPulseAi(); setInterval(syncPulseAi, 5000); }

  // leva a câmera até o dispositivo (vindo de "Ver na maquete" ou do HUD)
  function focusDevice(sceneId, motivo) {
    var d = devices[sceneId];
    if (!d) return;
    var c = deviceCenter(sceneId, new THREE.Vector3());
    var dir = new THREE.Vector3(c.x + 3, 0, c.z);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
    dir.normalize();
    var toPos = new THREE.Vector3(c.x + dir.x * 5.5, Math.max(4.5, c.y + 4.5), c.z + dir.z * 5.5);
    if (!freeMode) setFreeMode(true);
    playing = false; syncPlayIcon();
    flight = { fromPos: camera.position.clone(), fromTarget: orbit.target.clone(), toPos: toPos, toTarget: c, t: 0 };
    roomLabel.textContent = d.name;
    showToast(d.name, d.on, motivo || 'Destacado pelo PULSE AI');
  }
  if (opts.foco && NAME_TO_SCENE[opts.foco]) {
    setTimeout(function () { focusDevice(NAME_TO_SCENE[opts.foco], 'Aberto a partir do PULSE AI'); }, 700);
  }

  function updatePulseAi(dt, t) {
    if (!aiState.ativo) return;
    var anim = !reducedMotion;
    aiHoloCore.rotation.y = anim ? t * 0.8 : 0;
    aiHoloCore.rotation.x = anim ? t * 0.35 : 0;
    aiHoloRings[0].rotation.z = anim ? t * 0.9 : 0;
    aiHoloRings[1].rotation.z = anim ? -t * 0.6 : 0;
    aiHolo.position.y = 1.85 + (anim ? Math.sin(t * 1.6) * 0.04 : 0);
    if (anim) {
      var ph = (t / 4) % 1;  // uma varredura a cada 4 s
      var r = 0.5 + ph * 12;
      aiScan.scale.set(r, r, 1);
      aiScanMat.opacity = 0.5 * (1 - ph);
    }
    Object.keys(aiMarkers).forEach(function (id) {
      var m = aiMarkers[id];
      deviceCenter(id, aiTmp);
      var bob = anim ? Math.sin(t * 2.2 + m.fase) * 0.08 : 0;
      m.sprite.position.set(aiTmp.x, aiBox.max.y + 0.6 + bob, aiTmp.z);
      var s = m.prioridade === 'critico' && anim ? 0.85 + Math.sin(t * 5) * 0.09 : 0.85;
      m.sprite.scale.set(s, s, 1);
    });
    Object.keys(aiOverlays).forEach(function (nome) {
      var ov = aiOverlays[nome];
      var pulso = anim ? Math.sin(t * (ov.userData.critico ? 4 : 2)) : 0;
      ov.userData.fill.opacity = (ov.userData.critico ? 0.3 : 0.18) + pulso * 0.08;
      ov.userData.borda.opacity = 0.75 + pulso * 0.25;
    });
  }

  function updateFlight(dt) {
    if (!flight) return false;
    flight.t = Math.min(1, flight.t + dt / (reducedMotion ? 0.01 : 1.3));
    var k = easeInOut(flight.t);
    camera.position.lerpVectors(flight.fromPos, flight.toPos, k);
    orbit.target.lerpVectors(flight.fromTarget, flight.toTarget, k);
    if (flight.t >= 1) flight = null;
    return true;
  }

  // ---------- clique/toque e hover em dispositivos (raycasting) ----------
  var raycaster = new THREE.Raycaster();
  var pointerNdc = new THREE.Vector2();
  var pointerPx = { x: 0, y: 0 };
  function ndcFromEvent(ev) {
    var rect = renderer.domElement.getBoundingClientRect();
    var cx = (ev.touches && ev.touches[0]) ? ev.touches[0].clientX : ev.clientX;
    var cy = (ev.touches && ev.touches[0]) ? ev.touches[0].clientY : ev.clientY;
    pointerPx.x = cx - rect.left; pointerPx.y = cy - rect.top;
    pointerNdc.x = (pointerPx.x / rect.width) * 2 - 1;
    pointerNdc.y = -(pointerPx.y / rect.height) * 2 + 1;
  }
  function deviceUnderPointer() {
    raycaster.setFromCamera(pointerNdc, camera);
    var hits = raycaster.intersectObjects(interactive, false);
    return hits.length ? hits[0].object.userData.deviceId : null;
  }
  renderer.domElement.addEventListener('pointermove', function (ev) {
    ndcFromEvent(ev);
    var id = deviceUnderPointer();
    renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
    if (id) {
      var d = devices[id];
      var estado = id === 'porta-garagem' ? (d.on ? 'Aberta' : 'Fechada') : id === 'janela-quarto' ? (d.on ? 'Aberta' : 'Fechada') : (d.on ? 'Ligado' : 'Desligado');
      hoverEl.textContent = d.name + ' · ' + estado;
      hoverEl.style.left = pointerPx.x + 'px';
      hoverEl.style.top = pointerPx.y + 'px';
      hoverEl.classList.add('show');
    } else hoverEl.classList.remove('show');
  });
  renderer.domElement.addEventListener('pointerleave', function () { hoverEl.classList.remove('show'); });
  renderer.domElement.addEventListener('click', function (ev) {
    ndcFromEvent(ev);
    var id = deviceUnderPointer();
    if (id) toggleDevice(id);
  });

  // ---------- laço principal ----------
  // simulate() avança tudo que se mexe na casa (garagem, carro, moradores,
  // portas, janela, ar...); animate() chama ela uma vez por frame e depois
  // cuida da câmera e do render.
  function simulate(dt, t) {
    var dayTarget = isDay ? 1 : 0;
    if (Math.abs(dayT - dayTarget) > 0.001) { dayT += (dayTarget - dayT) * Math.min(1, dt * 2.5); applyDayNight(dayT); }

    updateGarage(dt, t);
    if (!reducedMotion) updateRobot(dt);
    updateDoors(dt);
    updatePulseAi(dt, t);
    if (!reducedMotion) for (var i = 0; i < agents.length; i++) agents[i].update(dt, t);

    // janela + persiana
    windowT = Math.max(0, Math.min(1, windowT + (windowOpen ? 1 : -1) * dt * (reducedMotion ? 100 : 0.8)));
    var we = easeInOut(windowT);
    winSlide.position.z = -3.6 + 1.15 * we;
    winSlideFrame.position.z = -3.0 + 1.15 * we;
    var bh = 1.5 * (1 - 0.93 * we);
    blinds.scale.y = bh / 1.5;
    blinds.position.y = 2.3 - bh / 2;

    // câmeras de segurança: LED piscando + varredura suave
    if (!reducedMotion) {
      if (camExtActive) { extCamLedMat.emissiveIntensity = 1.1 + Math.sin(t * 3.2) * 0.9; extCam.rotation.y = extCamBase + Math.sin(t * 0.35) * 0.5; }
      if (camSalaActive) { salaCamLedMat.emissiveIntensity = 1.1 + Math.sin(t * 3.2 + 1.6) * 0.9; salaCam.rotation.y = salaCamBase + Math.sin(t * 0.3 + 1) * 0.45; }
      hubRing.rotation.x = t * 0.9; hubRing.rotation.y = t * 0.6;
      if (tvOn) tvScreenMat.emissiveIntensity = 0.95 + Math.sin(t * 7.3) * 0.03 + Math.sin(t * 2.1) * 0.04;
      poolMat.emissiveIntensity *= 1 + Math.sin(t * 1.7) * 0.004;
      cookRings.forEach(function (r, k) { r.material.emissiveIntensity = k === 0 && agents[0].pose === 'work' && agents[0].lastIdx === 1 ? 0.9 : 0; });
    }
    // ar-condicionado: aleta abre e "fluxo de ar" desce quando ligado
    acFlap.rotation.x += ((acOn ? 0.7 : 0) - acFlap.rotation.x) * Math.min(1, dt * 3);
    airMat.opacity += ((acOn ? 0.1 : 0) - airMat.opacity) * Math.min(1, dt * 3);
    if (acOn && !reducedMotion) airFlows.forEach(function (af) {
      var ph = (t * 0.5 + af.userData.phase) % 1;
      af.position.y = 2.15 - ph * 0.9; af.position.z = -5.45 + ph * 0.9;
      af.scale.set(1 + ph * 0.5, 1 + ph * 0.5, 1);
    });
  }

  function animate() {
    requestAnimationFrame(animate);
    var dt = Math.min(clock.getDelta(), 0.1);
    simulate(dt, clock.elapsedTime);

    if (!freeMode && playing) {
      elapsed += dt;
      if (elapsed >= TOTAL) { elapsed = TOTAL; playing = false; syncPlayIcon(); }
      var u = uFromElapsed(elapsed);
      camera.position.copy(posCurve.getPoint(u));
      camera.lookAt(lookCurve.getPoint(u));
      var frac = elapsed / TOTAL;
      fill.style.width = (frac * 100) + '%';
      roomLabel.textContent = labelFor(frac);
    } else if (freeMode) {
      updateFlight(dt);
      orbit.update();
    }
    renderer.render(scene, camera);
  }

  function onResize() {
    camera.aspect = wrap.clientWidth / wrap.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  }
  window.addEventListener('resize', onResize);
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(wrap);

  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      var loading = document.getElementById('iso3d-loading');
      loading.style.opacity = '0';
      setTimeout(function () { loading.style.display = 'none'; }, 450);
    });
  });

  animate();

  // Gancho opcional pra testes automatizados/screenshots (o dashboard não usa).
  if (typeof opts.onReady === 'function') {
    opts.onReady({
      camera: camera, orbit: orbit, setFreeMode: setFreeMode, toggleDevice: toggleDevice,
      garage: garage, devices: devices, agents: agents, simulate: simulate,
      pulseAi: aiState, aplicarPulseAi: aplicarPulseAi, focusDevice: focusDevice, aiMarkers: aiMarkers, aiOverlays: aiOverlays,
      render: function () { renderer.render(scene, camera); }
    });
  }
};
