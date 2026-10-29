/* =========================================================================
   Página Pluviométrico
   Fonte: planilha "Pluviométrico 2026.xlsm"
     - aba Acumulado: Data | Frente | Cód. Fazenda | Fazenda | Turno | Chuva (mm)
     - aba PLUVIOMÉTRICO 2026 (formulário do dia), usada para o dia que ainda
       não foi transferido para o Acumulado.
   Regras:
     - a série começa no primeiro dia lançado no Acumulado (safra); dia sem linha na planilha = sem chuva (0 mm);
     - chuva de um dia = média dos pontos medidos (como a linha "Média" do formulário),
       somando os turnos escolhidos em cada ponto;
     - total do mês e acumulado = soma das chuvas diárias.
   ========================================================================= */
(function () {
  'use strict';
  const P = {};
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const mm = v => nf(v, v >= 100 || Number.isInteger(Math.round(v * 10) / 10) ? 0 : 1);
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const br = iso => iso.split('-').reverse().join('/');
  const brC = iso => iso.split('-').reverse().slice(0, 2).join('/');
  const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const semMov = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TURNOS = ['A', 'B', 'C'];
  // azul ordinal validado (dataviz --ordinal): turno A claro → C escuro
  const COR_T = { A: '#86b6ef', B: '#2a78d6', C: '#104281' };
  // rampa sequencial (mapa de calor), 0 mm = superfície neutra
  const FAIXAS = [[0, '#F1F3EF'], [2, '#cde2fb'], [5, '#9ec5f4'], [10, '#6da7ec'], [20, '#3987e5'], [35, '#256abf'], [50, '#184f95'], [Infinity, '#0d366b']];
  const corMm = v => (v <= 0 ? FAIXAS[0][1] : FAIXAS.find((f, i) => i && v <= f[0])[1]);

  /* ---------- leitura da planilha ---------- */
  const iso = v => {
    if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
    if (typeof v === 'number' && v > 30000) { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
    const m = String(v ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };
  const num = v => (typeof v === 'number' ? v : (v == null || v === '' ? null : (Number.isFinite(+String(v).replace(',', '.')) ? +String(v).replace(',', '.') : null)));
  const titulo = s => s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das|E)\b(?=\s)/g, w => w.toLowerCase()).replace(/\b(Ii|Iii|Iv)\b/g, w => w.toUpperCase());
  const frenteN = s => {
    const t = String(s ?? '').trim(); const n = norm(t);
    const m = n.match(/^(colheita|fertirrigacao|plantio|preparo|vinhaca|irrigacao)?\s*frente\s*(\d+)/);
    if (!m) return titulo(t.replace(/\s+/g, ' '));
    const tipo = { colheita: 'Colheita', fertirrigacao: 'Fertirrigação', plantio: 'Plantio', preparo: 'Preparo', vinhaca: 'Vinhaça', irrigacao: 'Irrigação' }[m[1]] || '';
    return `${tipo ? tipo + ' · ' : ''}Frente ${m[2].padStart(2, '0')}`;
  };
  const fazN = s => titulo(String(s ?? '').replace(/\s+/g, ' ').trim().replace(/^faz\.?\s*/i, 'Faz. ').replace(/^fazenda\s+/i, 'Faz. '));
  P.ler = (wb, X, arquivo = '') => {
    X = X || window.XLSX;
    const linhas = n => X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null });
    const regs = []; // {d, frente, cod, faz, t, v}
    let formData = null;
    wb.SheetNames.forEach(nome => {
      const rows = linhas(nome);
      // base acumulada
      const hi = rows.findIndex(r => r && norm(r[0]) === 'data' && r.some(c => norm(c) === 'turno') && r.some(c => norm(c).startsWith('chuva')));
      if (hi >= 0) {
        const h = rows[hi].map(norm), ix = k => h.findIndex(x => x.startsWith(k));
        const c = { d: 0, fr: ix('frente'), cod: ix('cod'), faz: h.findIndex(x => x === 'fazenda' || x.startsWith('fazenda')), t: ix('turno'), v: ix('chuva') };
        rows.slice(hi + 1).forEach(r => {
          const d = r && iso(r[c.d]), v = r && num(r[c.v]); if (!d || v == null) return;
          const t = String(r[c.t] ?? '').trim().toUpperCase(); if (!TURNOS.includes(t)) return;
          regs.push({ d, frente: frenteN(r[c.fr]), cod: String(r[c.cod] ?? '').trim(), faz: fazN(r[c.faz]), t, v: Math.max(0, v), src: 'acc' });
        });
        return;
      }
      // formulário do dia (Turno A | Turno B | Turno C)
      const fi = rows.findIndex(r => r && r.some(c => norm(c) === 'turno a') && r.some(c => norm(c) === 'turno c'));
      if (fi >= 0) {
        const dl = rows.slice(0, fi).find(r => r && r.some(c => norm(c).startsWith('data')));
        const d = dl && iso(dl.find(c => c instanceof Date || (typeof c === 'number' && c > 30000)));
        if (!d) return;
        formData = d;
        const h = rows[fi].map(norm), ix = k => h.findIndex(x => x.startsWith(k));
        const c = { fr: ix('frente'), cod: ix('codigo'), faz: ix('fazenda'), A: h.indexOf('turno a'), B: h.indexOf('turno b'), C: h.indexOf('turno c') };
        rows.slice(fi + 1).forEach(r => {
          if (!r || !r[c.fr] || /^media/.test(norm(r[c.fr]))) return;
          if (!/frente/.test(norm(r[c.fr]))) return;
          TURNOS.forEach(t => { const v = num(r[c[t]]); if (v != null) regs.push({ d, frente: frenteN(r[c.fr]), cod: String(r[c.cod] ?? '').trim(), faz: fazN(r[c.faz]), t, v: Math.max(0, v), src: 'form' }); });
        });
      }
    });
    if (!regs.length) throw new Error('não encontrei a aba Acumulado (Data, Frente, Cód. Fazenda, Fazenda, Turno, Chuva)');
    // o formulário só entra onde o acumulado ainda não tem aquele ponto/turno
    const ja = new Set(regs.filter(r => r.src === 'acc').map(r => `${r.d}|${r.frente}|${r.cod}|${r.t}`));
    const base = regs.filter(r => r.src === 'acc' || !ja.has(`${r.d}|${r.frente}|${r.cod}|${r.t}`));
    // nome da fazenda: o mais frequente para cada código
    const nomes = {}; base.forEach(r => { const m = nomes[r.cod] || (nomes[r.cod] = {}); m[r.faz] = (m[r.faz] || 0) + 1; });
    const nomeDe = cod => Object.entries(nomes[cod] || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const locais = [], li = new Map();
    const reg = [];
    base.forEach(r => {
      const k = `${r.frente}|${r.cod}`;
      if (!li.has(k)) { li.set(k, locais.length); locais.push({ frente: r.frente, cod: r.cod, faz: nomeDe(r.cod) }); }
      reg.push([r.d, li.get(k), r.t, Math.round(r.v * 10) / 10]);
    });
    const datasR = reg.map(r => r[0]).sort(), inicio = datasR[0] || formData;
    const ultima = [...datasR, formData || inicio].sort().pop();
    const agora = new Date();
    return { meta: { arquivo, inicio, ate: ultima, formulario: formData, lidoEm: agora.toISOString() }, locais, reg };
  };

  /* ---------- estado e cálculos ---------- */
  let D = null, IDX = null;
  const F = { turno: 'todos', dia: null, frente: '', cod: '', faz: '' };
  const preparar = data => {
    D = data;
    const dias = []; for (let d = D.meta.inicio; d <= D.meta.ate; d = addDias(d, 1)) dias.push(d);
    const porDia = new Map(); // d → Map(li → {A,B,C})
    D.reg.forEach(([d, li, t, v]) => { const m = porDia.get(d) || porDia.set(d, new Map()).get(d); const x = m.get(li) || m.set(li, { A: 0, B: 0, C: 0 }).get(li); x[t] += v; });
    IDX = { dias, porDia, frentes: [...new Set(D.locais.map(l => l.frente))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })) };
    if (!F.dia || !dias.includes(F.dia)) F.dia = dias[dias.length - 1];
  };
  const tSel = () => (F.turno === 'todos' ? TURNOS : [F.turno]);
  const localOk = l => (!F.frente || l.frente === F.frente) && (!F.cod || l.cod === F.cod) && (!F.faz || l.faz === F.faz);
  const valLocal = x => tSel().reduce((s, t) => s + (x[t] || 0), 0);
  // pontos medidos no dia (com os filtros) → [{li, l, v, A, B, C}]
  const pontos = d => { const m = IDX.porDia.get(d); if (!m) return []; const o = []; m.forEach((x, li) => { const l = D.locais[li]; if (localOk(l)) o.push({ li, l, v: valLocal(x), ...x }); }); return o; };
  const diaInfo = d => {
    const p = pontos(d), n = p.length;
    if (!n) return { d, v: 0, n: 0, A: 0, B: 0, C: 0, max: null, p };
    const med = k => p.reduce((s, x) => s + x[k], 0) / n;
    return { d, v: p.reduce((s, x) => s + x.v, 0) / n, n, A: med('A'), B: med('B'), C: med('C'), max: p.reduce((a, b) => (b.v > (a ? a.v : -1) ? b : a), null), p };
  };
  const serie = () => { let acc = 0; return IDX.dias.map(d => { const x = diaInfo(d); acc += x.v; return { ...x, acc }; }); };

  /* ---------- números que contam ---------- */
  const contar = (el, alvo, dec = 0, ms = 900) => {
    if (!el) return;
    const fmt = v => nf(v, dec);
    if (semMov()) { el.textContent = fmt(alvo); return; }
    const de = parseFloat(el.dataset.v || '0'); el.dataset.v = alvo;
    cancelAnimationFrame(el._r); const t0 = performance.now();
    const f = t => { const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(de + (alvo - de) * e); if (p < 1) el._r = requestAnimationFrame(f); };
    el._r = requestAnimationFrame(f);
  };

  /* ---------- tooltip ---------- */
  const tip = (() => {
    let el = null;
    const get = () => el || (el = Object.assign(document.createElement('div'), { className: 'pv-tip' }), document.body.appendChild(el), el);
    return {
      show(html, x, y) { const t = get(); t.innerHTML = html; t.classList.add('on'); const r = t.getBoundingClientRect(); let L = x + 14, T = y - r.height - 12; if (L + r.width > innerWidth - 8) L = x - r.width - 14; if (T < 8) T = y + 16; t.style.transform = `translate(${L}px,${T}px)`; },
      hide() { if (el) el.classList.remove('on'); },
    };
  })();
  const turnosTip = x => TURNOS.map(t => `<span class="pv-tt"><i style="background:${COR_T[t]}"></i>Turno ${t}<b>${mm(x[t])} mm</b></span>`).join('');

  /* ---------- montagem ---------- */
  const raiz = () => $('#pvConteudo');
  const pluviometro = () => `
    <svg class="pv-tubo" viewBox="0 0 120 230" aria-hidden="true">
      <defs>
        <clipPath id="pvClip"><rect x="34" y="22" width="52" height="186" rx="10"/></clipPath>
        <linearGradient id="pvAgua" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#6da7ec"/><stop offset="1" stop-color="#1c5cab"/></linearGradient>
        <linearGradient id="pvVidro" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".0"/><stop offset=".25" stop-color="#fff" stop-opacity=".55"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/></linearGradient>
      </defs>
      <path d="M22 8 h76 l-12 14 h-52 z" fill="#E3E8E1"/>
      <rect x="34" y="22" width="52" height="186" rx="10" fill="#F4F7F2" stroke="#D8DED3"/>
      <g clip-path="url(#pvClip)">
        <g class="pv-nivel" style="transform:translateY(186px)">
          <path class="pv-onda" d="M0 30 Q 13 22 26 30 T 52 30 T 78 30 T 104 30 T 130 30 T 156 30 V 260 H 0 Z" fill="url(#pvAgua)" opacity=".55"/>
          <path class="pv-onda b" d="M0 32 Q 13 26 26 32 T 52 32 T 78 32 T 104 32 T 130 32 T 156 32 V 260 H 0 Z" fill="url(#pvAgua)"/>
        </g>
      </g>
      <rect x="34" y="22" width="52" height="186" rx="10" fill="url(#pvVidro)"/>
      <g class="pv-escala"></g>
      <rect x="28" y="206" width="64" height="12" rx="4" fill="#C9D2C5"/>
    </svg>`;
  P.montar = data => {
    preparar(data);
    const r = raiz(); if (!r) return;
    r.innerHTML = `
      <section class="section section--first" id="pvVisao" data-nome="Visão geral">
        <div class="pv-top">
          <article class="pv-hero card">
            <div class="pv-hero__tubo">${pluviometro()}</div>
            <div class="pv-hero__txt">
              <span class="pv-eyebrow"><i class="fa-solid fa-cloud-rain"></i><span id="pvHeroData"></span></span>
              <div class="pv-big"><b id="pvDia">0</b><small>mm</small></div>
              <p class="pv-sub" id="pvDiaSub"></p>
              <div class="pv-turnos" id="pvTurnos"></div>
            </div>
          </article>
          <div class="pv-kcol">
            <article class="k pv-k"><div class="k__t">Total de chuvas no mês<i class="fa-solid fa-calendar-week"></i></div><div class="k__v"><b id="pvMes">0</b><small>mm</small></div><div class="k__s" id="pvMesSub"></div><div class="pv-mini" id="pvMesMini"></div></article>
            <article class="k pv-k"><div class="k__t"><span id="pvAccT">Acumulado da safra</span><i class="fa-solid fa-droplet"></i></div><div class="k__v"><b id="pvAcc">0</b><small>mm</small></div><div class="k__s" id="pvAccSub"></div><div class="pv-prog"><i id="pvAccBar"></i></div></article>
          </div>
          <article class="card pv-leitura"><span class="pv-eyebrow"><i class="fa-regular fa-lightbulb"></i>Leitura do dia</span><p id="pvLeitura"></p></article>
        </div>
      </section>
      <section class="section" id="pvLinha" data-nome="Linha do tempo">
        <article class="card pv-tl">
          <header class="card__head"><div><h3>Linha do tempo</h3><p class="hint">Chuva de cada dia (média dos pontos) · clique ou arraste para escolher o dia · dia sem registro = sem chuva</p></div>
            <div class="pv-tl__ctl"><button type="button" class="pv-play" id="pvPlay" aria-label="Reproduzir a linha do tempo"><i class="fa-solid fa-play"></i><span>Reproduzir</span></button></div></header>
          <div class="pv-meses" id="pvMeses" role="tablist" aria-label="Mês"></div>
          <div class="pv-tl__box" id="pvTl"></div>
          <div class="pv-tl__acc"><div class="pv-tl__lbl"><b>Acumulado</b><span class="hint" id="pvTlAccH">mm na safra</span></div><div id="pvTlAcc"></div></div>
        </article>
      </section>
      <section class="section" id="pvFrentes" data-nome="Por frente">
        <div class="grid grid--2 pv-g2">
          <article class="card"><header class="card__head"><div><h3>Chuva por frente</h3><p class="hint" id="pvFrHint"></p></div><div class="pv-leg">${TURNOS.map(t => `<span><i style="background:${COR_T[t]}"></i>Turno ${t}</span>`).join('')}</div></header><div class="pv-fr" id="pvFr"></div></article>
          <article class="card"><header class="card__head"><div><h3>Acumulado por frente</h3><p class="hint">Soma da safra até o dia escolhido</p></div></header><div class="pv-fr" id="pvFrAcc"></div></article>
        </div>
      </section>
      <section class="section" id="pvMapa" data-nome="Mapa de chuva">
        <article class="card"><header class="card__head"><div><h3>Mapa de chuva</h3><p class="hint" id="pvHeatH">Frentes x dias do mês · cor = milímetros · clique numa coluna para ver o dia</p></div><div class="pv-escbar" id="pvEsc"></div></header><div class="pv-heat" id="pvHeat"></div></article>
      </section>
      <section class="section" id="pvLocais" data-nome="Fazendas">
        <article class="card"><header class="card__head"><div><h3>Fazendas</h3><p class="hint">Chuva por ponto de medição</p></div></header><div class="table-wrap"><table class="pv-tab" id="pvTab"></table></div></article>
      </section>`;
    // escala do mapa de calor
    $('#pvEsc').innerHTML = `<span>0</span>${FAIXAS.slice(1).map(([lim, c], i) => `<i style="background:${c}" title="${i ? `${FAIXAS[i][0]}–${lim === Infinity ? '' : lim}` : `até ${lim}`} mm"></i>`).join('')}<span>50+ mm</span>`;
    montarFiltros();
    eventos();
    atualizar(true);
    if (window.Layout && Layout.secoes && Layout.pagina && Layout.pagina() === 'pluvio') Layout.secoes();
  };

  /* ---------- filtros ---------- */
  const montarFiltros = () => {
    const opt = (sel, vals, atual, todos) => { const el = $(sel); if (!el) return; el.innerHTML = `<option value="">${todos}</option>` + vals.map(v => `<option value="${esc(v)}"${v === atual ? ' selected' : ''}>${esc(v)}</option>`).join(''); };
    const L = D.locais.filter(l => !F.frente || l.frente === F.frente);
    opt('#pvFrente', IDX.frentes, F.frente, 'Todas');
    opt('#pvCod', [...new Set(L.filter(l => !F.faz || l.faz === F.faz).map(l => l.cod))].sort((a, b) => a - b), F.cod, 'Todos');
    opt('#pvFaz', [...new Set(L.filter(l => !F.cod || l.cod === F.cod).map(l => l.faz))].sort((a, b) => a.localeCompare(b, 'pt-BR')), F.faz, 'Todas');
    const di = $('#pvData'); if (di) { di.min = IDX.dias[0]; di.max = IDX.dias[IDX.dias.length - 1]; di.value = F.dia; }
    $$('#pvTurno button').forEach(b => b.classList.toggle('is-on', b.dataset.t === F.turno));
    const ativo = F.turno !== 'todos' || F.frente || F.cod || F.faz; const lp = $('#pvLimpar'); if (lp) lp.classList.toggle('is-on', !!ativo);
  };
  let EV = false;
  const eventos = () => {
    if (EV) return; EV = true;
    const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
    on('#pvTurno', 'click', e => { const b = e.target.closest('button'); if (!b) return; F.turno = b.dataset.t; mover('#pvTurno', b); atualizar(); });
    on('#pvFrente', 'change', e => { F.frente = e.target.value; F.cod = ''; F.faz = ''; atualizar(); });
    on('#pvCod', 'change', e => { F.cod = e.target.value; if (F.cod) F.faz = D.locais.find(l => l.cod === F.cod).faz; atualizar(); });
    on('#pvFaz', 'change', e => { F.faz = e.target.value; F.cod = ''; atualizar(); });
    on('#pvData', 'change', e => { if (IDX.dias.includes(e.target.value)) { F.dia = e.target.value; atualizar(); } });
    on('#pvAnt', 'click', () => passo(-1));
    on('#pvProx', 'click', () => passo(1));
    on('#pvLimpar', 'click', () => { Object.assign(F, { turno: 'todos', frente: '', cod: '', faz: '' }); mover('#pvTurno', $('#pvTurno button[data-t="todos"]')); atualizar(); });
    on('#pvPlay', 'click', tocar);
    addEventListener('resize', () => { clearTimeout(EV._r); EV._r = setTimeout(() => { desenharTL(false); }, 120); });
    requestAnimationFrame(() => mover('#pvTurno', $('#pvTurno button.is-on'), true));
  };
  const mover = (seg, b, ja) => { const s = $(seg); if (!s || !b) return; const ind = s.querySelector('.ind'); if (!ind) return; if (ja) ind.style.transition = 'none'; ind.style.left = b.offsetLeft + 'px'; ind.style.width = b.offsetWidth + 'px'; if (ja) { void ind.offsetWidth; ind.style.transition = ''; } $$(seg + ' button').forEach(x => x.classList.toggle('is-on', x === b)); };
  const passo = n => { const i = IDX.dias.indexOf(F.dia) + n; if (i >= 0 && i < IDX.dias.length) { F.dia = IDX.dias[i]; atualizar(); } };
  let PLAY = null;
  const tocar = () => {
    const b = $('#pvPlay');
    if (PLAY) { clearInterval(PLAY); PLAY = null; b.classList.remove('is-on'); b.innerHTML = '<i class="fa-solid fa-play"></i><span>Reproduzir</span>'; return; }
    b.classList.add('is-on'); b.innerHTML = '<i class="fa-solid fa-pause"></i><span>Pausar</span>';
    const doMes = IDX.dias.filter(d => d.startsWith(F.dia.slice(0, 7)));
    let i = F.dia === doMes[doMes.length - 1] ? 0 : doMes.indexOf(F.dia);
    F.dia = doMes[i]; atualizar(false, true);
    PLAY = setInterval(() => { i++; if (i >= doMes.length) { tocar(); return; } F.dia = doMes[i]; atualizar(false, true); }, 420);
  };

  /* ---------- atualização geral ---------- */
  let S = null;
  const atualizar = (primeira, rapido) => {
    montarFiltros();
    S = serie();
    const x = S.find(s => s.d === F.dia), mes = F.dia.slice(0, 7);
    const doMes = S.filter(s => s.d.startsWith(mes) && s.d <= F.dia);
    const totMes = doMes.reduce((s, y) => s + y.v, 0), diasChuvaMes = doMes.filter(y => y.v > 0).length;
    const ate = S.filter(s => s.d <= F.dia), diasChuva = ate.filter(y => y.v > 0).length;
    const maior = ate.reduce((a, b) => (b.v > (a ? a.v : 0) ? b : a), null);
    const dt = new Date(F.dia + 'T12:00:00');
    // cabeçalho
    const pg = $('#pvPgData'); if (pg) pg.textContent = `Chuva de ${br(F.dia)} · ${SEM[dt.getDay()]}`;
    $('#pvHeroData').textContent = `Chuva no dia · ${SEM[dt.getDay()]}, ${brC(F.dia)}`;
    contar($('#pvDia'), x.v, x.v >= 100 ? 0 : 1, rapido ? 300 : 900);
    $('#pvDiaSub').innerHTML = x.n ? `Média de <b>${x.n} ${x.n === 1 ? 'ponto' : 'pontos'}</b> de medição${x.max && x.max.v > 0 ? ` · maior: <b>${mm(x.max.v)} mm</b> na ${esc(x.max.l.faz)}` : ''}` : 'Sem registro de chuva neste dia';
    const mxT = Math.max(1, x.A, x.B, x.C);
    $('#pvTurnos').innerHTML = TURNOS.map(t => `<div class="pv-turno${F.turno !== 'todos' && F.turno !== t ? ' off' : ''}"><span>Turno ${t}</span><span class="pv-turno__bar"><i style="--w:${(x[t] / mxT * 100).toFixed(1)}%;background:${COR_T[t]}"></i></span><b>${mm(x[t])}<small> mm</small></b></div>`).join('');
    requestAnimationFrame(() => $$('#pvTurnos .pv-turno__bar i').forEach(i => i.classList.add('on')));
    contar($('#pvMes'), totMes, totMes >= 100 ? 0 : 1, rapido ? 300 : 900);
    $('#pvMesSub').innerHTML = `${MESES[+mes.slice(5) - 1].replace(/^./, c => c.toUpperCase())} · <b>${diasChuvaMes}</b> ${diasChuvaMes === 1 ? 'dia' : 'dias'} com chuva`;
    const mx = Math.max(1, ...doMes.map(y => y.v));
    $('#pvMesMini').innerHTML = S.filter(s => s.d.startsWith(mes)).map(y => `<i class="${y.d === F.dia ? 'is-sel' : ''}${y.d > F.dia ? ' fut' : ''}" style="height:${y.d > F.dia ? 0 : Math.max(y.v > 0 ? 8 : 3, y.v / mx * 100)}%"></i>`).join('');
    contar($('#pvAcc'), x.acc, x.acc >= 100 ? 0 : 1, rapido ? 300 : 900);
    const totGeral = S[S.length - 1].acc || 1;
    $('#pvAccT').textContent = `Acumulado desde ${brC(D.meta.inicio)}`; const th = $('#pvTlAccH'); if (th) th.textContent = `mm acumulados desde ${brC(D.meta.inicio)}`;
    $('#pvAccSub').innerHTML = `<b>${diasChuva}</b> de ${ate.length} dias com chuva${maior && maior.v > 0 ? ` · maior: ${mm(maior.v)} mm em ${brC(maior.d)}` : ''}`;
    requestAnimationFrame(() => { $('#pvAccBar').style.width = (x.acc / totGeral * 100).toFixed(1) + '%'; });
    // pluviômetro
    const esc0 = Math.max(10, Math.ceil(Math.max(...S.map(s => s.v)) / 10) * 10);
    const g = $('.pv-escala');
    if (g && g.dataset.m !== String(esc0)) { g.dataset.m = esc0; g.innerHTML = [0, .25, .5, .75, 1].map(f => { const y = 208 - f * 172; return `<line x1="86" x2="${f % .5 ? 94 : 100}" y1="${y}" y2="${y}" stroke="#AEB8AA"/>${f % .5 ? '' : `<text x="104" y="${y + 4}" font-size="11" fill="#6E7C72">${Math.round(esc0 * f)}</text>`}`; }).join(''); }
    const niv = $('.pv-nivel'); if (niv) niv.style.transform = `translateY(${(186 - Math.min(1, x.v / esc0) * 172).toFixed(1)}px)`;
    // leitura
    const fr = porFrente(F.dia), top = fr.filter(f => f.v > 0).sort((a, b) => b.v - a.v);
    const tMax = TURNOS.map(t => [t, x[t]]).sort((a, b) => b[1] - a[1])[0];
    $('#pvLeitura').innerHTML = x.v > 0
      ? `Choveu em média <b>${mm(x.v)} mm</b> em ${brC(F.dia)}${F.turno === 'todos' && tMax[1] > 0 ? `, principalmente no <b>turno ${tMax[0]}</b>` : ''}. ${top.length ? `Mais chuva na <b>${esc(top[0].frente)}</b> (${mm(top[0].v)} mm)${top.length > 1 ? ` e na <b>${esc(top[1].frente)}</b> (${mm(top[1].v)} mm)` : ''}. ` : ''}No mês já são <b>${mm(totMes)} mm</b> em ${diasChuvaMes} ${diasChuvaMes === 1 ? 'dia' : 'dias'} de chuva.`
      : `Sem chuva registrada em ${brC(F.dia)}${F.frente || F.faz ? ' para o filtro escolhido' : ''}. No mês, <b>${mm(totMes)} mm</b> em ${diasChuvaMes} ${diasChuvaMes === 1 ? 'dia' : 'dias'} de chuva; acumulado de <b>${mm(x.acc)} mm</b> na safra (desde ${brC(D.meta.inicio)}).`;
    desenharTL(primeira);
    desenharFrentes(fr);
    desenharHeat();
    desenharTab();
  };

  /* ---------- por frente ---------- */
  const porFrente = d => {
    const p = pontos(d), g = new Map();
    p.forEach(x => { const a = g.get(x.l.frente) || g.set(x.l.frente, []).get(x.l.frente); a.push(x); });
    return IDX.frentes.filter(f => !F.frente || f === F.frente).map(f => {
      const a = g.get(f) || []; const n = a.length || 1; const m = k => a.reduce((s, x) => s + x[k], 0) / n;
      return { frente: f, n: a.length, v: a.length ? a.reduce((s, x) => s + x.v, 0) / n : 0, A: m('A'), B: m('B'), C: m('C'), faz: [...new Set(a.map(x => x.l.faz))].join(', ') };
    }).filter(f => !(F.cod || F.faz) || f.n);
  };
  const desenharFrentes = fr => {
    const el = $('#pvFr'); if (!el) return;
    $('#pvFrHint').textContent = `Dia ${br(F.dia)} · média dos pontos da frente · ${F.turno === 'todos' ? 'turnos empilhados' : 'turno ' + F.turno}`;
    const lista = [...fr].sort((a, b) => b.v - a.v || a.frente.localeCompare(b.frente, 'pt-BR', { numeric: true }));
    const mx = Math.max(1, ...lista.map(f => f.v));
    el.innerHTML = lista.map((f, i) => `<div class="pv-fr__l" data-f="${esc(f.frente)}" style="--i:${i}"><span class="nm">${esc(f.frente.replace(' · ', ' '))}<small>${esc(f.faz || 'sem medição')}</small></span><span class="trk">${tSel().map(t => f[t] > 0 ? `<i style="--w:${(f[t] / mx * 100).toFixed(2)}%;background:${COR_T[t]}" data-t="${t}"></i>` : '').join('')}</span><b>${f.n ? mm(f.v) : '—'}<small>${f.n ? ' mm' : ''}</small></b></div>`).join('') || '<p class="hint">Sem frentes para o filtro.</p>';
    requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll('.trk i').forEach(i => i.classList.add('on'))));
    el.querySelectorAll('.pv-fr__l').forEach(r => {
      const f = lista.find(x => x.frente === r.dataset.f);
      r.addEventListener('mousemove', e => tip.show(`<b>${esc(f.frente)}</b><small>${esc(f.faz || 'sem medição')} · ${br(F.dia)}</small>${turnosTip(f)}<span class="pv-tt tot">Total<b>${mm(f.v)} mm</b></span>`, e.clientX, e.clientY));
      r.addEventListener('mouseleave', tip.hide);
    });
    // acumulado por frente até o dia
    const ac = $('#pvFrAcc'); if (!ac) return;
    const tot = new Map(IDX.frentes.map(f => [f, 0]));
    IDX.dias.filter(d => d <= F.dia).forEach(d => porFrente(d).forEach(f => tot.set(f.frente, tot.get(f.frente) + f.v)));
    const la = [...tot].filter(([f]) => fr.some(x => x.frente === f)).sort((a, b) => b[1] - a[1]); const mxa = Math.max(1, ...la.map(x => x[1]));
    ac.innerHTML = la.map(([f, v], i) => `<div class="pv-fr__l" style="--i:${i}"><span class="nm">${esc(f.replace(' · ', ' '))}</span><span class="trk"><i style="--w:${(v / mxa * 100).toFixed(2)}%;background:#2a78d6"></i></span><b>${mm(v)}<small> mm</small></b></div>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => ac.querySelectorAll('.trk i').forEach(i => i.classList.add('on'))));
  };

  /* ---------- linha do tempo (SVG) ---------- */
  const nice = v => { const p = Math.pow(10, Math.floor(Math.log10(v))); return [1, 2, 2.5, 5, 10].map(m => m * p).find(m => m >= v) || v; };
  const desenharTL = anima => {
    const box = $('#pvTl'), boxA = $('#pvTlAcc'); if (!box || !S) return;
    desenharMeses();
    const SM = S.filter(s => s.d.startsWith(F.dia.slice(0, 7)));
    const W = Math.max(320, box.clientWidth), H = 190, m = { l: 38, r: 12, t: 22, b: 34 };
    const n = SM.length, cw = (W - m.l - m.r) / n, bw = Math.max(4, Math.min(26, cw * .62));
    const ymax = nice(Math.max(5, ...SM.map(s => s.v)) * 1.08), y = v => m.t + (H - m.t - m.b) * (1 - v / ymax);
    const x = i => m.l + cw * i + cw / 2;
    const ticks = [0, ymax / 2, ymax];
    const lbl = new Set(); // rótulos seletivos: maiores, dia escolhido
    [...SM].map((s, i) => [s.v, i]).filter(a => a[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, Math.max(3, Math.floor(n / 6))).forEach(a => lbl.add(a[1]));
    const sel = SM.findIndex(s => s.d === F.dia); lbl.add(sel);
    const passoX = Math.ceil(28 / cw);
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="pv-svg">
      ${ticks.map(t => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" class="gr"/><text x="${m.l - 8}" y="${y(t) + 4}" class="ax" text-anchor="end">${nf(t, 0)}</text>`).join('')}
      <rect class="sel-col" x="${x(sel) - cw / 2}" y="${m.t - 14}" width="${cw}" height="${H - m.t - m.b + 14}" rx="6"/>
      ${SM.map((s, i) => {
        const h = Math.max(0, y(0) - y(s.v)), dt = new Date(s.d + 'T12:00:00'), fds = dt.getDay() === 0;
        const bar = s.v > 0 ? `<path class="bar${i === sel ? ' is-sel' : ''}" style="--i:${i}" d="M${x(i) - bw / 2} ${y(0)} V${y(0) - h + Math.min(4, h)} q0 -${Math.min(4, h)} ${Math.min(4, bw / 2)} -${Math.min(4, h)} H${x(i) + bw / 2 - Math.min(4, bw / 2)} q${Math.min(4, bw / 2)} 0 ${Math.min(4, bw / 2)} ${Math.min(4, h)} V${y(0)} Z"/>` : `<circle class="zero${i === sel ? ' is-sel' : ''}" cx="${x(i)}" cy="${y(0) - 4}" r="2.6"/>`;
        const t = lbl.has(i) && s.v > 0 ? `<text class="vl${i === sel ? ' is-sel' : ''}" x="${x(i)}" y="${y(s.v) - 6}" text-anchor="middle">${mm(s.v)}</text>` : '';
        const ax = (i % passoX === 0 || i === sel) ? `<text class="ax${i === sel ? ' is-sel' : ''}${fds ? ' fds' : ''}" x="${x(i)}" y="${H - m.b + 16}" text-anchor="middle">${s.d.slice(8)}</text>` : '';
        const mesIni = s.d.endsWith('-01') ? `<text class="ax mes" x="${x(i) - cw / 2 + 2}" y="${H - 4}">${MESES[+s.d.slice(5, 7) - 1]}</text>` : '';
        return bar + t + ax + mesIni;
      }).join('')}
      <rect class="hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}"/>
    </svg>`;
    // acumulado (gráfico separado, mesmo eixo de dias)
    const HA = 96, ma = { t: 14, b: 8 }, base = SM[0].acc - SM[0].v, amax = base + nice(Math.max(1, SM[n - 1].acc - base) * 1.05), ya = v => ma.t + (HA - ma.t - ma.b) * (1 - (v - base) / (amax - base));
    const pts = SM.map((s, i) => `${x(i).toFixed(1)},${ya(s.acc).toFixed(1)}`), selP = SM[sel];
    const ate = SM.slice(0, sel + 1).map((s, i) => `${x(i).toFixed(1)},${ya(s.acc).toFixed(1)}`);
    boxA.innerHTML = `<svg viewBox="0 0 ${W} ${HA}" width="${W}" height="${HA}" class="pv-svg">
      <defs><linearGradient id="pvAccG" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2a78d6" stop-opacity=".28"/><stop offset="1" stop-color="#2a78d6" stop-opacity="0"/></linearGradient></defs>
      <line x1="${m.l}" x2="${W - m.r}" y1="${ya(base)}" y2="${ya(base)}" class="gr"/>
      <text x="${m.l - 8}" y="${ya(amax) + 4}" class="ax" text-anchor="end">${nf(amax, 0)}</text><text x="${m.l - 8}" y="${ya(base) + 4}" class="ax" text-anchor="end">${nf(base, 0)}</text>
      <polyline class="acc-fut" points="${pts.join(' ')}"/>
      <path class="acc-area" d="M${x(0)},${ya(base)} L${ate.join(' L')} L${x(sel)},${ya(base)} Z"/>
      <polyline class="acc-ln${anima ? ' draw' : ''}" points="${ate.join(' ')}"/>
      <circle class="acc-pt" cx="${x(sel)}" cy="${ya(selP.acc)}" r="5"/>
      <g class="acc-lb" transform="translate(${Math.min(W - m.r - 64, Math.max(m.l + 4, x(sel) - 32))},${Math.max(2, ya(selP.acc) - 30)})"><rect width="64" height="20" rx="10"/><text x="32" y="14" text-anchor="middle">${mm(selP.acc)} mm</text></g>
    </svg>`;
    // interação: hover, clique e arrastar
    const svg = box.querySelector('svg'), hit = svg.querySelector('.hit');
    const idx = e => { const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) * (W / r.width); return Math.max(0, Math.min(n - 1, Math.floor((px - m.l) / cw))); };
    let arr = false;
    hit.addEventListener('pointermove', e => {
      const i = idx(e), s = SM[i], dt = new Date(s.d + 'T12:00:00');
      tip.show(`<b>${SEM[dt.getDay()]}, ${br(s.d)}</b><small>${s.n ? `${s.n} ${s.n === 1 ? 'ponto' : 'pontos'} de medição` : 'sem registro · sem chuva'}</small>${s.n ? turnosTip(s) : ''}<span class="pv-tt tot">Chuva do dia<b>${mm(s.v)} mm</b></span><span class="pv-tt">Acumulado<b>${mm(s.acc)} mm</b></span>`, e.clientX, e.clientY);
      if (arr && SM[i].d !== F.dia) { F.dia = SM[i].d; atualizar(false, true); }
    });
    hit.addEventListener('pointerleave', () => { tip.hide(); arr = false; });
    hit.addEventListener('pointerdown', e => { arr = true; hit.setPointerCapture(e.pointerId); const i = idx(e); if (SM[i].d !== F.dia) { F.dia = SM[i].d; atualizar(false, true); } });
    hit.addEventListener('pointerup', () => { arr = false; });
    if (anima && !semMov()) svg.classList.add('cresce');
  };

  /* ---------- meses (seletor da linha do tempo e do mapa) ---------- */
  const desenharMeses = () => {
    const el = $('#pvMeses'); if (!el || !S) return;
    const ms = [...new Set(S.map(s => s.d.slice(0, 7)))];
    const tot = ms.map(m => { const a = S.filter(s => s.d.startsWith(m)); return { m, v: a.reduce((t, s) => t + s.v, 0), n: a.filter(s => s.n).length }; }).filter(x => x.n || x.m === F.dia.slice(0, 7) || x.m === ms[ms.length - 1]);
    const mx = Math.max(1, ...tot.map(t => t.v)), cur = F.dia.slice(0, 7);
    el.innerHTML = tot.map(t => `<button type="button" data-m="${t.m}" class="${t.m === cur ? 'is-on' : ''}" title="${MESES[+t.m.slice(5) - 1]}: ${mm(t.v)} mm"><span>${MESES[+t.m.slice(5) - 1].slice(0, 3)}</span><b>${mm(t.v)}<small> mm</small></b><i style="--w:${(t.v / mx * 100).toFixed(1)}%"></i></button>`).join('');
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const m = b.dataset.m; if (m === F.dia.slice(0, 7)) return;
      const ds = IDX.dias.filter(d => d.startsWith(m)); F.dia = ds[ds.length - 1]; atualizar(true);
    }));
  };

  /* ---------- mapa de calor ---------- */
  const desenharHeat = () => {
    const el = $('#pvHeat'); if (!el) return;
    const fr = IDX.frentes.filter(f => !F.frente || f === F.frente);
    const diasM = IDX.dias.filter(d => d.startsWith(F.dia.slice(0, 7)));
    const val = {}; diasM.forEach(d => porFrente(d).forEach(f => { (val[f.frente] || (val[f.frente] = {}))[d] = f; }));
    const linhas = fr.filter(f => !(F.cod || F.faz) || diasM.some(d => val[f] && val[f][d] && val[f][d].n));
    el.style.setProperty('--n', diasM.length);
    el.innerHTML = `<div class="pv-heat__g">
      <span class="hd"></span>${diasM.map(d => `<span class="hd${d === F.dia ? ' is-sel' : ''}" data-d="${d}">${d.slice(8)}</span>`).join('')}
      ${linhas.map((f, r) => `<span class="rl">${esc(f.replace(' · ', ' '))}</span>${diasM.map((d, i) => { const c = val[f] && val[f][d]; const v = c ? c.v : 0; return `<span class="cl${d === F.dia ? ' is-sel' : ''}${c && c.n ? '' : ' nd'}" data-f="${esc(f)}" data-d="${d}" style="background:${corMm(v)};--d:${(r * 18 + i * 10)}ms">${v >= 1 && v >= 10 ? Math.round(v) : ''}</span>`; }).join('')}`).join('')}
    </div>`;
    el.querySelectorAll('.cl').forEach(c => {
      c.addEventListener('mousemove', e => { const f = c.dataset.f, d = c.dataset.d, x = val[f] && val[f][d]; tip.show(`<b>${esc(f)}</b><small>${br(d)}${x && x.faz ? ' · ' + esc(x.faz) : ''}</small>${x && x.n ? turnosTip(x) + `<span class="pv-tt tot">Total<b>${mm(x.v)} mm</b></span>` : '<span class="pv-tt">Sem registro<b>0 mm</b></span>'}`, e.clientX, e.clientY); });
      c.addEventListener('mouseleave', tip.hide);
    });
    el.querySelectorAll('[data-d]').forEach(c => c.addEventListener('click', () => { F.dia = c.dataset.d; atualizar(); }));
  };

  /* ---------- tabela ---------- */
  let ORD = { k: 'dia', dir: -1 };
  const desenharTab = () => {
    const el = $('#pvTab'); if (!el) return;
    const mes = F.dia.slice(0, 7), g = new Map();
    D.locais.forEach((l, li) => { if (!localOk(l)) return; const k = `${l.cod}|${l.faz}`; const x = g.get(k) || g.set(k, { cod: l.cod, faz: l.faz, fr: new Set(), lis: [] }).get(k); x.fr.add(l.frente); x.lis.push(li); });
    const rows = [...g.values()].map(x => {
      let dia = null, A = 0, B = 0, C = 0, mesV = 0, acc = 0, nd = 0;
      IDX.dias.filter(d => d <= F.dia).forEach(d => {
        const m = IDX.porDia.get(d); if (!m) return;
        const vs = x.lis.map(li => m.get(li)).filter(Boolean); if (!vs.length) return;
        const v = vs.reduce((s, y) => s + valLocal(y), 0) / vs.length;
        acc += v; if (d.startsWith(mes)) mesV += v; if (v > 0) nd++;
        if (d === F.dia) { dia = v; A = vs.reduce((s, y) => s + y.A, 0) / vs.length; B = vs.reduce((s, y) => s + y.B, 0) / vs.length; C = vs.reduce((s, y) => s + y.C, 0) / vs.length; }
      });
      return { ...x, frente: [...x.fr].join(', '), dia, A, B, C, mes: mesV, acc, nd };
    }).filter(r => r.acc > 0 || r.dia != null);
    const k = ORD.k; rows.sort((a, b) => (typeof a[k] === 'string' ? a[k].localeCompare(b[k], 'pt-BR', { numeric: true }) : (a[k] ?? -1) - (b[k] ?? -1)) * ORD.dir);
    const mxA = Math.max(1, ...rows.map(r => r.acc));
    const th = (k2, t, cls = '') => `<th data-k="${k2}" class="${cls}${ORD.k === k2 ? ' ord' + (ORD.dir > 0 ? ' asc' : ' desc') : ''}">${t}</th>`;
    el.innerHTML = `<thead><tr>${th('cod', 'Cód.')}${th('faz', 'Fazenda')}${th('frente', 'Frente')}${F.turno === 'todos' ? TURNOS.map(t => th(t, 'Turno ' + t, 'n')).join('') : ''}${th('dia', `Dia ${brC(F.dia)}`, 'n')}${th('mes', 'Mês', 'n')}${th('acc', 'Acumulado', 'n')}${th('nd', 'Dias c/ chuva', 'n')}</tr></thead>
      <tbody>${rows.map(r => `<tr><td class="cod">${esc(r.cod)}</td><td><b>${esc(r.faz)}</b></td><td class="fr">${esc(r.frente.replace(/ · /g, ' '))}</td>${F.turno === 'todos' ? TURNOS.map(t => `<td class="n">${r.dia == null ? '<span class="nd">—</span>' : mm(r[t])}</td>`).join('') : ''}<td class="n"><span class="pill" style="background:${corMm(r.dia || 0)};color:${(r.dia || 0) > 10 ? '#fff' : 'var(--ink)'}">${r.dia == null ? '—' : mm(r.dia)}</span></td><td class="n">${mm(r.mes)}</td><td class="n acc"><span class="mb"><i style="width:${(r.acc / mxA * 100).toFixed(1)}%"></i></span>${mm(r.acc)}</td><td class="n">${r.nd}</td></tr>`).join('')}</tbody>`;
    el.querySelectorAll('th[data-k]').forEach(h => h.addEventListener('click', () => { ORD = { k: h.dataset.k, dir: ORD.k === h.dataset.k ? -ORD.dir : (['cod', 'faz', 'frente'].includes(h.dataset.k) ? 1 : -1) }; desenharTab(); }));
  };

  /* ---------- integração com o painel ---------- */
  let MONTADO = false, DADOS = null;
  const vazio = () => { const fl = $('.pv-filtros'); if (fl) fl.hidden = true; const r = raiz(); if (r) r.innerHTML = `<section class="section section--first" data-nome="Pluviométrico"><article class="card pv-vazio"><i class="fa-solid fa-cloud-rain"></i><h3>Ainda sem dados do pluviométrico</h3><p class="hint">Salve a planilha <b>Pluviométrico 2026.xlsm</b> na pasta Histórico e abra o painel com o usuário que publica: ela sobe para o GitHub junto com o resto.</p></article></section>`; };
  const naPagina = () => window.Layout && Layout.pagina && Layout.pagina() === 'pluvio';
  const mostrar = () => {
    if (!DADOS) { vazio(); if (naPagina()) Layout.secoes(); return; }
    const fl = $('.pv-filtros'); if (fl) fl.hidden = false;
    P.montar(DADOS); MONTADO = true;
    requestAnimationFrame(() => mover('#pvTurno', $('#pvTurno button.is-on'), true));
    if (naPagina()) { Layout.secoes(); }
  };
  // chamado depois do login: lê o pluviometrico.json publicado
  P.iniciar = async () => {
    try { const r = await fetch('pluviometrico.json', { cache: 'no-store' }); if (r.ok) DADOS = (await Acesso.readJson(await r.json())).data; } catch (e) { DADOS = null; }
    if (DADOS && (!Array.isArray(DADOS.reg) || !DADOS.locais)) DADOS = null;
    const antes = Layout.aoEntrar;
    Layout.aoEntrar = pg => { if (antes) antes(pg); if (pg.dataset.p !== 'pluvio') return; if (!MONTADO) mostrar(); else { desenharTL(true); } };
    if (naPagina()) mostrar();
  };
  // depois de sincronizar a pasta: troca os dados sem recarregar
  P.definir = data => { DADOS = data; MONTADO = false; if (naPagina()) mostrar(); };
  P.VERSAO = 2; // muda quando a leitura da planilha muda: força republicar
  P.dados = () => D;
  P.filtro = F;
  window.Pluvio = P;
})();
