/* =========================================================================
   Layout em páginas: trilho lateral, barra de seções com pílula deslizante,
   troca de página com animação e números que contam até o valor.
   Usado por index.html (CT · Transporte · Vinhaça) e incendio.html.
   ========================================================================= */
(function () {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const semMov = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const L = {};
  const secs = () => $('#secs');

  /* ---------- números que contam ---------- */
  const RX = /^(\s*)([+\-−]?)(\d{1,3}(?:\.\d{3})+|\d+)(,\d+)?/;
  L.animar = (raiz = document) => {
    if (semMov() || !raiz) return;
    raiz.querySelectorAll('.k__v, .kpi__value, .gv, .agro-kpis b, .perda-resumo b, .pl-item strong').forEach(el => {
      const tn = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
      if (!tn) return;
      const m = tn.textContent.match(RX); if (!m) return;
      const inteiro = m[3], dec = m[4] ? m[4].length - 1 : 0, milhar = inteiro.includes('.');
      if (!milhar && !dec && inteiro.length >= 5) return; // código de máquina, não é quantidade
      const alvo = parseFloat(inteiro.replace(/\./g, '') + (m[4] ? '.' + m[4].slice(1) : '')) * (m[2] === '−' || m[2] === '-' ? -1 : 1);
      if (!Number.isFinite(alvo) || alvo === 0) return;
      const resto = tn.textContent.slice(m[0].length), pre = m[1];
      const fmt = v => {
        const s = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: milhar || Math.abs(alvo) >= 1000 });
        return pre + (v < 0 ? (m[2] || '−') : m[2] === '+' ? '+' : '') + s + resto;
      };
      cancelAnimationFrame(el._raf);
      const t0 = performance.now(), ms = 850;
      const passo = t => { const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3); tn.textContent = p < 1 ? fmt(alvo * e) : fmt(alvo); if (p < 1) el._raf = requestAnimationFrame(passo); };
      tn.textContent = fmt(0);
      el._raf = requestAnimationFrame(passo);
    });
  };

  /* ---------- velocímetro ---------- */
  const GX = 150, GY = 150, GR = 112;
  L.gauge = (svg, faixas, max) => {
    const pto = v => { const a = (180 - v / max * 180) * Math.PI / 180; return `${(GX + GR * Math.cos(a)).toFixed(2)} ${(GY - GR * Math.sin(a)).toFixed(2)}`; };
    let de = 0;
    const arcs = faixas.map(([ate, cor], i) => { const gap = max * .004; const p = `<path class="arc" d="M ${pto(de + (i ? gap : 0))} A ${GR} ${GR} 0 0 1 ${pto(ate - (i < faixas.length - 1 ? gap : 0))}" stroke="${cor}"/>`; de = ate; return p; }).join('');
    const ticks = Array.from({ length: 11 }, (_, i) => { const a = (180 - i * 18) * Math.PI / 180, r1 = GR - 20, r2 = GR - 14; return `<line x1="${(GX + r1 * Math.cos(a)).toFixed(1)}" y1="${(GY - r1 * Math.sin(a)).toFixed(1)}" x2="${(GX + r2 * Math.cos(a)).toFixed(1)}" y2="${(GY - r2 * Math.sin(a)).toFixed(1)}" stroke="#C9D2C5" stroke-width="1.5"/>`; }).join('');
    svg.innerHTML = `${arcs}${ticks}<g class="needle"><path d="M ${GX} 56 L ${GX - 5.5} ${GY} L ${GX + 5.5} ${GY} Z" fill="#18301F"/></g><circle cx="${GX}" cy="${GY}" r="11" fill="#18301F"/><circle cx="${GX}" cy="${GY}" r="4.5" fill="#fff"/>`;
    return {
      set(v) {
        const vv = Math.max(0, Math.min(max, Number(v) || 0));
        requestAnimationFrame(() => { svg.querySelector('.needle').style.transform = `rotate(${vv / max * 180 - 90}deg)`; });
        let ini = 0; svg.querySelectorAll('.arc').forEach((p, i) => { p.classList.toggle('off', ini > vv); ini = faixas[i][0]; });
      },
    };
  };

  /* ---------- barra de seções ---------- */
  let SPY = null;
  const moveSec = (b, imediato) => {
    const n = secs(); if (!n || !b) return;
    const ind = n.querySelector('.ind');
    if (imediato) ind.style.transition = 'none';
    ind.style.left = b.offsetLeft + 'px'; ind.style.width = b.offsetWidth + 'px';
    if (imediato) { void ind.offsetWidth; ind.style.transition = ''; }
    n.querySelectorAll('button').forEach(x => x.classList.toggle('is-on', x === b));
    if (n.scrollWidth > n.clientWidth) n.scrollTo({ left: b.offsetLeft - n.clientWidth / 2 + b.offsetWidth / 2, behavior: imediato ? 'auto' : 'smooth' });
  };
  // monta as pílulas com as seções [id, nome]
  L.secoes = lista => {
    const n = secs(); if (!n) return;
    if (!lista) {
      const pg = $('.page.is-on') || document;
      lista = [...pg.querySelectorAll('[data-nome]')].map(s => [s.id, s.dataset.nome]);
      if (!lista.length && n.dataset.lista) lista = n.dataset.lista.split('|').map(x => x.split(':'));
    }
    n.innerHTML = '<span class="ind"></span>' + lista.map(([id, nome], i) => `<button type="button" data-s="${id}" class="${i ? '' : 'is-on'}">${nome}</button>`).join('');
    requestAnimationFrame(() => moveSec(n.querySelector('button'), true));
    if (SPY) SPY.disconnect();
    SPY = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) moveSec(n.querySelector(`[data-s="${e.target.id}"]`)); }), { rootMargin: '-40% 0px -55% 0px' });
    lista.forEach(([id]) => { const el = document.getElementById(id); if (el) SPY.observe(el); });
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('#secs button[data-s]'); if (!b) return;
    const alvo = document.getElementById(b.dataset.s); if (!alvo) return;
    moveSec(b);
    alvo.scrollIntoView({ behavior: semMov() ? 'auto' : 'smooth', block: 'start' });
  });
  addEventListener('resize', () => { const b = $('#secs button.is-on'); if (b) moveSec(b, true); });

  /* ---------- páginas (index.html) ---------- */
  let PAG = null;
  L.aoEntrar = null; // definido pelo script da página: replay dos gráficos
  L.ir = p => {
    const paginas = $$('.page[data-p]'); if (!paginas.length) return;
    if (!paginas.some(x => x.dataset.p === p)) p = paginas[0].dataset.p;
    if (p === PAG) return;
    PAG = p;
    $$('.rail a[data-p]').forEach(a => { const on = a.dataset.p === p; a.classList.toggle('is-on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    paginas.forEach(x => x.classList.remove('is-on', 'entra'));
    const pg = paginas.find(x => x.dataset.p === p);
    pg.classList.add('is-on'); void pg.offsetWidth; if (!semMov()) pg.classList.add('entra');
    document.title = `${pg.dataset.titulo || 'Painel'} · Gerenciamento Diário`;
    window.scrollTo({ top: 0, behavior: 'auto' });
    L.secoes();
    requestAnimationFrame(() => { if (typeof L.aoEntrar === 'function') L.aoEntrar(pg); L.animar(pg); });
  };
  L.pagina = () => PAG;
  const doHash = () => { const h = location.hash.slice(1); if ($$('.page[data-p]').some(x => x.dataset.p === h)) L.ir(h); };
  addEventListener('hashchange', doHash);
  L.iniciar = () => {
    if ($$('.page[data-p]').length) { const h = location.hash.slice(1); L.ir($$('.page[data-p]').some(x => x.dataset.p === h) ? h : $$('.page[data-p]')[0].dataset.p); }
    else L.secoes();
  };
  // selo no ícone do trilho (vazio = some)
  L.selo = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n ? String(n) : ''; };

  // quem pode importar e publicar; os demais só visualizam
  const EDITORES = ['talamanteneto'];
  L.definirUsuario = u => document.body.classList.toggle('is-editor', EDITORES.includes(String(u || '').trim().toLowerCase()));
  L.editor = () => document.body.classList.contains('is-editor');

  window.Layout = L;
})();
