/* =========================================================================
   Página Risco de Incêndio
   - Lê incendio.json (protegido) publicado no GitHub.
   - "Importar planilha" lê a Planilha1 do Excel no próprio navegador,
     atualiza a página e baixa o incendio.json protegido para publicar.
   ========================================================================= */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const STORE_KEY = 'painel-incendio';
  const FAIXAS = [ // limite inferior (%), nome, cor
    [90, 'Extremo', '#9E1F1F', '#FBE7E4'],
    [80, 'Muito alto', '#D9472E', '#FCEBE6'],
    [60, 'Alto', '#EF8A2B', '#FDF0E3'],
    [40, 'Moderado', '#F2C14E', '#FDF6E1'],
    [0, 'Baixo', '#97C459', '#EEF6E5'],
  ];
  const faixa = r => FAIXAS.find(f => r >= f[0]) || FAIXAS[FAIXAS.length - 1];
  const nf = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const avg = (a, f) => (a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : null);
  const hh = h => `${String(h).padStart(2, '0')}h`;

  const toast = (msg, ms = 3500) => { const t = $('#toast'); t.innerHTML = msg; t.classList.add('is-on'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('is-on'), ms); };
  const modal = (title, html, buttons = []) => {
    $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html;
    const f = $('#modalFoot'); f.innerHTML = '';
    buttons.forEach(b => { const el = document.createElement('button'); el.className = 'btn' + (b.primary ? ' btn--primary' : ''); el.innerHTML = b.html; el.onclick = b.onClick; f.appendChild(el); });
    $('#modal').hidden = false;
  };
  const closeModal = () => { $('#modal').hidden = true; };
  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  const download = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };

  /* ---------- Leitura da planilha ---------- */
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const COLS = {
    local: ['local', 'fazenda', 'localidade'],
    hora: ['hora', 'horario'],
    risco: ['risco', 'risco de incendio'],
    temp: ['temperatura', 'temperatura c'],
    umid: ['umidade', 'umidade relativa'],
    vento: ['velocidade do vento km h', 'velocidade do vento', 'vento'],
    dir: ['direcao do vento'],
    chuva: ['precipitacao mm', 'precipitacao', 'chuva'],
    tmax: ['temperatura maxima'],
    tmin: ['temperatura minima'],
  };
  const OBRIG = ['local', 'risco', 'temp', 'umid'];
  const num = v => { if (v == null || v === '') return null; if (typeof v === 'number') return v; const n = parseFloat(String(v).replace('%', '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const pct = v => { const n = num(v); return n == null ? null : (n <= 1.5 ? n * 100 : n); };
  const hora = v => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') { const f = v % 1; return Math.round(f * 24) % 24; }
    if (v instanceof Date) return v.getHours();
    const m = String(v).match(/(\d{1,2})\s*[:h]/i) || String(v).match(/^(\d{1,2})$/);
    return m ? +m[1] : null;
  };
  const parsePlanilha = (wb, arquivo) => {
    const nome = wb.SheetNames.find(n => norm(n) === 'planilha1') || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: null });
    const hi = rows.findIndex(r => r && r.some(c => norm(c) === 'local') && r.some(c => norm(c) === 'risco'));
    if (hi < 0) throw new Error('Não encontrei o cabeçalho com as colunas "Local" e "Risco" na planilha.');
    const head = rows[hi].map(norm);
    const idx = {};
    Object.entries(COLS).forEach(([k, alts]) => { const i = head.findIndex(h => alts.includes(h)); if (i >= 0) idx[k] = i; });
    const faltam = OBRIG.filter(k => idx[k] == null);
    if (faltam.length) throw new Error('Colunas não encontradas: ' + faltam.map(k => COLS[k][0]).join(', ') + '.');
    const leituras = [];
    let tmax = null, tmin = null;
    rows.slice(hi + 1).forEach(r => {
      if (!r || r[idx.local] == null || String(r[idx.local]).trim() === '') return;
      const risco = pct(r[idx.risco]); if (risco == null) return;
      leituras.push({
        local: String(r[idx.local]).trim(),
        hora: idx.hora != null ? hora(r[idx.hora]) : null,
        risco: Math.round(risco * 10) / 10,
        temp: num(r[idx.temp]),
        umid: pct(r[idx.umid]),
        vento: idx.vento != null ? num(r[idx.vento]) : null,
        dir: idx.dir != null && r[idx.dir] != null ? String(r[idx.dir]) : null,
        chuva: idx.chuva != null ? (num(r[idx.chuva]) || 0) : 0,
      });
      if (idx.tmax != null && tmax == null && num(r[idx.tmax]) != null) tmax = num(r[idx.tmax]);
      if (idx.tmin != null && tmin == null && num(r[idx.tmin]) != null) tmin = num(r[idx.tmin]);
    });
    if (!leituras.length) throw new Error('A planilha não tem linhas com local e risco preenchidos.');
    const hoje = new Date();
    return {
      meta: { arquivo, aba: nome, dataLeitura: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`, importadoEm: hoje.toISOString() },
      previsao: { tmax, tmin },
      leituras,
    };
  };

  /* ---------- Cálculos ---------- */
  const horasDe = D => [...new Set(D.leituras.map(x => x.hora).filter(h => h != null))].sort((a, b) => a - b);
  // situação na hora h: leitura mais recente de cada local até h (h = null → a mais recente de todas)
  const calc = (D, h) => {
    const L = D.leituras;
    const ult = new Map();
    L.forEach(x => {
      if (h != null && x.hora != null && x.hora > h) return;
      const p = ult.get(x.local); if (!p || (x.hora ?? -1) >= (p.hora ?? -1)) ult.set(x.local, x);
    });
    const atual = [...ult.values()];
    const horas = horasDe(D);
    const porHora = horas.map(hr => { const s = L.filter(x => x.hora === hr); return { h: hr, risco: avg(s, x => x.risco), n: s.length }; });
    const maxBy = (a, f) => a.reduce((m, x) => (f(x) != null && (m == null || f(x) > f(m)) ? x : m), null);
    const minBy = (a, f) => a.reduce((m, x) => (f(x) != null && (m == null || f(x) < f(m)) ? x : m), null);
    const cont = FAIXAS.map(f => ({ f, n: atual.filter(x => faixa(x.risco) === f).length }));
    return {
      atual, porHora, horas, hora: h != null ? h : (horas.length ? horas[horas.length - 1] : null),
      risco: avg(atual, x => x.risco),
      altoOuMais: atual.filter(x => x.risco >= 60).length,
      temp: avg(atual.filter(x => x.temp != null), x => x.temp), tMax: maxBy(atual, x => x.temp),
      umid: avg(atual.filter(x => x.umid != null), x => x.umid), uMin: minBy(atual, x => x.umid),
      abaixo30: atual.filter(x => x.umid != null && x.umid < 30).length,
      vento: avg(atual.filter(x => x.vento != null), x => x.vento), vMax: maxBy(atual, x => x.vento),
      chuvaLocais: atual.filter(x => x.chuva > 0).length, chuvaMax: maxBy(atual, x => x.chuva),
      cont,
    };
  };

  /* ---------- Velocímetro ---------- */
  const GX = 150, GY = 150, GR = 112;
  const ponto = v => { const t = (180 - v * 1.8) * Math.PI / 180; return `${(GX + GR * Math.cos(t)).toFixed(2)} ${(GY - GR * Math.sin(t)).toFixed(2)}`; };
  const arco = (v1, v2) => `M ${ponto(v1)} A ${GR} ${GR} 0 0 1 ${ponto(v2)}`;
  const BANDAS = [...FAIXAS].reverse(); // Baixo → Extremo
  const gaugeSvg = () => {
    const lim = [0, 40, 60, 80, 90, 100];
    const arcs = BANDAS.map((f, i) => `<path class="arc" data-i="${i}" d="${arco(lim[i] + (i ? 0.9 : 0), lim[i + 1] - (i < 4 ? 0.9 : 0))}" stroke="${f[2]}"/>`).join('');
    return `<svg class="rf-gauge" viewBox="0 0 300 170" role="img" aria-label="Velocímetro do risco médio">
      ${arcs}
      <g class="rf-needle" id="rfNeedle"><path d="M ${GX} 58 L ${GX - 5.5} ${GY} L ${GX + 5.5} ${GY} Z" fill="#18301F"/></g>
      <circle cx="${GX}" cy="${GY}" r="11" fill="#18301F"/><circle cx="${GX}" cy="${GY}" r="4.5" fill="#fff"/>
    </svg>`;
  };

  /* ---------- Animações ---------- */
  const semMov = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const contar = (el, de, para, ms = 750) => {
    cancelAnimationFrame(el._raf);
    if (semMov() || de == null || !Number.isFinite(de)) { el.textContent = nf(para, 1) + '%'; return; }
    const t0 = performance.now();
    const passo = t => { const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3); el.textContent = nf(de + (para - de) * e, 1) + '%'; if (p < 1) el._raf = requestAnimationFrame(passo); };
    el._raf = requestAnimationFrame(passo);
  };

  /* ---------- Renderização ---------- */
  let chart = null, HORA = null, RISCO_ANT = null;
  const render = D => {
    const horas = horasDe(D);
    HORA = horas.length ? horas[horas.length - 1] : null;
    RISCO_ANT = null;
    $('#rfFonte').textContent = `Fonte: ${D.meta?.arquivo || 'planilha Risco de Incêndio'} · importado em ${new Date(D.meta?.importadoEm || Date.now()).toLocaleString('pt-BR')}`;
    const kpi = (id, icone, titulo) => `<div class="rf-kpi" id="${id}"><div class="rf-kpi__t"><span>${titulo}</span><i class="${icone}"></i></div><div class="v">—</div><div class="s">—</div></div>`;
    $('#rfContent').innerHTML = `
      <section class="section section--first" id="rfVisao">
        <div class="card rf-hero" id="rfHero">
          <div class="rf-hero__l">
            ${gaugeSvg()}
            <div class="rf-big" id="rfBig">—</div>
            <span class="rf-tag" id="rfTag">—</span>
            <div class="rf-k" id="rfMon"></div>
          </div>
          <div class="rf-scale">
            <p class="rf-frase" id="rfFrase" aria-live="polite"></p>
            <div class="rf-bands">${BANDAS.map(f => `<span style="background:${f[2]}"></span>`).join('')}<span class="rf-mk" id="rfMk" style="left:0%"><b></b></span></div>
            <div class="rf-blab"><span>Baixo · até 39%</span><span>Moderado · 40–59%</span><span>Alto · 60–79%</span><span>Muito alto</span><span>Extremo</span></div>
            <div class="rf-cnt" id="rfCnt"></div>
            ${horas.length ? `<div class="rf-horas"><span id="rfHorasLbl">Leitura das</span><div class="rf-hseg" id="rfHseg" role="tablist" aria-labelledby="rfHorasLbl"><span class="rf-hind" id="rfHind"></span>${horas.map(h => `<button role="tab" data-h="${h}">${hh(h)}</button>`).join('')}</div></div>` : ''}
          </div>
        </div>
        <div class="rf-kpis">
          ${kpi('rfkT', 'fa-solid fa-temperature-three-quarters', 'Temperatura média')}
          ${kpi('rfkU', 'fa-solid fa-droplet', 'Umidade relativa')}
          ${kpi('rfkV', 'fa-solid fa-wind', 'Vento médio')}
          ${kpi('rfkC', 'fa-solid fa-cloud-rain', 'Chuva')}
        </div>
      </section>

      <section class="section" id="rfLocais">
        <div class="section__head"><h2><i class="fa-solid fa-location-dot"></i> Locais em destaque</h2><p id="rfLocaisSub"></p></div>
        <div class="grid grid--2">
          <article class="card"><header class="card__head"><div><h3>Maior risco agora</h3><p class="hint">Empate desfeito pela menor umidade</p></div></header>
            <div class="rf-rank" id="rfTopR"></div></article>
          <article class="card"><header class="card__head"><div><h3>Umidade mais baixa</h3><p class="hint">Locais mais secos na leitura</p></div></header>
            <div class="rf-rank" id="rfTopU"></div></article>
        </div>
      </section>

      <section class="section" id="rfHora">
        <article class="card"><header class="card__head"><div><h3>Risco por hora</h3><p class="hint">Média de todos os locais em cada leitura${horas.length < 3 ? ' · a linha fica completa quando a planilha tiver mais horários no dia' : ''}</p></div></header>
          <div style="position:relative;height:250px"><canvas id="rfChart" role="img" aria-label="Risco médio por hora"></canvas></div></article>
      </section>`;

    const seg = $('#rfHseg');
    if (seg) {
      seg.addEventListener('click', e => { const b = e.target.closest('button[data-h]'); if (b) mostrar(D, +b.dataset.h); });
      seg.addEventListener('keydown', e => {
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        const bs = [...seg.querySelectorAll('button')], i = bs.findIndex(b => +b.dataset.h === HORA);
        const n = bs[Math.max(0, Math.min(bs.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))];
        n.focus(); mostrar(D, +n.dataset.h);
      });
    }
    drawChart(calc(D, null).porHora);
    if (window.Layout) Layout.secoes();
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => mostrar(D, HORA, true));
  };

  // atualiza a visão para a hora escolhida, com animação
  const mostrar = (D, h, primeira = false) => {
    HORA = h;
    const C = calc(D, h);
    const F = faixa(C.risco), iF = BANDAS.indexOf(F);
    const dt = D.meta?.dataLeitura ? D.meta.dataLeitura.split('-').reverse().slice(0, 2).join('/') : '';
    const lh = C.hora != null ? 'leitura das ' + hh(C.hora) : 'última leitura';
    { const rd = $('#rfData'); if (rd) rd.textContent = `${C.atual.length} locais · ${lh}${dt ? ' · ' + dt : ''}`; }
    $('#rfChip span').innerHTML = `${C.hora != null ? '<em>Leitura das </em>' + hh(C.hora) : 'Leitura'}${dt ? ' · ' + dt : ''}`;

    // velocímetro, número e faixa
    $('#rfHero').style.setProperty('--rf-faixa', F[2]);
    $('#rfNeedle').style.transform = `rotate(${(Math.max(0, Math.min(100, C.risco)) - 50) * 1.8}deg)`;
    document.querySelectorAll('.rf-gauge .arc').forEach(p => p.classList.toggle('is-off', +p.dataset.i > iF));
    contar($('#rfBig'), primeira ? 0 : RISCO_ANT, C.risco, primeira ? 1100 : 750);
    RISCO_ANT = C.risco;
    const tag = $('#rfTag'); tag.textContent = F[1]; tag.style.background = F[3]; tag.style.color = F[0] === 40 ? '#B58710' : F[2];
    $('#rfMon').textContent = `${C.atual.length} locais monitorados · ${lh}`;

    // frase (some e volta com o texto novo)
    const fr = $('#rfFrase');
    const texto = `<b>${C.altoOuMais} de ${C.atual.length} locais</b> ${C.altoOuMais === 1 ? 'está' : 'estão'} em risco alto ou acima.${C.uMin ? ` Menor umidade: <b>${nf(C.uMin.umid)}%</b> em ${esc(C.uMin.local)}.` : ''}`;
    if (primeira || semMov()) fr.innerHTML = texto;
    else { fr.classList.add('is-fading'); clearTimeout(fr._t); fr._t = setTimeout(() => { fr.innerHTML = texto; fr.classList.remove('is-fading'); }, 200); }

    // marcador da escala e contagem por faixa
    const mk = $('#rfMk'); mk.style.left = Math.min(99.5, Math.max(0, C.risco)) + '%'; mk.querySelector('b').textContent = nf(C.risco, 1) + '%';
    $('#rfCnt').innerHTML = C.cont.filter(c => c.n > 0 || c.f[0] >= 80).map(c => `<span><i class="rf-sq" style="background:${c.f[2]}"></i><b>${c.n}</b> em ${c.f[1].toLowerCase()}</span>`).join('');

    // pílula da hora
    const seg = $('#rfHseg');
    if (seg) {
      let on = null;
      seg.querySelectorAll('button').forEach(b => { const s = +b.dataset.h === C.hora; b.classList.toggle('is-on', s); b.setAttribute('aria-selected', s); b.tabIndex = s ? 0 : -1; if (s) on = b; });
      const ind = $('#rfHind');
      if (on) {
        if (primeira) ind.style.transition = 'none';
        ind.style.left = on.offsetLeft + 'px'; ind.style.width = on.offsetWidth + 'px';
        if (primeira) { ind.offsetWidth; ind.style.transition = ''; }
        if (seg.scrollWidth > seg.clientWidth) seg.scrollTo({ left: on.offsetLeft - seg.clientWidth / 2 + on.offsetWidth / 2, behavior: primeira ? 'auto' : 'smooth' });
      }
    }

    // clima (pisca o cartão que mudou)
    const setKpi = (id, v, s, alerta) => {
      const el = $('#' + id), vEl = el.querySelector('.v'), sEl = el.querySelector('.s');
      const mudou = !primeira && vEl.innerHTML !== v;
      vEl.innerHTML = v; sEl.textContent = s; sEl.title = s;
      el.classList.toggle('is-alert', !!alerta);
      if (mudou && !semMov()) { el.classList.add('is-flash'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('is-flash'), 450); }
    };
    setKpi('rfkT', `${nf(C.temp, 1)}<small>°C</small>`, C.tMax ? `máxima ${nf(C.tMax.temp)} °C · ${C.tMax.local}` : '—');
    setKpi('rfkU', `${nf(C.umid, 0)}<small>%</small>`, `${C.uMin ? `mínima ${nf(C.uMin.umid)}% · ` : ''}${C.abaixo30 === C.atual.length ? 'abaixo de 30% em todos os locais' : `${C.abaixo30} locais abaixo de 30%`}`, C.umid != null && C.umid < 30);
    setKpi('rfkV', `${nf(C.vento, 0)}<small>km/h</small>`, C.vMax ? `máximo ${nf(C.vMax.vento)} km/h · ${C.vMax.local}` : '—');
    const cm = C.chuvaMax ? C.chuvaMax.chuva : 0;
    setKpi('rfkC', `${nf(cm, cm % 1 ? 1 : 0)}<small>mm</small>`, C.chuvaLocais ? `${C.chuvaLocais} locais com chuva · máx. em ${C.chuvaMax.local}` : 'nenhum local com chuva');

    // rankings da hora
    const row = (i, nome, v, cor, max, suf) => `<div class="rf-row"><span class="n">${i}</span><span class="nm" title="${esc(nome)}">${esc(nome)}</span><span class="rf-bar"><i style="width:${Math.max(2, Math.min(100, v / max * 100))}%;background:${cor}"></i></span><span class="val">${nf(v, v % 1 ? 1 : 0)}${suf}</span></div>`;
    const topRisco = [...C.atual].sort((a, b) => b.risco - a.risco || (a.umid ?? 999) - (b.umid ?? 999)).slice(0, 10);
    const topUmid = [...C.atual].filter(x => x.umid != null).sort((a, b) => a.umid - b.umid || b.risco - a.risco).slice(0, 10);
    $('#rfTopR').innerHTML = topRisco.map((x, i) => row(i + 1, x.local, x.risco, faixa(x.risco)[2], 100, '%')).join('');
    $('#rfTopU').innerHTML = topUmid.map((x, i) => row(i + 1, x.local, x.umid, '#3C7A35', Math.max(30, topUmid.length ? topUmid[topUmid.length - 1].umid : 30), '%')).join('');
    $('#rfLocaisSub').textContent = `${C.atual.length} locais · ${lh}`;

    // destaca a hora no gráfico
    if (chart) {
      const ds = chart.data.datasets[0], i = C.porHora.findIndex(p => p.h === C.hora);
      ds.pointRadius = C.porHora.map((_, k) => (k === i ? 8 : 4));
      ds.pointBackgroundColor = C.porHora.map((_, k) => (k === i ? '#9E1F1F' : '#fff'));
      chart.update(semMov() ? 'none' : undefined);
    }
  };

  const drawChart = porHora => {
    if (!window.Chart) return;
    if (chart) chart.destroy();
    Chart.defaults.font.family = '"Archivo", system-ui, sans-serif';
    chart = new Chart($('#rfChart'), {
      type: 'line',
      data: { labels: porHora.map(p => hh(p.h)), datasets: [{ data: porHora.map(p => Math.round(p.risco * 10) / 10), borderColor: '#9E1F1F', backgroundColor: 'rgba(158,31,31,.08)', fill: true, borderWidth: 2.5, pointRadius: 4, pointBorderColor: '#9E1F1F', pointBorderWidth: 2, pointBackgroundColor: '#fff', pointHoverRadius: 8, tension: .3 }] },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22, left: 10, right: 20 } },
        onClick: (e, els) => { if (els.length && ATUAL) mostrar(ATUAL, porHora[els[0].index].h); },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${nf(c.parsed.y, 1)}% · ${porHora[c.dataIndex].n} locais` } } },
        scales: { y: { min: 0, max: 100, ticks: { stepSize: 20, callback: v => v + '%', color: '#6E7C72' }, grid: { color: '#E6EAE2' } }, x: { offset: true, ticks: { color: '#6E7C72' }, grid: { display: false } } },
      },
      plugins: [
        { id: 'faixas', beforeDatasetsDraw(c) { const { ctx: x, chartArea: a, scales: { y } } = c; FAIXAS.forEach((f, i) => { const hi = i ? FAIXAS[i - 1][0] : 100; x.save(); x.globalAlpha = .08; x.fillStyle = f[2]; x.fillRect(a.left, y.getPixelForValue(hi), a.right - a.left, y.getPixelForValue(f[0]) - y.getPixelForValue(hi)); x.restore(); }); } },
        { id: 'rotulos', afterDatasetsDraw(c) { const x = c.ctx; c.getDatasetMeta(0).data.forEach((p, i) => { x.save(); x.font = '700 12px Archivo, sans-serif'; x.fillStyle = '#18301F'; x.textAlign = 'center'; x.fillText(nf(c.data.datasets[0].data[i], 1) + '%', p.x, p.y - 13); x.restore(); }); } },
      ],
    });
  };

  const csvHora = () => {
    if (!ATUAL) return toast('Sem dados para exportar');
    const C = calc(ATUAL, HORA);
    const q = v => (v == null ? '' : /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v).replace('.', ','));
    const linhas = [['Local', 'Hora', 'Risco (%)', 'Faixa', 'Temperatura (°C)', 'Umidade (%)', 'Vento (km/h)', 'Chuva (mm)'].join(';')]
      .concat([...C.atual].sort((a, b) => b.risco - a.risco).map(x => [x.local, x.hora != null ? hh(x.hora) : '', x.risco, faixa(x.risco)[1], x.temp, x.umid, x.vento, x.chuva].map(q).join(';')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `risco-incendio${C.hora != null ? '-' + hh(C.hora) : ''}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  const vazio = () => {
    $('#rfChip span').textContent = 'sem leitura';
    $('#rfContent').innerHTML = `<div class="card rf-empty"><i class="fa-solid fa-fire"></i><h3>Nenhuma leitura publicada</h3><p>Clique em <b>Importar planilha</b> e escolha a planilha Risco de Incêndio para carregar a página.</p></div>`;
  };

  /* ---------- Dados: publicado x importado neste navegador ---------- */
  let ATUAL = null;
  const store = {
    async get() { try { const s = localStorage.getItem(STORE_KEY); if (!s) return null; const o = JSON.parse(s); return Acesso.isProtected(o) ? await Acesso.decryptJson(o) : null; } catch (e) { return null; } },
    async set(d) { try { localStorage.setItem(STORE_KEY, JSON.stringify(await Acesso.encryptJson(d))); } catch (e) { /* sem storage */ } },
  };
  const setData = D => { ATUAL = D; render(D); };
  const baixarProtegido = async D => {
    try { download('incendio.json', JSON.stringify(await Acesso.encryptJson(D), null, 1)); }
    catch (e) { toast(`<i class="fa-solid fa-triangle-exclamation"></i> ${esc(e.message)}`, 5000); }
  };

  const carregar = async () => {
    let remoto = null;
    try { const r = await fetch('incendio.json', { cache: 'no-store' }); if (r.ok) remoto = (await Acesso.readJson(await r.json())).data; } catch (e) { /* sem arquivo ou chave diferente */ }
    const local = await store.get();
    const usa = local && (!remoto || (local.meta?.importadoEm || '') > (remoto.meta?.importadoEm || '')) ? local : remoto;
    if (!usa || !Array.isArray(usa.leituras) || !usa.leituras.length) return vazio();
    setData(usa);
  };

  const importar = async file => {
    if (window.Layout && !Layout.editor()) return;
    if (!file) return;
    modal('Importando planilha', `<div class="spinner"></div><p style="text-align:center">Lendo <b>${esc(file.name)}</b>…</p>`);
    try {
      let D;
      if (/\.json$/i.test(file.name)) D = (await Acesso.readJson(JSON.parse(await file.text()))).data;
      else {
        if (!window.XLSX) throw new Error('O leitor de planilhas não carregou. Verifique a conexão e tente de novo.');
        D = parsePlanilha(XLSX.read(await file.arrayBuffer(), { type: 'array' }), file.name);
      }
      const C = calc(D);
      modal('Planilha lida', `
        <p><b>${esc(file.name)}</b></p>
        <div class="summary">
          <div><span>Locais</span><b>${C.atual.length}</b></div>
          <div><span>Risco médio</span><b>${nf(C.risco, 1)}%</b></div>
          <div><span>Leituras</span><b>${C.porHora.map(p => hh(p.h)).join(', ') || '—'}</b></div>
        </div>
        <p class="hint" style="margin-top:12px">A página foi atualizada neste navegador. Para publicar para todos, baixe o <b>incendio.json</b> e envie para o GitHub.</p>`,
        [
          { html: '<i class="fa-solid fa-check"></i> Aplicar', onClick: async () => { setData(D); await store.set(D); closeModal(); toast('<i class="fa-solid fa-check"></i> Página atualizada'); } },
          { html: '<i class="fa-solid fa-file-code"></i> Aplicar e baixar incendio.json', primary: true, onClick: async () => { setData(D); await store.set(D); await baixarProtegido(D); closeModal(); toast('<i class="fa-solid fa-lock"></i> incendio.json protegido baixado — envie para o GitHub', 5000); } },
        ]);
    } catch (err) {
      console.error(err);
      modal('Não foi possível ler a planilha', `<p>${esc(err.message || String(err))}</p>`, [{ html: 'Fechar', onClick: closeModal }]);
    }
  };

  /* ---------- Eventos ---------- */
  $('#rfImport').addEventListener('click', () => $('#rfFile').click());
  $('#rfFile').addEventListener('change', e => { importar(e.target.files[0]); e.target.value = ''; });
  $('#rfJson').addEventListener('click', () => (ATUAL ? baixarProtegido(ATUAL) : toast('Sem dados para baixar')));
  $('#rfCsv').addEventListener('click', csvHora);
  $('#btnPrint').addEventListener('click', () => window.print());
  const compacto = () => document.body.classList.toggle('is-scrolled', window.scrollY > 24);
  window.addEventListener('scroll', compacto, { passive: true }); compacto();
  window.addEventListener('resize', () => { const on = document.querySelector('#rfHseg button.is-on'), ind = $('#rfHind'); if (on && ind) { ind.style.left = on.offsetLeft + 'px'; ind.style.width = on.offsetWidth + 'px'; } });
  $('#btnSair').addEventListener('click', () => { Acesso.logout(); try { localStorage.removeItem(STORE_KEY); } catch (e) { /* */ } location.reload(); });
  $('#year').textContent = new Date().getFullYear();
  document.querySelectorAll('.subnav a').forEach(a => a.addEventListener('click', () => { document.querySelectorAll('.subnav a').forEach(b => b.classList.toggle('is-active', b === a)); }));

  Acesso.gate().then(user => { if (window.Layout) Layout.definirUsuario(user); const b = $('#btnSair'); if (b) b.title = `Sair (${user})`; carregar(); });
})();
