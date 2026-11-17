/* =========================================================================
   Histórico · Análise de Pisoteio (boletim FO.SA.10, PDF semanal)

   Na pasta: "Boletim Análise de Pisoteio DD-MM-AAAA.pdf" (um por semana).
   A sincronização lê cada boletim no navegador (pdf.js) e guarda todos em
   historico/pisoteio.json (criptografado), um registro por data:
     { data, arquivo, semana:[[nome, aval, pisados, %]], mes, safra, fazendas }
   Cada tabela tem a linha "Total Geral". Nos últimos 7 dias, as fazendas vêm
   logo abaixo da frente a que pertencem.
   ========================================================================= */
(function () {
  'use strict';
  const P = { VERSAO: 1 };
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pc = v => nf(v, 2) + '%';
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const br = iso => (iso && ISO.test(iso) ? iso.split('-').reverse().join('/') : '—');
  const brC = iso => (iso && ISO.test(iso) ? iso.split('-').reverse().slice(0, 2).join('/') : '—');
  const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const ordN = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true });
  const PIOR = '#b8401c', MELHOR = '#1c5cab', NEUTRO = '#9AA79E', BARRA = '#C2551F';
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  /* ---------------------------------------------------------------- leitura do PDF */
  const NUM = /^-?\d+(?:[.,]\d+)?$/, PCT = /^-?\d+(?:,\d+)?\s*%$/;
  const num = s => parseFloat(String(s).replace(/\s|%/g, '').replace(',', '.'));
  const chave = t => (/fazenda/i.test(t) ? 'fazendas' : /m[eê]s/i.test(t) ? 'mes' : /[uú]ltimos/i.test(t) ? 'semana' : /safra/i.test(t) ? 'safra' : null);

  /** itens = [{ s, x, y, w, page }] (pdf.js). Devolve { semana, mes, safra, fazendas }. */
  P.parseItens = itens => {
    const out = {};
    const pags = [...new Set(itens.map(i => i.page))];
    for (const pg of pags) {
      const it = itens.filter(i => i.page === pg);
      const heads = it.filter(i => /^nome da fazenda$/i.test(i.s.trim())).sort((a, b) => a.x - b.x);
      let xMin = -Infinity;
      heads.forEach(h => {
        const pctH = it.filter(i => Math.abs(i.y - h.y) < 2 && i.x > h.x && /%\s*pisoteio/i.test(i.s)).sort((a, b) => a.x - b.x)[0];
        if (!pctH) return;
        const xMax = pctH.x + pctH.w + 15, x0 = xMin;
        xMin = xMax;
        const dentro = i => i.x + (i.w || 0) / 2 > x0 && i.x < xMax;
        const tit = it.filter(i => dentro(i) && i.y > h.y && i.y < h.y + 25 && chave(i.s)).sort((a, b) => a.y - b.y)[0];
        const k = tit && chave(tit.s);
        if (!k || out[k]) return;
        // linhas da tabela, de cima para baixo, até o Total Geral
        const corpo = it.filter(i => dentro(i) && i.y < h.y - 1).sort((a, b) => b.y - a.y || a.x - b.x);
        const linhas = [];
        corpo.forEach(i => { const l = linhas.find(x => Math.abs(x.y - i.y) < 1.6); if (l) l.its.push(i); else linhas.push({ y: i.y, its: [i] }); });
        const rows = [];
        for (const l of linhas) {
          const t = l.its.sort((a, b) => a.x - b.x).map(i => i.s.trim()).filter(Boolean);
          const ip = t.findIndex(s => PCT.test(s));
          if (ip < 3 || !NUM.test(t[ip - 1]) || !NUM.test(t[ip - 2])) continue;
          const nome = t.slice(0, ip - 2).join(' ').replace(/\s+/g, ' ').trim();
          if (!nome || NUM.test(nome)) continue;
          rows.push([nome, num(t[ip - 2]), num(t[ip - 1]), num(t[ip])]);
          if (/^total geral$/i.test(nome)) break;
        }
        if (rows.length) out[k] = rows;
      });
    }
    return out;
  };

  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  P.ehBoletim = nome => /\.pdf$/i.test(nome) && /pisoteio/i.test(nome);
  const dataDoNome = nome => { const m = String(nome).match(/(\d{2})[-_.](\d{2})[-_.](\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
  const dataPdf = s => { const m = String(s || '').match(/D:(\d{4})(\d{2})(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

  /** Lê um arquivo PDF (File) do boletim. */
  P.lerPdf = async file => {
    if (!window.pdfjsLib) throw new Error('a biblioteca pdf.js não carregou (verifique a internet)');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const itens = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      tc.items.forEach(i => { if (i.str && i.str.trim()) itens.push({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0, page: p }); });
    }
    const info = (await pdf.getMetadata().catch(() => null))?.info || {};
    const T = P.parseItens(itens);
    if (!T.semana && !T.safra) throw new Error('não encontrei as tabelas do boletim de pisoteio');
    const data = dataDoNome(file.name) || dataPdf(info.CreationDate) || new Date(file.lastModified).toISOString().slice(0, 10);
    return { data, arquivo: file.name, ...T };
  };

  /** Junta boletins novos aos já publicados (a mesma data é substituída). */
  P.juntar = (base, novos) => {
    const m = new Map(((base && base.boletins) || []).map(b => [b.data, b]));
    novos.forEach(b => m.set(b.data, b));
    return { versao: P.VERSAO, atualizado: new Date().toISOString(), boletins: [...m.values()].sort((a, b) => a.data.localeCompare(b.data)) };
  };

  /* ---------------------------------------------------------------- dados */
  let D = null, SEL = null, MONT = false;
  const F = { per: 'semana', met: 'pct', base: null, tab: 'semana', abertas: new Set() };

  const nome = raw => {
    const m = String(raw).match(/^(Frente\s*\d+)\s*\((.+)\)$/i);
    if (!m) return { n: String(raw).replace(/\s+/g, ' ').trim(), s: '' };
    return { n: m[1].replace(/\s+/g, ' '), s: m[2].replace(/(Frente \d+) Cana Exceção/i, '$1 · cana exceção') };
  };
  const total = rows => { const t = (rows || []).find(r => /^total geral$/i.test(r[0])); return t ? { av: t[1], pi: t[2], pct: t[3] } : null; };
  const frentes = rows => (rows || []).filter(r => !/^total geral$/i.test(r[0])).map(r => ({ ...nome(r[0]), av: r[1], pi: r[2], pct: r[3] }));
  const semanaArv = rows => {
    const L = [];
    (rows || []).forEach(r => {
      if (/^total geral$/i.test(r[0])) return;
      if (/^frente\b/i.test(r[0])) L.push({ ...nome(r[0]), av: r[1], pi: r[2], pct: r[3], faz: [] });
      else if (L.length) L[L.length - 1].faz.push({ n: r[0], av: r[1], pi: r[2], pct: r[3] });
    });
    return L;
  };
  const bols = () => (D && Array.isArray(D.boletins) ? D.boletins : []);
  const anterior = b => { const L = bols(), i = L.findIndex(x => x.data === b.data); return i > 0 ? L[i - 1] : null; };
  const iguais = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

  /** Mês: usa a tabela do PDF; se ela veio igual à safra, calcula pela diferença
      entre o acumulado deste boletim e o do último boletim do mês anterior. */
  const mesDe = b => {
    const mesNome = MESES[Number(b.data.slice(5, 7)) - 1];
    if (b.mes && !iguais(b.mes, b.safra)) return { rows: frentes(b.mes), t: total(b.mes), rot: `mês de ${mesNome}`, nota: '' };
    const ini = b.data.slice(0, 8) + '01';
    const ref = bols().filter(x => x.data < ini && x.safra).pop();
    if (ref) {
      const pS = new Map(frentes(ref.safra).map(f => [f.n, f]));
      const rows = frentes(b.safra).map(f => { const p = pS.get(f.n) || { av: 0, pi: 0 }; const av = Math.max(0, f.av - p.av), pi = Math.max(0, f.pi - p.pi); return { ...f, av, pi, pct: av ? pi / av * 100 : 0 }; }).filter(f => f.av > 0);
      const av = rows.reduce((s, f) => s + f.av, 0), pi = rows.reduce((s, f) => s + f.pi, 0);
      return { rows, t: { av, pi, pct: av ? pi / av * 100 : 0 }, rot: `mês de ${mesNome}`, nota: `Calculado pela diferença do acumulado da safra entre ${br(ref.data)} e ${br(b.data)} (a tabela do mês no PDF veio igual à da safra).` };
    }
    return { rows: frentes(b.mes || b.safra), t: total(b.mes || b.safra), rot: `mês de ${mesNome}`, nota: 'No PDF, a tabela Frente - Mês veio igual à Total Safra (o filtro do mês não foi aplicado na planilha). Com um boletim do mês anterior salvo, o painel passa a calcular o mês sozinho.' };
  };
  const periodo = (b, per) => {
    if (per === 'semana') return { rows: semanaArv(b.semana), t: total(b.semana), rot: `últimos 7 dias até ${brC(b.data)}`, nota: '' };
    if (per === 'mes') return mesDe(b);
    return { rows: frentes(b.safra), t: total(b.safra), rot: 'safra', nota: '' };
  };

  /* ---------------------------------------------------------------- tela */
  const semMov = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const contar = el => {
    const alvo = Number(el.dataset.v), dec = Number(el.dataset.d) || 0;
    cancelAnimationFrame(el._raf);
    if (semMov() || !Number.isFinite(alvo)) { el.textContent = nf(alvo, dec); return; }
    const t0 = performance.now(), ms = 850;
    const passo = t => { const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3); el.textContent = nf(alvo * e, dec); if (p < 1) el._raf = requestAnimationFrame(passo); };
    el._raf = requestAnimationFrame(passo);
  };
  const cor = v => (v >= 10 ? ['#C2551F', '#fff'] : v >= 5 ? ['#EDB27A', '#5A2C0C'] : v >= 2 ? ['#F6DDBB', '#6B4512'] : v > 0 ? ['#FBF0E2', '#6B4E12'] : ['#F1F4EF', '#6E7C72']);
  const celPct = v => { const [c, t] = cor(v); return `<span class="ps-pc" style="background:${c};color:${t}">${pc(v)}</span>`; };
  const dif = (d, un = ' p.p.') => `${d > 0 ? '+' : d < 0 ? '−' : ''}${nf(Math.abs(d), 2)}${un}`;
  const corD = d => (d > 0.05 ? PIOR : d < -0.05 ? MELHOR : NEUTRO);
  const seg = (id, itens, atual, extra = '') => `<div class="pv-seg ps-seg" id="${id}" role="group"${extra}><span class="ind"></span>${itens.map(([v, t, dis]) => `<button type="button" data-v="${v}"${v === atual ? ' class="is-on"' : ''}${dis ? ` disabled title="${esc(dis)}"` : ''}>${t}</button>`).join('')}</div>`;
  const mover = (s, ja) => { if (!s) return; const b = s.querySelector('button.is-on'), ind = s.querySelector('.ind'); if (!b || !ind) return; if (ja) ind.style.transition = 'none'; ind.style.left = b.offsetLeft + 'px'; ind.style.width = b.offsetWidth + 'px'; if (ja) { void ind.offsetWidth; ind.style.transition = ''; } };
  const crescer = raiz => requestAnimationFrame(() => requestAnimationFrame(() => raiz.querySelectorAll('.ps-trk i').forEach(n => n.classList.add('on'))));

  const montar = () => {
    const el = $('#psConteudo'); if (!el) return;
    const L = bols();
    if (!L.length) { el.innerHTML = ''; MONT = true; return; }
    if (!SEL || !L.some(b => b.data === SEL)) SEL = L[L.length - 1].data;
    const b = L.find(x => x.data === SEL), ant = anterior(b);
    if (!F.base || (F.base === 'ant' && !ant)) F.base = ant ? 'ant' : 'safra';
    el.innerHTML = `
      <section class="section" id="hPisoteio" data-nome="Pisoteio">
        <div class="tp-topo ps-topo"><h2 class="tp-tit"><i class="fa-solid fa-shoe-prints"></i>Análise de Pisoteio</h2>
          <div class="ps-ctl">
            <label class="pv-sel ps-bol"><span>Boletim</span><select id="psBol" aria-label="Boletim">${L.slice().reverse().map(x => `<option value="${x.data}"${x.data === b.data ? ' selected' : ''}>${br(x.data)}</option>`).join('')}</select></label>
            ${seg('psPer', [['semana', 'Últimos 7 dias'], ['mes', 'Mês'], ['safra', 'Safra']], F.per)}
          </div></div>
        <p class="ps-sub">Boletim FO.SA.10 · metros de soqueira avaliados x metros pisados pelas máquinas</p>
        <div class="ps-kpis" id="psKpis"></div>
        <div class="ps-g2">
          <article class="card ps-card"><div class="ps-hd"><div><h3 class="ps-h"><i class="fa-solid fa-ranking-star"></i>Top 5 frentes com mais pisoteio</h3><p class="ps-hs" id="psTopSub"></p></div>
            ${seg('psMet', [['pct', '% pisoteio'], ['m', 'Metros pisados']], F.met)}</div>
            <div class="ps-top" id="psTop"></div><div class="ps-leg" id="psTopLeg"></div></article>
          <article class="card ps-card ps-leit"><h3 class="ps-h"><i class="fa-regular fa-lightbulb"></i>Leitura do boletim</h3><ul id="psLeit"></ul></article>
        </div>
        <article class="card ps-card ps-full"><div class="ps-hd"><div><h3 class="ps-h"><i class="fa-solid fa-right-left"></i>Comparativo por frente</h3><p class="ps-hs" id="psCmpSub"></p></div>
          ${seg('psBase', [['ant', 'Semana anterior x última semana', ant ? '' : 'Disponível a partir do 2º boletim salvo'], ['safra', 'Semana x média da safra']], F.base)}</div>
                    <div class="ps-cmp" id="psCmp"></div><div class="ps-leg" id="psCmpLeg"></div></article>
        <div class="ps-g2">
          <article class="card ps-card"><h3 class="ps-h"><i class="fa-solid fa-map-location-dot"></i>Fazendas mais críticas na safra</h3>
            <p class="ps-hs">% de pisoteio por fazenda · só fazendas com 500 m ou mais avaliados</p><div class="ps-fz" id="psFz"></div><p class="ps-nota" id="psFzNota"></p></article>
          <article class="card ps-card"><h3 class="ps-h"><i class="fa-solid fa-clock-rotate-left"></i>Evolução por boletim</h3>
            <p class="ps-hs">% de pisoteio dos últimos 7 dias de cada boletim e o acumulado da safra</p><div id="psEvo"></div></article>
        </div>
        <article class="card ps-card ps-full"><div class="ps-hd"><div><h3 class="ps-h"><i class="fa-solid fa-table"></i>Tabelas do boletim</h3><p class="ps-hs">Clique numa frente dos últimos 7 dias para abrir as fazendas</p></div>
          ${seg('psTab', [['semana', 'Últimos 7 dias'], ['mes', 'Frente · Mês'], ['safra', 'Total Safra · Frente'], ['faz', 'Total Safra · Fazenda']], F.tab)}</div>
          <div class="ps-tw" id="psTab2"></div></article>
      </section>`;
    $$('#hPisoteio .ps-seg').forEach(s => mover(s, true));
    const liga = (id, fn) => $$(`#${id} button`).forEach(x => x.addEventListener('click', () => { if (x.disabled) return; $$(`#${id} button`).forEach(y => y.classList.toggle('is-on', y === x)); mover($('#' + id)); fn(x.dataset.v); }));
    liga('psPer', v => { F.per = v; kpis(b); topo(b); });
    liga('psMet', v => { F.met = v; topo(b); });
    liga('psBase', v => { F.base = v; cmp(b); });
    liga('psTab', v => { F.tab = v; tabela(b); });
    $('#psBol').addEventListener('change', e => { SEL = e.target.value; F.base = null; montar(); });
    kpis(b); topo(b); leitura(b); cmp(b); fazendas(b); evolucao(); tabela(b);
    MONT = true;
    if (window.Layout && Layout.pagina && Layout.pagina() === 'historico') Layout.secoes();
  };

  const todasFrentes = b => { const s = new Set(frentes(b.safra).map(f => f.n)); semanaArv(b.semana).forEach(f => s.add(f.n)); return [...s].sort(ordN); };

  function kpis(b) {
    const x = periodo(b, F.per), sf = total(b.safra), r = x.rows.filter(f => f.av > 0), ant = anterior(b), tA = ant && total(ant.semana);
    const el = $('#psKpis'); if (!x.t) { el.innerHTML = '<p class="hint">Sem dados neste período.</p>'; return; }
    const pior = [...r].sort((a, c) => c.pct - a.pct)[0];
    const todas = todasFrentes(b), sem = todas.filter(n => !r.some(f => f.n === n));
    const d = (v, ref, rot) => { const dd = v - ref; if (Math.abs(dd) < 0.005) return ''; return `<div class="ps-d" style="color:${corD(dd)}"><i class="fa-solid fa-arrow-${dd > 0 ? 'up' : dd < 0 ? 'down' : 'right'}"></i>${dif(dd)} vs ${rot}</div>`; };
    const deltas = [F.per !== 'safra' && sf ? d(x.t.pct, sf.pct, `safra (${pc(sf.pct)})`) : '', F.per === 'semana' && tA ? d(x.t.pct, tA.pct, `semana anterior (${pc(tA.pct)})`) : ''].join('');
    const nFaz = F.per === 'semana' ? r.reduce((s, f) => s + (f.faz ? f.faz.length : 0), 0) : 0;
    const card = (t, ic, v, un, s, extra = '', dec = null) => `<article class="k ps-k"><div class="k__t">${t}<i class="fa-solid ${ic}"></i></div><div class="k__v"><b${dec != null ? ` data-v="${v}" data-d="${dec}"` : ''}>${dec != null ? nf(0, dec) : v}</b><small>${un}</small></div><div class="k__s">${s}</div>${extra}</article>`;
    el.innerHTML = [
      card('% de pisoteio', 'fa-percent', x.t.pct, '%', esc(x.rot), deltas, 2),
      card('Metros pisados', 'fa-shoe-prints', x.t.pi, ' m', `de <b>${nf(x.t.av)} m</b> avaliados`, '', 1),
      card('Metros avaliados', 'fa-ruler-horizontal', x.t.av, ' m', F.per === 'semana' ? `${r.length} frentes · ${nFaz} fazendas` : `${r.length} frentes`, '', 0),
      card('Frentes avaliadas', 'fa-layer-group', String(r.length), ` de ${todas.length}`, sem.length ? `sem avaliação: ${sem.map(n => n.replace(/^Frente\s*/, '')).join(', ')}` : 'todas tiveram avaliação'),
      pior ? card('Maior % de pisoteio', 'fa-triangle-exclamation', esc(pior.n.replace(/^Frente\s*/, 'F')), ` · ${pc(pior.pct)}`, `${nf(pior.pi, 1)} m pisados em ${nf(pior.av)} m`) : ''
    ].join('');
    el.querySelectorAll('.ps-k').forEach((c, i) => c.style.setProperty('--i', i));
    el.querySelectorAll('.k__v b[data-v]').forEach(contar);
    const n = $('#psFzNotaMes'); if (n) n.remove();
    if (x.nota) el.insertAdjacentHTML('beforeend', `<p class="ps-nota ps-nota--k" id="psFzNotaMes"><i class="fa-solid fa-circle-info"></i> ${esc(x.nota)}</p>`);
  }

  function topo(b) {
    const x = periodo(b, F.per), SAF = new Map(frentes(b.safra).map(f => [f.n, f]));
    const r = x.rows.filter(f => f.av > 0).sort((a, c) => (F.met === 'pct' ? c.pct - a.pct : c.pi - a.pi)).slice(0, 5);
    const comRef = F.met === 'pct' && F.per !== 'safra';
    const mx = Math.max(0.01, ...r.map(f => (F.met === 'pct' ? Math.max(f.pct, comRef && SAF.get(f.n) ? SAF.get(f.n).pct : 0) : f.pi))) * 1.08;
    $('#psTopSub').textContent = `${x.rot} · ordenado por ${F.met === 'pct' ? '% de pisoteio' : 'metros pisados'}`;
    const el = $('#psTop');
    el.innerHTML = r.length ? r.map((f, i) => {
      const v = F.met === 'pct' ? f.pct : f.pi, ref = comRef && SAF.get(f.n) ? SAF.get(f.n).pct : null;
      return `<div class="ps-tl" style="--i:${i}"><span class="n">${i + 1}</span><span class="nm"><b>${esc(f.n)}</b><small>${esc(f.s || nf(f.av) + ' m avaliados')}</small></span>
        <span class="ps-trk"><i style="--w:${(v / mx * 100).toFixed(1)}%"></i>${ref != null ? `<span class="ref" style="left:${(ref / mx * 100).toFixed(1)}%" data-t="safra ${nf(ref, 1)}%"></span>` : ''}</span>
        <span class="v">${F.met === 'pct' ? pc(f.pct) : nf(f.pi, 1) + ' m'}<small>${F.met === 'pct' ? nf(f.pi, 1) + ' m pisados' : pc(f.pct)}</small></span></div>`;
    }).join('') : '<p class="hint">Nenhuma frente avaliada neste período.</p>';
    $('#psTopLeg').innerHTML = comRef ? `<span><i style="background:var(--ps-top)"></i>% no período</span><span><i class="ln"></i>% da frente na safra</span>` : '';
    crescer(el);
  }

  function cmp(b) {
    const ant = anterior(b), ex = F.base === 'ant' && ant;
    const S = new Map(semanaArv(b.semana).map(f => [f.n, f]));
    const A = ex ? new Map(semanaArv(ant.semana).map(f => [f.n, f])) : new Map(frentes(b.safra).map(f => [f.n, f]));
    const rotA = ex ? `semana até ${brC(ant.data)}` : 'média da safra', rotB = `semana até ${brC(b.data)}`;
    $('#psCmpSub').textContent = `% de pisoteio por frente · ${rotA} x ${rotB}`;
    const L = todasFrentes(b).map(n => ({ n, a: A.get(n) && A.get(n).av > 0 ? A.get(n).pct : null, b: S.get(n) && S.get(n).av > 0 ? S.get(n).pct : null }));
    const top = Math.max(4, ...L.flatMap(r => [r.a || 0, r.b || 0]));
    const passo = top > 20 ? 5 : top > 10 ? 4 : 2, mx = Math.ceil(top * 1.08 / passo) * passo;
    const W = Math.max(560, Math.round(($('#psCmp').clientWidth || 900))), H = 300, pl = 40, pr = 8, pt = 24, pb = 52, n = L.length;
    const gw = (W - pl - pr) / n, bw = Math.min(26, gw * 0.32), Y = v => pt + (1 - v / mx) * (H - pt - pb), y0 = Y(0);
    let s = `<svg class="ps-col" viewBox="0 0 ${W} ${H}" role="img" aria-label="Comparativo de % de pisoteio por frente">`;
    for (let v = 0; v <= mx; v += passo) s += `<line class="gr" x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${pl - 6}" y="${Y(v) + 4}" text-anchor="end">${v}%</text>`;
    L.forEach((r, i) => {
      const cx = pl + gw * i + gw / 2;
      [[r.a, 'a', -1], [r.b, 'b', 1]].forEach(([v, cl, k], j) => {
        const x = cx + (k < 0 ? -bw - 2 : 2);
        if (v == null) { s += `<text class="nd" x="${x + bw / 2}" y="${y0 - 5}" text-anchor="middle">–</text>`; return; }
        const h = Math.max(1.5, y0 - Y(v));
        s += `<rect class="cl ${cl}" style="--i:${i * 2 + j}" x="${x}" y="${y0 - h}" width="${bw}" height="${h}" rx="3"><title>${esc(r.n)} · ${cl === 'a' ? rotA : rotB}: ${pc(v)}</title></rect><text class="vl ${cl}" x="${x + bw / 2}" y="${y0 - h - 5}" text-anchor="middle">${nf(v, 1)}</text>`;
      });
      s += `<text class="fr" x="${cx}" y="${H - 32}" text-anchor="middle">${esc(r.n.replace(/^Frente\s*/, 'F'))}</text>`;
      if (r.a != null && r.b != null) { const d = r.b - r.a; s += `<text class="dl" x="${cx}" y="${H - 15}" text-anchor="middle" fill="${corD(d)}">${dif(d)}</text>`; }
      else s += `<text class="dl" x="${cx}" y="${H - 15}" text-anchor="middle" fill="${NEUTRO}">${r.b == null ? (gw < 95 ? 'sem aval.' : 'sem avaliação') : ex ? (gw < 95 ? 'nova' : 'nova na semana') : '—'}</text>`;
    });
    $('#psCmp').innerHTML = s + '</svg>';
    $('#psCmpLeg').innerHTML = `<span><i style="background:var(--ps-ant)"></i>${rotA}</span><span><i style="background:var(--ps-atual)"></i>${rotB}</span><span class="ps-dica">variação em p.p. embaixo de cada frente: <b style="color:${PIOR}">vermelho</b> piorou, <b style="color:${MELHOR}">azul</b> melhorou</span>${ex ? '' : '<span class="ps-dica"><i class="fa-solid fa-circle-info"></i>Com 2 boletins salvos, o comparativo passa a ser semana anterior x última semana.</span>'}`;
  }

  function fazendas(b) {
    const all = (b.fazendas || []).filter(r => !/^total geral$/i.test(r[0]));
    const r = all.filter(x => x[1] >= 500).sort((a, c) => c[3] - a[3]).slice(0, 8);
    const el = $('#psFz');
    if (!r.length) { el.innerHTML = '<p class="hint">Sem a tabela de fazendas neste boletim.</p>'; $('#psFzNota').textContent = ''; return; }
    const mx = r[0][3] * 1.05 || 1;
    el.innerHTML = r.map(x => `<div class="ps-fl"><span class="nm">${esc(x[0].replace(/^(\d+)\s*-\s*/, '$1 · '))} <small>· ${nf(x[2], 1)} de ${nf(x[1])} m</small></span><span class="ps-trk"><i style="--w:${(x[3] / mx * 100).toFixed(1)}%"></i></span><b>${pc(x[3])}</b></div>`).join('');
    const peq = all.filter(x => x[1] < 500 && x[3] >= 10).sort((a, c) => c[3] - a[3]);
    $('#psFzNota').innerHTML = peq.length ? `<i class="fa-solid fa-circle-info"></i> Fora da lista por amostra pequena (menos de 500 m): ${peq.map(x => esc(`${x[0].replace(/^\d+\s*-\s*(Fazenda\s*)?/i, '')} ${nf(x[3], 1)}% em ${nf(x[1])} m`)).join(' · ')}.` : '';
    crescer(el);
  }

  function evolucao() {
    const el = $('#psEvo'), L = bols().filter(b => total(b.semana) || total(b.safra));
    if (L.length < 2) {
      el.innerHTML = `<div class="ps-hist">${L.map(b => `<span class="b is-on"><i class="fa-solid fa-check"></i> ${br(b.data)}</span>`).join('')}<span class="b fut">${br(addDias(L[0].data, 7))} · próximo</span></div>
        <p class="ps-nota">Cada boletim que entra na pasta fica salvo. Com 2 boletins ou mais, aparece aqui a evolução semanal do % de pisoteio, e o comparativo passa a mostrar semana anterior x última semana.</p>`;
      return;
    }
    const W = 640, H = 220, pl = 40, pr = 54, pt = 18, pb = 30;
    const S = L.map(b => (total(b.semana) || {}).pct ?? null), A = L.map(b => (total(b.safra) || {}).pct ?? null);
    const mx = Math.max(4, ...S.filter(Number.isFinite), ...A.filter(Number.isFinite)) * 1.15;
    const X = i => pl + (L.length === 1 ? 0 : i * (W - pl - pr) / (L.length - 1)), Y = v => pt + (1 - v / mx) * (H - pt - pb);
    const linha = arr => arr.map((v, i) => (Number.isFinite(v) ? `${X(i).toFixed(1)},${Y(v).toFixed(1)}` : null)).filter(Boolean).join(' ');
    const tks = [0, mx / 2, mx].map(v => Math.round(v));
    const ult = L.length - 1;
    el.innerHTML = `<svg class="ps-evo" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução do % de pisoteio por boletim">
      ${tks.map(v => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" class="gr"/><text x="${pl - 8}" y="${Y(v) + 4}" text-anchor="end" class="ax">${v}%</text>`).join('')}
      ${L.map((b, i) => `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" class="ax">${brC(b.data)}</text>`).join('')}
      <polyline points="${linha(A)}" class="saf"/><polyline points="${linha(S)}" class="sem draw"/>
      ${S.map((v, i) => (Number.isFinite(v) ? `<circle cx="${X(i)}" cy="${Y(v)}" r="4.5" class="pt"><title>${br(L[i].data)} · últimos 7 dias ${pc(v)} · safra ${pc(A[i])}</title></circle>` : '')).join('')}
      ${Number.isFinite(S[ult]) ? `<text x="${X(ult) + 8}" y="${Y(S[ult]) + 4}" class="vl">${nf(S[ult], 1)}%</text>` : ''}
      ${Number.isFinite(A[ult]) ? `<text x="${X(ult) + 8}" y="${Y(A[ult]) + 4}" class="vl vl--s">${nf(A[ult], 1)}%</text>` : ''}
    </svg><div class="ps-leg"><span><i style="background:var(--canavial)"></i>últimos 7 dias de cada boletim</span><span><i class="tr"></i>acumulado da safra</span></div>`;
  }

  function tabela(b) {
    const el = $('#psTab2'); let rows = '', t, cab = 'Frente', nota = '';
    if (F.tab === 'semana') {
      t = total(b.semana);
      rows = semanaArv(b.semana).map((f, i) => `<tr class="fr${F.abertas.has(f.n) ? ' is-ab' : ''}" data-f="${esc(f.n)}"><td><i class="fa-solid fa-chevron-right"></i>${esc(f.n)}${f.s ? ` <span class="sub">${esc(f.s)}</span>` : ''}</td><td class="n">${nf(f.av)}</td><td class="n">${nf(f.pi, 2)}</td><td class="n">${celPct(f.pct)}</td></tr>`
        + f.faz.map(z => `<tr class="ps-fzl" data-p="${esc(f.n)}"${F.abertas.has(f.n) ? '' : ' hidden'}><td>${esc(z.n)}</td><td class="n">${nf(z.av)}</td><td class="n">${nf(z.pi, 2)}</td><td class="n">${celPct(z.pct)}</td></tr>`).join('')).join('');
    } else if (F.tab === 'faz') {
      cab = 'Fazenda'; t = total(b.fazendas); nota = 'Ordenado do maior para o menor % de pisoteio.';
      rows = (b.fazendas || []).filter(r => !/^total geral$/i.test(r[0])).sort((a, c) => c[3] - a[3]).map(r => `<tr><td>${esc(r[0])}</td><td class="n">${nf(r[1])}</td><td class="n">${nf(r[2], 2)}</td><td class="n">${celPct(r[3])}</td></tr>`).join('');
    } else {
      const x = F.tab === 'mes' ? mesDe(b) : periodo(b, 'safra'); t = x.t; nota = x.nota;
      rows = x.rows.map(f => `<tr><td><b>${esc(f.n)}</b>${f.s ? ` <span class="sub">${esc(f.s)}</span>` : ''}</td><td class="n">${nf(f.av)}</td><td class="n">${nf(f.pi, 2)}</td><td class="n">${celPct(f.pct)}</td></tr>`).join('');
    }
    el.innerHTML = `<table class="ps-tab"><thead><tr><th>${cab}</th><th class="n">Metros avaliados</th><th class="n">Metros pisados</th><th class="n">% pisoteio</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="hint">Tabela não encontrada neste boletim.</td></tr>'}</tbody>
      ${t ? `<tfoot><tr><td>Total geral</td><td class="n">${nf(t.av)}</td><td class="n">${nf(t.pi, 2)}</td><td class="n">${pc(t.pct)}</td></tr></tfoot>` : ''}</table>${nota ? `<p class="ps-nota"><i class="fa-solid fa-circle-info"></i> ${esc(nota)}</p>` : ''}`;
    el.querySelectorAll('tr.fr').forEach(tr => tr.addEventListener('click', () => {
      const f = tr.dataset.f, ab = !F.abertas.has(f); if (ab) F.abertas.add(f); else F.abertas.delete(f);
      tr.classList.toggle('is-ab', ab); el.querySelectorAll('tr.ps-fzl').forEach(x => { if (x.dataset.p === f) x.hidden = !ab; });
    }));
  }

  /* ---------------------------------------------------------------- leitura automática */
  function leitura(b) {
    const it = [], ts = total(b.semana), tf = total(b.safra), ant = anterior(b), ta = ant && total(ant.semana);
    const S = semanaArv(b.semana).filter(f => f.av > 0), SAF = new Map(frentes(b.safra).map(f => [f.n, f]));
    const fN = n => `<b>${esc(n)}</b>`;
    if (ts) {
      let t = `Nos <b>últimos 7 dias</b> foram avaliados <b>${nf(ts.av)} m</b> em ${S.length} ${S.length === 1 ? 'frente' : 'frentes'}, com <b>${nf(ts.pi, 1)} m pisados (${pc(ts.pct)})</b>`;
      if (tf) t += `, ${ts.pct > tf.pct ? 'acima' : ts.pct < tf.pct ? 'abaixo' : 'igual'} da média da safra (<b>${pc(tf.pct)}</b>)`;
      if (ta) t += `. Na semana anterior foi ${pc(ta.pct)} (${dif(ts.pct - ta.pct)})`;
      it.push(t + '.');
    }
    const ord = [...S].sort((a, c) => c.pct - a.pct), p1 = ord[0];
    if (p1 && p1.pct > 0) {
      const sf = SAF.get(p1.n), fz = [...p1.faz].sort((a, c) => c.pi - a.pi)[0];
      let t = `${fN(p1.n)} teve o maior pisoteio da semana: <b>${pc(p1.pct)}</b> (${nf(p1.pi, 1)} m)`;
      if (sf && sf.pct > 0) { const r = p1.pct / sf.pct; t += r >= 1.6 ? `, ${r >= 1.9 && r < 2.2 ? 'quase o dobro' : `${nf(r, 1)} vezes`} da média dela na safra (${pc(sf.pct)})` : `, contra ${pc(sf.pct)} na safra`; }
      if (fz && fz.pi > 0 && p1.faz.length > 1) t += `. O peso veio da <b>${esc(fz.n.replace(/^\d+\s*-\s*/, ''))}: ${pc(fz.pct)}</b> (${nf(fz.pi, 1)} m em ${nf(fz.av)} m)`;
      it.push(t + '.');
    }
    const subiu = ord.slice(1).filter(f => SAF.get(f.n) && f.pct - SAF.get(f.n).pct >= 0.4).map(f => `${fN(f.n)} ${pc(f.pct)} (safra ${pc(SAF.get(f.n).pct)})`);
    if (subiu.length) it.push(`Também acima da média da safra: ${subiu.join('; ')}.`);
    const zero = S.filter(f => f.pi === 0).map(f => f.n.replace(/^Frente\s*/, '')), todas = todasFrentes(b), sem = todas.filter(n => !S.some(f => f.n === n)).map(n => n.replace(/^Frente\s*/, ''));
    const lis = a => (a.length > 1 ? a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1] : a[0]);
    const z = [];
    if (zero.length) z.push(`<b>${zero.length > 1 ? 'Frentes' : 'Frente'} ${lis(zero)}</b> não ${zero.length > 1 ? 'tiveram' : 'teve'} pisoteio na semana`);
    if (sem.length) z.push(`<b>${sem.length > 1 ? 'Frentes' : 'Frente'} ${lis(sem)}</b> não ${sem.length > 1 ? 'tiveram' : 'teve'} avaliação no período`);
    if (z.length) it.push(z.join('. ') + '.');
    const lid = frentes(b.safra).sort((a, c) => c.pi - a.pi).slice(0, 3);
    if (lid.length) it.push(`Na safra, ${fN(lid[0].n)} lidera em metros pisados (${nf(lid[0].pi, 1)} m)${lid.length > 2 ? `, seguida da ${fN(lid[1].n)} (${nf(lid[1].pi, 1)} m) e da ${fN(lid[2].n)} (${nf(lid[2].pi, 1)} m)` : ''}.`);
    const fzS = new Map((b.fazendas || []).map(r => [r[0].replace(/\s+/g, ' ').trim(), r]));
    const rec = S.flatMap(f => f.faz).filter(z2 => z2.pct >= 10).map(z2 => ({ z: z2, s: fzS.get(z2.n.replace(/\s+/g, ' ').trim()) })).filter(x => x.s && x.s[3] >= 10);
    if (rec.length) it.push(`Ponto recorrente: ${rec.map(x => `<b>${esc(x.z.n.replace(/^\d+\s*-\s*/, ''))}</b> ${pc(x.z.pct)} na semana e ${pc(x.s[3])} na safra`).join('; ')}.`);
    $('#psLeit').innerHTML = it.map(t => `<li>${t}</li>`).join('') || '<li>Sem dados para a leitura.</li>';
  }

  /* ---------------------------------------------------------------- ciclo */
  const ler = async p => { try { const r = await fetch(p, { cache: 'no-store' }); if (!r.ok) return null; return (await Acesso.readJson(await r.json())).data; } catch (e) { return null; } };
  P.iniciar = async () => {
    D = await ler('historico/pisoteio.json');
    const antes = window.Layout && Layout.aoEntrar;
    if (window.Layout) Layout.aoEntrar = pg => { if (antes) antes(pg); if (pg.dataset.p === 'historico') { if (!MONT) montar(); else $$('#hPisoteio .ps-seg').forEach(s => mover(s, true)); } };
    montar();
  };
  P.dados = () => D;
  P.definir = x => { if (x) { D = x; SEL = null; F.base = null; montar(); } };
  let rz = null;
  window.addEventListener('resize', () => { $$('#hPisoteio .ps-seg').forEach(s => mover(s, true)); clearTimeout(rz); rz = setTimeout(() => { const b = bols().find(x => x.data === SEL); if (b && $('#psCmp')) cmp(b); }, 200); });
  window.Pisoteio = P;
})();
