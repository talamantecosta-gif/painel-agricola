/* =========================================================================
   Transporte · Master Driver Scania (relatórios semanais)
   Fonte: pasta Histórico\Master Driver Scania — um .xlsx por semana e por
   combustível ("AAAAMMDD_Semana.xlsx" diesel, "… Biogas.xlsx" biogás).
   Cada arquivo: aba Report, linha "Visão geral semanal: dd/mm/aaaa-dd/mm/aaaa",
   cabeçalho Equipamento | Hodômetro | Distância | Scania Driver Support | …
   Médias (iguais às do Master Driver):
     - consumo e ARLA = km ÷ litros (média harmônica pela distância);
     - "sem injeção", freadas e excesso de velocidade = ponderados pela distância;
     - Driver Support e marcha lenta = média dos equipamentos;
     - distância e CO₂ = soma.
   ========================================================================= */
(function () {
  'use strict';
  const P = {};
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9/%]+/g, ' ').trim();
  const brC = iso => iso.split('-').reverse().slice(0, 2).join('/');
  const semMov = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const soma = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);

  /* ---------- indicadores ---------- */
  // dir: +1 maior é melhor · -1 menor é melhor · 0 neutro
  const M = {
    cons: { nome: 'Consumo', un: t => (t === 'biogas' ? 'km/kg' : 'km/l'), dir: 1, dec: 2, ic: 'fa-gas-pump' },
    sds: { nome: 'Driver Support', un: () => '%', dir: 1, dec: 0, ic: 'fa-gauge-high' },
    coast: { nome: 'Sem injeção (embalo)', curto: 'Sem injeção', un: () => '%', dir: 1, dec: 1, ic: 'fa-wind' },
    idle: { nome: 'Marcha lenta', un: () => '%', dir: -1, dec: 1, ic: 'fa-hourglass-half' },
    brake: { nome: 'Freadas bruscas', un: () => '/100 km', dir: -1, dec: 2, ic: 'fa-triangle-exclamation' },
    km: { nome: 'Distância', un: () => 'km', dir: 0, dec: 0, ic: 'fa-road' },
    co2: { nome: 'CO₂', un: () => 't', dir: 0, dec: 1, ic: 'fa-smog' },
  };
  const unM = k => M[k].un(F.tipo);

  /* ---------- leitura de um relatório semanal ---------- */
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : (v == null || v === '' ? null : (Number.isFinite(+String(v).replace(/\./g, '').replace(',', '.')) ? +String(v).replace(/\./g, '').replace(',', '.') : null)));
  P.lerArquivo = (wb, X, arquivo = '') => {
    X = X || window.XLSX;
    const rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
    const pl = rows.find(r => r && r.some(c => /vis[aã]o geral semanal/i.test(String(c || ''))));
    const t = pl && String(pl.find(c => /vis[aã]o geral/i.test(String(c || '')))).match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
    if (!t) throw new Error('não achei a linha "Visão geral semanal: dd/mm/aaaa-dd/mm/aaaa"');
    const hi = rows.findIndex(r => r && norm(r[0]) === 'equipamento');
    if (hi < 0) throw new Error('não achei o cabeçalho "Equipamento"');
    const h = rows[hi].map(norm), ix = re => h.findIndex(x => re.test(x));
    const c = { odo: ix(/^hodometro/), km: ix(/^distancia/), sds: ix(/driver support/), coast: ix(/sem injecao/), idle: ix(/marcha lenta/), speed: ix(/excesso de velocidade/), brake: ix(/freadas/), cons: ix(/^consumo/), arla: ix(/^arla/), co2: ix(/dioxido|co2/) };
    const tipo = /km\/kg/.test(h[c.cons] || '') ? 'biogas' : 'diesel';
    const eq = [];
    rows.slice(hi + 1).forEach(r => {
      if (!r || r[0] == null) return;
      const id = String(r[0]).trim(); if (!id || /^m[eé]dia/i.test(id)) return;
      const km = num(r[c.km]); if (km == null) return; // equipamento sem dados na semana
      const o = { id, km };
      ['odo', 'sds', 'coast', 'idle', 'speed', 'brake', 'cons', 'arla', 'co2'].forEach(k => { if (c[k] >= 0) o[k] = num(r[c[k]]); });
      eq.push(o);
    });
    return { ini: `${t[3]}-${t[2]}-${t[1]}`, fim: `${t[6]}-${t[5]}-${t[4]}`, tipo, arquivo, eq };
  };
  // junta as semanas (uma por semana e combustível; arquivos repetidos ficam de fora)
  P.juntar = semanas => {
    const m = new Map();
    semanas.forEach(s => { const k = `${s.ini}|${s.tipo}`; if (!m.has(k) || s.eq.length > m.get(k).eq.length) m.set(k, s); });
    const lista = [...m.values()].sort((a, b) => a.ini.localeCompare(b.ini) || a.tipo.localeCompare(b.tipo));
    return { meta: { lidoEm: new Date().toISOString(), semanas: lista.length, ate: lista.length ? lista[lista.length - 1].fim : null }, semanas: lista };
  };

  /* ---------- agregação ---------- */
  const agg = linhas => {
    const L = linhas.filter(x => x.km > 0 || x.km === 0);
    if (!L.length) return null;
    const km = soma(L, x => x.km), wkm = L.filter(x => x.km > 0), W = soma(wkm, x => x.km) || 1;
    const harm = k => { const v = wkm.filter(x => x[k] > 0); const kk = soma(v, x => x.km); const lit = soma(v, x => x.km / x[k]); return lit ? kk / lit : null; };
    const pond = k => { const v = wkm.filter(x => Number.isFinite(x[k])); const kk = soma(v, x => x.km); return kk ? soma(v, x => x[k] * x.km) / kk : null; };
    const med = k => { const v = L.filter(x => Number.isFinite(x[k])); return v.length ? soma(v, x => x[k]) / v.length : null; };
    return { km, cons: harm('cons'), arla: harm('arla'), sds: med('sds'), idle: med('idle'), coast: pond('coast'), speed: pond('speed'), brake: pond('brake'), co2: soma(L, x => x.co2), litros: soma(wkm.filter(x => x.cons > 0), x => x.km / x.cons), n: new Set(L.map(x => x.id)).size, W };
  };

  /* ---------- estado ---------- */
  let D = null, SEM = [];
  const F = { tipo: 'diesel', de: null, ate: null, pre: '4', eq: '', met: 'cons' };
  const semanasTipo = () => D.semanas.filter(s => s.tipo === F.tipo);
  const noPer = s => s.ini >= F.de && s.ini <= F.ate;
  const linhasDe = ss => ss.flatMap(s => s.eq.map(e => ({ ...e, sem: s.ini })));
  const filtroEq = l => !F.eq || l.id === F.eq;
  const aplicarPre = pre => {
    const ss = semanasTipo(); if (!ss.length) return;
    const n = { 1: 1, 4: 4, 12: 12 }[pre];
    F.pre = pre; F.ate = ss[ss.length - 1].ini; F.de = n ? ss[Math.max(0, ss.length - n)].ini : ss[0].ini;
  };
  const periodoAnterior = () => {
    const ss = semanasTipo(), i0 = ss.findIndex(s => s.ini === F.de), i1 = ss.findIndex(s => s.ini === F.ate);
    const n = i1 - i0 + 1; if (i0 - n < 0) return [];
    return ss.slice(i0 - n, i0);
  };
  const fmtSem = s => `${brC(s.ini)} a ${brC(s.fim)}`;

  /* ---------- tooltip ---------- */
  const tip = (() => {
    let el = null;
    const get = () => el || (el = Object.assign(document.createElement('div'), { className: 'pv-tip sc-tip' }), document.body.appendChild(el), el);
    return {
      show(html, x, y) { const t = get(); t.innerHTML = html; t.classList.add('on'); const r = t.getBoundingClientRect(); let L = x + 14, T = y - r.height - 12; if (L + r.width > innerWidth - 8) L = x - r.width - 14; if (T < 8) T = y + 16; t.style.transform = `translate(${L}px,${T}px)`; },
      hide() { if (el) el.classList.remove('on'); },
    };
  })();
  const contar = (el, alvo, dec = 0, ms = 900) => {
    if (!el) return;
    if (semMov() || !Number.isFinite(alvo)) { el.textContent = nf(alvo, dec); return; }
    const de = parseFloat(el.dataset.v || '0'); el.dataset.v = alvo;
    cancelAnimationFrame(el._r); const t0 = performance.now();
    const f = t => { const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3); el.textContent = nf(de + (alvo - de) * e, dec); if (p < 1) el._r = requestAnimationFrame(f); };
    el._r = requestAnimationFrame(f);
  };

  /* ---------- cores (divergente: azul = melhor que a frota, vermelho = pior) ---------- */
  const BOM = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab'], RUIM = ['#fbd9cc', '#f4a688', '#e5673d', '#b8401c'], NEUTRO = '#EEF1EC';
  const corDesvio = (v, ref, k) => {
    if (!Number.isFinite(v) || !Number.isFinite(ref) || !M[k].dir || !ref) return NEUTRO;
    const d = (v - ref) / Math.abs(ref) * M[k].dir; const a = Math.abs(d);
    if (a < 0.03) return NEUTRO;
    const i = a < 0.08 ? 0 : a < 0.15 ? 1 : a < 0.3 ? 2 : 3;
    return d > 0 ? BOM[i] : RUIM[i];
  };
  const melhor = (a, b, k) => (M[k].dir >= 0 ? b - a : a - b);

  /* ---------- montagem ---------- */
  const raiz = () => $('#scConteudo');
  P.montar = data => {
    D = data;
    if (!semanasTipo().length) F.tipo = D.semanas.some(s => s.tipo === 'diesel') ? 'diesel' : 'biogas';
    aplicarPre(F.pre || '4');
    const r = raiz(); if (!r) return;
    r.innerHTML = `
      <div class="sc-kpis" id="scKpis"></div>
      <div class="sc-g2">
        <article class="card sc-leit"><span class="pv-eyebrow"><i class="fa-regular fa-lightbulb"></i>Leitura do período</span><p id="scLeitura"></p></article>
        <article class="card sc-evo">
          <header class="card__head"><div><h3>Evolução semanal</h3><p class="hint" id="scEvoH"></p></div></header>
          <div class="pv-seg sc-met" id="scMet" role="tablist" aria-label="Indicador"></div>
          <div id="scEvo" class="sc-chart"></div>
        </article>
      </div>
      <div class="sc-g2b">
        <article class="card"><header class="card__head"><div><h3>Ranking dos equipamentos</h3><p class="hint" id="scRankH"></p></div><div class="sc-leg"><span><i style="background:${BOM[2]}"></i>melhor que a frota</span><span><i style="background:${RUIM[2]}"></i>pior que a frota</span></div></header><div class="sc-rank" id="scRank"></div></article>
        <article class="card"><header class="card__head"><div><h3>Marcha lenta x consumo</h3><p class="hint">Cada bolha é um equipamento · tamanho = distância · clique para filtrar</p></div></header><div id="scDisp" class="sc-chart"></div></article>
      </div>
      <article class="card"><header class="card__head"><div><h3>Equipamentos</h3><p class="hint">Resultado do período · clique no cabeçalho para ordenar · clique na linha para filtrar</p></div></header><div class="table-wrap"><table class="pv-tab sc-tab" id="scTab"></table></div></article>`;
    eventos();
    atualizar(true);
  };

  /* ---------- filtros ---------- */
  const montarFiltros = () => {
    const ss = semanasTipo();
    const opt = (sel, val) => { const el = $(sel); if (!el) return; el.innerHTML = ss.map(s => `<option value="${s.ini}"${s.ini === val ? ' selected' : ''}>${fmtSem(s)}</option>`).join(''); };
    opt('#scDe', F.de); opt('#scAte', F.ate);
    const eqs = [...new Set(linhasDe(ss.filter(noPer)).map(l => l.id))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
    const se = $('#scEq'); if (se) se.innerHTML = '<option value="">Toda a frota</option>' + eqs.map(e => `<option value="${esc(e)}"${e === F.eq ? ' selected' : ''}>${esc(e)}</option>`).join('');
    $$('#scPre button').forEach(b => b.classList.toggle('is-on', b.dataset.pre === F.pre));
    $$('#scTipo button').forEach(b => b.classList.toggle('is-on', b.dataset.t === F.tipo));
    const lp = $('#scLimpar'); if (lp) lp.classList.toggle('is-on', !!(F.eq || F.pre !== '4'));
  };
  const moverInd = (seg, ja) => { const s = $(seg); if (!s) return; const b = s.querySelector('button.is-on'), ind = s.querySelector('.ind'); if (!b || !ind) return; if (ja) ind.style.transition = 'none'; ind.style.left = b.offsetLeft + 'px'; ind.style.width = b.offsetWidth + 'px'; if (ja) { void ind.offsetWidth; ind.style.transition = ''; } };
  let EV = false;
  const eventos = () => {
    if (EV) return; EV = true;
    const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
    on('#scTipo', 'click', e => { const b = e.target.closest('button[data-t]'); if (!b || b.dataset.t === F.tipo) return; F.tipo = b.dataset.t; F.eq = ''; aplicarPre(F.pre || '4'); atualizar(true); });
    on('#scPre', 'click', e => { const b = e.target.closest('button[data-pre]'); if (!b) return; aplicarPre(b.dataset.pre); atualizar(true); });
    const per = () => { let de = $('#scDe').value, at = $('#scAte').value; if (de > at) [de, at] = [at, de]; F.de = de; F.ate = at; F.pre = null; atualizar(true); };
    on('#scDe', 'change', per); on('#scAte', 'change', per);
    on('#scEq', 'change', e => { F.eq = e.target.value; atualizar(); });
    on('#scLimpar', 'click', () => { F.eq = ''; aplicarPre('4'); atualizar(true); });
    addEventListener('resize', () => { clearTimeout(EV._r); EV._r = setTimeout(() => { desenharEvo(false); desenharDisp(false); }, 140); });
  };

  /* ---------- atualização ---------- */
  let S = null; // estado calculado
  const atualizar = primeira => {
    montarFiltros();
    requestAnimationFrame(() => moverInd('#scTipo', primeira));
    const ss = semanasTipo().filter(noPer), ant = periodoAnterior();
    const L = linhasDe(ss), La = linhasDe(ant);
    const frota = agg(L), frotaAnt = agg(La);
    const sel = F.eq ? agg(L.filter(filtroEq)) : frota, selAnt = F.eq ? agg(La.filter(filtroEq)) : frotaAnt;
    const porEq = new Map(); L.forEach(l => { const a = porEq.get(l.id) || porEq.set(l.id, []).get(l.id); a.push(l); });
    const eqs = [...porEq].map(([id, ls]) => ({ id, ...agg(ls), sem: ls.length }));
    const semanal = ss.map(s => ({ s, frota: agg(s.eq), eq: F.eq ? agg(s.eq.filter(filtroEq)) : null }));
    S = { ss, ant, frota, frotaAnt, sel, selAnt, eqs, semanal, porEq };
    const pg = $('#scPgData'); if (pg) pg.textContent = ss.length ? `Semanas de ${brC(ss[0].ini)} a ${brC(ss[ss.length - 1].fim)} · ${F.tipo === 'biogas' ? 'frota biogás' : 'frota diesel'}` : 'Sem semanas no período';
    desenharKpis();
    desenharLeitura();
    desenharMet();
    desenharEvo(primeira);
    desenharRank();
    desenharDisp(primeira);
    desenharTab();
  };

  /* ---------- cards ---------- */
  const delta = (v, a, k) => {
    if (!Number.isFinite(v) || !Number.isFinite(a) || !S.ant.length) return '<span class="sc-d">sem período anterior</span>';
    const d = v - a, dec = k === 'km' ? 0 : M[k].dec, bom = M[k].dir ? d * M[k].dir > 0 : null;
    if (Math.abs(d) < Math.pow(10, -dec) / 2) return `<span class="sc-d">= período anterior</span>`;
    return `<span class="sc-d ${bom == null ? '' : bom ? 'is-bom' : 'is-ruim'}"><i class="fa-solid fa-caret-${d > 0 ? 'up' : 'down'}"></i>${nf(Math.abs(d), dec)}${k === 'km' ? ' km' : ''} vs ${S.ant.length} sem. anteriores</span>`;
  };
  const desenharKpis = () => {
    const el = $('#scKpis'), x = S.sel, a = S.selAnt || {};
    if (!x) { el.innerHTML = '<p class="hint">Sem dados no período.</p>'; return; }
    const card = (k, v, sub, extra = '') => `<article class="k sc-k" data-k="${k}"><div class="k__t">${M[k].nome}<i class="fa-solid ${M[k].ic}"></i></div><div class="k__v"><b data-v="0">0</b><small>${unM(k)}</small></div><div class="k__s">${sub}</div>${extra}${delta(v, a[k], k)}</article>`;
    el.innerHTML = [
      card('km', x.km, `${F.eq ? `equipamento ${esc(F.eq)}` : `${x.n} equipamentos`} · ${nf(x.km / Math.max(1, S.ss.length), 0)} km/semana`),
      card('cons', x.cons, `${nf(x.litros, 0)} ${F.tipo === 'biogas' ? 'kg' : 'litros'} no período${F.tipo === 'diesel' && x.arla ? ` · ARLA ${nf(x.arla, 1)} km/l` : ''}`),
      card('sds', x.sds, 'nota de condução do Scania Driver Support', `<div class="sc-bar"><i style="--w:${Math.min(100, x.sds || 0)}%"></i></div>`),
      card('idle', x.idle, 'tempo com motor ligado parado', `<div class="sc-bar is-ruim"><i style="--w:${Math.min(100, x.idle || 0)}%"></i></div>`),
      card('coast', x.coast, 'rodando engrenado sem injetar', `<div class="sc-bar"><i style="--w:${Math.min(100, x.coast || 0)}%"></i></div>`),
      card('brake', x.brake, `${nf((x.brake || 0) * x.km / 100, 0)} freadas no período`),
    ].join('');
    const vals = { km: x.km, cons: x.cons, sds: x.sds, idle: x.idle, coast: x.coast, brake: x.brake };
    el.querySelectorAll('.sc-k').forEach((c, i) => { const k = c.dataset.k; c.style.setProperty('--i', i); contar(c.querySelector('.k__v b'), vals[k], k === 'km' ? 0 : M[k].dec); c.addEventListener('click', () => { F.met = k; atualizar(); }); c.classList.toggle('is-sel', k === F.met); });
    requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll('.sc-bar i').forEach(i => i.classList.add('on'))));
  };

  /* ---------- leitura ---------- */
  const desenharLeitura = () => {
    const el = $('#scLeitura'), x = S.sel, f = S.frota; if (!x) { el.textContent = ''; return; }
    const un = unM('cons');
    const ok = S.eqs.filter(e => e.km >= 200 && Number.isFinite(e.cons));
    const best = [...ok].sort((a, b) => b.cons - a.cons).slice(0, 2), worst = [...ok].sort((a, b) => a.cons - b.cons).slice(0, 2);
    const idleW = [...S.eqs].filter(e => Number.isFinite(e.idle)).sort((a, b) => b.idle - a.idle).slice(0, 2);
    const dC = S.frotaAnt && Number.isFinite(S.frotaAnt.cons) ? x.cons - (F.eq ? (S.selAnt || {}).cons : S.frotaAnt.cons) : null;
    const per = S.ss.length === 1 ? `na semana ${fmtSem(S.ss[0])}` : `nas ${S.ss.length} semanas de ${brC(S.ss[0].ini)} a ${brC(S.ss[S.ss.length - 1].fim)}`;
    el.innerHTML = F.eq
      ? `O <b>${esc(F.eq)}</b> rodou <b>${nf(x.km, 0)} km</b> ${per}, com consumo de <b>${nf(x.cons, 2)} ${un}</b> (frota: ${nf(f.cons, 2)}), Driver Support de <b>${nf(x.sds, 0)}%</b> (frota: ${nf(f.sds, 0)}%) e marcha lenta de <b>${nf(x.idle, 1)}%</b> (frota: ${nf(f.idle, 1)}%).${dC != null ? ` Em relação ao período anterior, o consumo ${Math.abs(dC) < 0.005 ? 'ficou igual' : dC > 0 ? `melhorou ${nf(dC, 2)} ${un}` : `piorou ${nf(-dC, 2)} ${un}`}.` : ''}`
      : `A frota ${F.tipo === 'biogas' ? 'biogás' : 'diesel'} rodou <b>${nf(x.km, 0)} km</b> ${per}, com consumo médio de <b>${nf(x.cons, 2)} ${un}</b>${dC != null ? ` (${Math.abs(dC) < 0.005 ? 'igual ao' : dC > 0 ? `<span class="is-bom">▲ ${nf(dC, 2)}</span> sobre o` : `<span class="is-ruim">▼ ${nf(-dC, 2)}</span> sobre o`} período anterior)` : ''}. ${best.length ? `Melhores consumos: <b>${best.map(e => `${esc(e.id)} (${nf(e.cons, 2)})`).join('</b> e <b>')}</b>; piores: <b>${worst.map(e => `${esc(e.id)} (${nf(e.cons, 2)})`).join('</b> e <b>')}</b>. ` : ''}${idleW.length ? `Mais marcha lenta: <b>${idleW.map(e => `${esc(e.id)} (${nf(e.idle, 0)}%)`).join('</b> e <b>')}</b> — motor ligado parado gasta ${F.tipo === 'biogas' ? 'gás' : 'diesel'} sem rodar.` : ''}`;
  };

  /* ---------- evolução semanal (SVG) ---------- */
  const METS = ['cons', 'sds', 'idle', 'coast', 'brake', 'km'];
  const desenharMet = () => {
    const el = $('#scMet'); if (!el) return;
    el.innerHTML = '<span class="ind"></span>' + METS.map(k => `<button type="button" data-k="${k}" class="${k === F.met ? 'is-on' : ''}">${M[k].curto || M[k].nome}</button>`).join('');
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { F.met = b.dataset.k; atualizar(); }));
    requestAnimationFrame(() => moverInd('#scMet', true));
  };
  const nice = v => { if (!(v > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(m => m * p).find(m => m >= v) || v; };
  const desenharEvo = anima => {
    const box = $('#scEvo'); if (!box || !S) return;
    const k = F.met, ser = S.semanal.map(w => ({ s: w.s, f: w.frota ? w.frota[k] : null, e: w.eq ? w.eq[k] : null }));
    $('#scEvoH').textContent = `${M[k].nome} (${unM(k)}) por semana · ${F.eq ? `${F.eq} x média da frota` : 'frota'} · tracejado = média do período`;
    if (!ser.length) { box.innerHTML = ''; return; }
    const W = Math.max(320, box.clientWidth), H = 230, m = { l: 44, r: 70, t: 26, b: 30 };
    const vals = ser.flatMap(x => [x.f, x.e]).filter(Number.isFinite);
    const vmax = Math.max(...vals), vmin = Math.min(...vals);
    let y0 = k === 'km' || k === 'brake' ? 0 : Math.max(0, vmin - (vmax - vmin) * .35), y1 = vmax + (vmax - vmin || vmax || 1) * .18;
    if (y1 - y0 < 1e-9) y1 = y0 + 1;
    const n = ser.length, cw = (W - m.l - m.r) / Math.max(1, n), x = i => m.l + cw * i + cw / 2, y = v => m.t + (H - m.t - m.b) * (1 - (v - y0) / (y1 - y0));
    const ticks = [0, .5, 1].map(f => y0 + (y1 - y0) * f), dec = k === 'km' ? 0 : M[k].dec;
    const media = S.sel ? S.sel[k] : null, mediaF = F.eq && S.frota ? S.frota[k] : null;
    const kmMode = k === 'km';
    const lin = key => ser.map((p, i) => Number.isFinite(p[key]) ? `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}` : null).filter(Boolean);
    const principal = F.eq ? 'e' : 'f';
    const pts = lin(principal), ptsF = F.eq ? lin('f') : [];
    // rótulos seletivos: último, maior e menor
    const idxs = ser.map((p, i) => [p[principal], i]).filter(a => Number.isFinite(a[0]));
    const lab = new Set(); if (idxs.length) { lab.add(idxs[idxs.length - 1][1]); lab.add(idxs.reduce((a, b) => (b[0] > a[0] ? b : a))[1]); lab.add(idxs.reduce((a, b) => (b[0] < a[0] ? b : a))[1]); }
    const passo = Math.ceil(46 / cw);
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="pv-svg sc-svg${anima && !semMov() ? ' cresce' : ''}">
      <defs><linearGradient id="scG" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2E6B3A" stop-opacity=".22"/><stop offset="1" stop-color="#2E6B3A" stop-opacity="0"/></linearGradient></defs>
      ${ticks.map(t => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" class="gr"/><text x="${m.l - 8}" y="${y(t) + 4}" class="ax" text-anchor="end">${nf(t, kmMode ? 0 : Math.min(2, dec))}</text>`).join('')}
      ${ser.map((p, i) => (i % passo === 0 || i === n - 1) ? `<text class="ax" x="${x(i)}" y="${H - 8}" text-anchor="middle">${brC(p.s.ini)}</text>` : '').join('')}
      ${kmMode ? ser.map((p, i) => { const v = p[principal]; if (!Number.isFinite(v)) return ''; const bw = Math.max(4, Math.min(30, cw * .6)), h = y(0) - y(v); return `<rect class="sc-bar-v" style="--i:${i}" x="${x(i) - bw / 2}" y="${y(v)}" width="${bw}" height="${Math.max(0, h)}" rx="4"/>`; }).join('')
        : `${pts.length > 1 ? `<path class="sc-area" d="M${pts[0].split(',')[0]},${y(y0)} L${pts.join(' L')} L${pts[pts.length - 1].split(',')[0]},${y(y0)} Z"/>` : ''}
           ${ptsF.length ? `<polyline class="sc-ln-f" points="${ptsF.join(' ')}"/>` : ''}
           <polyline class="sc-ln${anima ? ' draw' : ''}" points="${pts.join(' ')}"/>
           ${ser.map((p, i) => Number.isFinite(p[principal]) ? `<circle class="sc-pt" cx="${x(i)}" cy="${y(p[principal])}" r="${lab.has(i) ? 4.5 : 3}"/>` : '').join('')}`}
      ${ser.map((p, i) => lab.has(i) && Number.isFinite(p[principal]) ? `<text class="sc-vl" x="${x(i)}" y="${y(p[principal]) - 10}" text-anchor="middle">${nf(p[principal], dec)}</text>` : '').join('')}
      ${Number.isFinite(media) && !kmMode ? `<line class="sc-med" x1="${m.l}" x2="${W - m.r}" y1="${y(media)}" y2="${y(media)}"/><g transform="translate(${W - m.r + 6},${y(media) - 10})"><rect class="sc-med-b" width="62" height="20" rx="10"/><text x="31" y="14" text-anchor="middle" class="sc-med-t">${nf(media, dec)}</text></g>` : ''}
      ${Number.isFinite(mediaF) && !kmMode ? `<text class="ax" x="${W - m.r + 6}" y="${y(mediaF) + 16}">frota ${nf(mediaF, dec)}</text>` : ''}
      <line class="sc-cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" style="opacity:0"/>
      <rect class="hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}"/>
    </svg>`;
    const svg = box.querySelector('svg'), hit = svg.querySelector('.hit'), cr = svg.querySelector('.sc-cross');
    hit.addEventListener('pointermove', e => {
      const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width), i = Math.max(0, Math.min(n - 1, Math.floor((px - m.l) / cw))), p = ser[i];
      cr.setAttribute('x1', x(i)); cr.setAttribute('x2', x(i)); cr.style.opacity = 1;
      tip.show(`<b>Semana ${fmtSem(p.s)}</b><small>${M[k].nome}</small>${F.eq ? `<span class="pv-tt">${esc(F.eq)}<b>${nf(p.e, dec)} ${unM(k)}</b></span>` : ''}<span class="pv-tt${F.eq ? '' : ' tot'}">Frota<b>${nf(p.f, dec)} ${unM(k)}</b></span>`, e.clientX, e.clientY);
    });
    hit.addEventListener('pointerleave', () => { tip.hide(); cr.style.opacity = 0; });
  };

  /* ---------- ranking ---------- */
  const desenharRank = () => {
    const el = $('#scRank'); if (!el) return;
    const k = F.met === 'km' ? 'cons' : F.met, ref = S.frota ? S.frota[k] : null, dec = M[k].dec;
    $('#scRankH').textContent = `${M[k].nome} (${unM(k)}) no período · média da frota: ${nf(ref, dec)}${F.met === 'km' ? ' · para distância, o ranking mostra o consumo' : ''} · clique para filtrar`;
    const L = S.eqs.filter(e => Number.isFinite(e[k])).sort((a, b) => melhor(a[k], b[k], k));
    const mx = Math.max(...L.map(e => e[k]), ref || 0) * 1.05 || 1;
    el.innerHTML = `<div class="sc-rank__ref" style="--x:${(ref / mx * 100).toFixed(2)}%"><span>frota ${nf(ref, dec)}</span></div>` + L.map((e, i) => `<div class="sc-rank__l${e.id === F.eq ? ' is-sel' : ''}" data-id="${esc(e.id)}" style="--i:${i}"><span class="n">${i + 1}</span><span class="id">${esc(e.id)}</span><span class="trk"><i style="--w:${(e[k] / mx * 100).toFixed(2)}%;background:${corDesvio(e[k], ref, k) === NEUTRO ? '#B9C4BC' : corDesvio(e[k], ref, k)}"></i></span><b>${nf(e[k], dec)}</b></div>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll('.trk i').forEach(i => i.classList.add('on'))));
    el.querySelectorAll('.sc-rank__l').forEach(r => {
      const e = L.find(x => x.id === r.dataset.id);
      r.addEventListener('click', () => { F.eq = F.eq === e.id ? '' : e.id; atualizar(); });
      r.addEventListener('mousemove', ev => tip.show(`<b>${esc(e.id)}</b><small>${nf(e.km, 0)} km em ${e.sem} ${e.sem === 1 ? 'semana' : 'semanas'}</small><span class="pv-tt tot">${M[k].nome}<b>${nf(e[k], dec)} ${unM(k)}</b></span><span class="pv-tt">Frota<b>${nf(ref, dec)} ${unM(k)}</b></span>`, ev.clientX, ev.clientY));
      r.addEventListener('mouseleave', tip.hide);
    });
  };

  /* ---------- dispersão marcha lenta x consumo ---------- */
  const desenharDisp = anima => {
    const box = $('#scDisp'); if (!box || !S) return;
    const L = S.eqs.filter(e => Number.isFinite(e.idle) && Number.isFinite(e.cons) && e.km > 0);
    if (!L.length) { box.innerHTML = '<p class="hint">Sem dados.</p>'; return; }
    const W = Math.max(300, box.clientWidth), H = 330, m = { l: 46, r: 16, t: 16, b: 40 };
    const xs = L.map(e => e.idle), ys = L.map(e => e.cons), kmx = Math.max(...L.map(e => e.km));
    const x0 = 0, x1 = nice(Math.max(...xs) * 1.08), yy0 = Math.max(0, Math.min(...ys) * .85), yy1 = Math.max(...ys) * 1.08;
    const X = v => m.l + (W - m.l - m.r) * (v - x0) / (x1 - x0), Y = v => m.t + (H - m.t - m.b) * (1 - (v - yy0) / (yy1 - yy0));
    const R = km => 5 + 13 * Math.sqrt(km / kmx);
    const fx = S.frota, un = unM('cons');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="pv-svg sc-svg">
      ${[0, .25, .5, .75, 1].map(f => { const v = x0 + (x1 - x0) * f; return `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${H - m.b}" class="gr"/><text class="ax" x="${X(v)}" y="${H - m.b + 16}" text-anchor="middle">${nf(v, 0)}%</text>`; }).join('')}
      ${[0, .5, 1].map(f => { const v = yy0 + (yy1 - yy0) * f; return `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="gr"/><text class="ax" x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${nf(v, 1)}</text>`; }).join('')}
      <text class="ax sc-axt" x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle">marcha lenta (%) →</text>
      <text class="ax sc-axt" transform="translate(12,${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">consumo (${un}) →</text>
      ${fx ? `<line class="sc-med" x1="${X(fx.idle)}" x2="${X(fx.idle)}" y1="${m.t}" y2="${H - m.b}"/><line class="sc-med" x1="${m.l}" x2="${W - m.r}" y1="${Y(fx.cons)}" y2="${Y(fx.cons)}"/>` : ''}
      ${L.sort((a, b) => b.km - a.km).map((e, i) => { const bom = e.cons >= fx.cons && e.idle <= fx.idle, ruim = e.cons < fx.cons && e.idle > fx.idle; return `<circle class="sc-bol${e.id === F.eq ? ' is-sel' : ''}${anima && !semMov() ? ' entra' : ''}" style="--i:${i}" data-id="${esc(e.id)}" cx="${X(e.idle)}" cy="${Y(e.cons)}" r="${R(e.km)}" fill="${bom ? BOM[2] : ruim ? RUIM[2] : '#9AA79E'}"/>`; }).join('')}
      ${L.filter(e => e.id === F.eq || e.idle > fx.idle * 1.8 || e.cons > fx.cons * 1.4).map(e => `<text class="sc-bl" x="${X(e.idle) + R(e.km) + 3}" y="${Y(e.cons) + 4}">${esc(e.id)}</text>`).join('')}
    </svg>`;
    box.querySelectorAll('.sc-bol').forEach(c => {
      const e = L.find(x => x.id === c.dataset.id);
      c.addEventListener('mousemove', ev => tip.show(`<b>${esc(e.id)}</b><small>${nf(e.km, 0)} km no período</small><span class="pv-tt">Marcha lenta<b>${nf(e.idle, 1)}%</b></span><span class="pv-tt">Consumo<b>${nf(e.cons, 2)} ${un}</b></span><span class="pv-tt">Driver Support<b>${nf(e.sds, 0)}%</b></span>`, ev.clientX, ev.clientY));
      c.addEventListener('mouseleave', tip.hide);
      c.addEventListener('click', () => { F.eq = F.eq === e.id ? '' : e.id; atualizar(); });
    });
  };

  /* ---------- tabela ---------- */
  let ORD = { k: 'cons', dir: -1 };
  const desenharTab = () => {
    const el = $('#scTab'); if (!el) return;
    const cols = [['id', 'Equipamento'], ['sem', 'Semanas'], ['km', 'Distância (km)'], ['cons', `Consumo (${unM('cons')})`], ...(F.tipo === 'diesel' ? [['arla', 'ARLA (km/l)']] : []), ['sds', 'Driver Support'], ['coast', 'Sem injeção'], ['idle', 'Marcha lenta'], ['brake', 'Freadas /100 km'], ['co2', 'CO₂ (t)'], ['trend', `Tendência · ${M[F.met].curto || M[F.met].nome}`]];
    const ref = S.frota || {};
    const rows = [...S.eqs].sort((a, b) => (ORD.k === 'id' ? a.id.localeCompare(b.id, 'pt-BR', { numeric: true }) : ((a[ORD.k] ?? -1) - (b[ORD.k] ?? -1))) * ORD.dir);
    const spark = id => {
      const k = F.met, pts = S.ss.map(s => { const e = s.eq.find(x => x.id === id); return e ? e[k] : null; });
      const v = pts.filter(Number.isFinite); if (v.length < 2) return '';
      const mn = Math.min(...v), mx = Math.max(...v) || 1, w = 90, h = 22;
      const p = pts.map((y, i) => Number.isFinite(y) ? `${(i / (pts.length - 1) * w).toFixed(1)},${(h - 2 - (y - mn) / ((mx - mn) || 1) * (h - 4)).toFixed(1)}` : null).filter(Boolean).join(' ');
      return `<svg class="sc-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${p}"/></svg>`;
    };
    const cel = (r, k) => {
      if (k === 'id') return `<td><b>${esc(r.id)}</b></td>`;
      if (k === 'sem') return `<td class="n">${r.sem}</td>`;
      if (k === 'trend') return `<td>${spark(r.id)}</td>`;
      const dec = k === 'km' ? 0 : k === 'co2' ? 1 : k === 'arla' ? 1 : M[k] ? M[k].dec : 1;
      const c = M[k] && M[k].dir ? corDesvio(r[k], ref[k], k) : null;
      return `<td class="n">${c && c !== NEUTRO ? `<span class="pill" style="background:${c};color:${BOM.slice(2).includes(c) || RUIM.slice(2).includes(c) ? '#fff' : 'var(--ink)'}">${nf(r[k], dec)}</span>` : nf(r[k], dec)}</td>`;
    };
    el.innerHTML = `<thead><tr>${cols.map(([k, t]) => `<th data-k="${k}" class="${k === 'id' || k === 'trend' ? '' : 'n'}${ORD.k === k ? ' ord' + (ORD.dir > 0 ? ' asc' : ' desc') : ''}">${t}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.id === F.eq ? 'is-sel' : ''}" data-id="${esc(r.id)}">${cols.map(([k]) => cel(r, k)).join('')}</tr>`).join('')}</tbody>
      <tfoot><tr><td><b>Frota</b></td><td class="n">${S.ss.length}</td>${cols.slice(2, -1).map(([k]) => `<td class="n"><b>${nf(ref[k], k === 'km' ? 0 : k === 'co2' || k === 'arla' ? 1 : M[k] ? M[k].dec : 1)}</b></td>`).join('')}<td></td></tr></tfoot>`;
    el.querySelectorAll('th[data-k]').forEach(h => h.addEventListener('click', () => { const k = h.dataset.k; if (k === 'trend') return; ORD = { k, dir: ORD.k === k ? -ORD.dir : (k === 'id' ? 1 : -1) }; desenharTab(); }));
    el.querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => { F.eq = F.eq === tr.dataset.id ? '' : tr.dataset.id; atualizar(); }));
  };

  /* ---------- integração com o painel ---------- */
  let MONT = false, DADOS = null;
  const naPagina = () => window.Layout && Layout.pagina && Layout.pagina() === 'transporte';
  const mostrar = () => {
    const sec = $('#scania'); if (!sec) return;
    if (!DADOS || !DADOS.semanas || !DADOS.semanas.length) { sec.hidden = true; return; }
    sec.hidden = false; P.montar(DADOS); MONT = true;
    if (naPagina()) Layout.secoes();
  };
  // depois do login: lê o historico/scania.json publicado
  P.iniciar = async () => {
    try { const r = await fetch('historico/scania.json', { cache: 'no-store' }); if (r.ok) DADOS = (await Acesso.readJson(await r.json())).data; } catch (e) { DADOS = null; }
    const antes = Layout.aoEntrar;
    Layout.aoEntrar = pg => { if (antes) antes(pg); if (pg.dataset.p !== 'transporte') return; if (!MONT) mostrar(); else { desenharEvo(true); desenharDisp(true); } };
    if (naPagina()) mostrar(); else { const sec = $('#scania'); if (sec && !(DADOS && DADOS.semanas && DADOS.semanas.length)) sec.hidden = true; }
  };
  // depois de sincronizar a pasta
  P.definir = data => { DADOS = data; MONT = false; if (naPagina()) mostrar(); };

  P.filtro = F;
  P.VERSAO = 1;
  window.Scania = P;
})();
