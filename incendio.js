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
  const calc = D => {
    const L = D.leituras;
    // leitura mais recente de cada local
    const ult = new Map();
    L.forEach(x => { const p = ult.get(x.local); if (!p || (x.hora ?? -1) >= (p.hora ?? -1)) ult.set(x.local, x); });
    const atual = [...ult.values()];
    const horas = [...new Set(L.map(x => x.hora).filter(h => h != null))].sort((a, b) => a - b);
    const porHora = horas.map(h => { const s = L.filter(x => x.hora === h); return { h, risco: avg(s, x => x.risco), n: s.length }; });
    const ultHora = horas.length ? horas[horas.length - 1] : null;
    const maxBy = (a, f) => a.reduce((m, x) => (f(x) != null && (m == null || f(x) > f(m)) ? x : m), null);
    const minBy = (a, f) => a.reduce((m, x) => (f(x) != null && (m == null || f(x) < f(m)) ? x : m), null);
    const cont = FAIXAS.map(f => ({ f, n: atual.filter(x => faixa(x.risco) === f).length }));
    return {
      atual, porHora, ultHora,
      risco: avg(atual, x => x.risco),
      temp: avg(atual.filter(x => x.temp != null), x => x.temp), tMax: maxBy(atual, x => x.temp),
      umid: avg(atual.filter(x => x.umid != null), x => x.umid), uMin: minBy(atual, x => x.umid),
      abaixo30: atual.filter(x => x.umid != null && x.umid < 30).length,
      vento: avg(atual.filter(x => x.vento != null), x => x.vento), vMax: maxBy(atual, x => x.vento),
      chuvaLocais: atual.filter(x => x.chuva > 0).length, chuvaMax: maxBy(atual, x => x.chuva),
      cont,
    };
  };

  /* ---------- Renderização ---------- */
  let chart = null;
  const render = D => {
    const C = calc(D);
    const F = faixa(C.risco);
    const dt = D.meta?.dataLeitura ? D.meta.dataLeitura.split('-').reverse().slice(0, 2).join('/') : '';
    $('#rfChip span').textContent = `${C.ultHora != null ? 'Leitura das ' + hh(C.ultHora) : 'Leitura'}${dt ? ' · ' + dt : ''}`;
    $('#rfFonte').textContent = `Fonte: ${D.meta?.arquivo || 'planilha Risco de Incêndio'} · importado em ${new Date(D.meta?.importadoEm || Date.now()).toLocaleString('pt-BR')}`;
    const row = (i, nome, v, cor, max, suf) => `<div class="rf-row"><span class="n">${i}</span><span class="nm" title="${esc(nome)}">${esc(nome)}</span><span class="rf-bar"><i style="width:${Math.max(2, Math.min(100, v / max * 100))}%;background:${cor}"></i></span><span class="val">${nf(v, v % 1 ? 1 : 0)}${suf}</span></div>`;
    const topRisco = [...C.atual].sort((a, b) => b.risco - a.risco || (a.umid ?? 999) - (b.umid ?? 999)).slice(0, 10);
    const topUmid = [...C.atual].filter(x => x.umid != null).sort((a, b) => a.umid - b.umid || b.risco - a.risco).slice(0, 10);
    const maiores = C.cont.filter(c => c.n > 0 || c.f[0] >= 60);
    $('#rfContent').innerHTML = `
      <section class="section section--first" id="rfVisao">
        <div class="card rf-hero">
          <div class="rf-hero__l" style="border-left-color:${F[2]}">
            <div class="rf-k">Risco médio de incêndio agora</div>
            <div style="display:flex;align-items:baseline;gap:12px;margin:8px 0 10px;flex-wrap:wrap"><span class="rf-big">${nf(C.risco, 1)}%</span><span class="rf-tag" style="background:${F[3]};color:${F[2]}">${F[1]}</span></div>
            <div class="rf-k">${C.atual.length} locais monitorados${C.ultHora != null ? ' · leitura das ' + hh(C.ultHora) : ''}</div>
          </div>
          <div class="rf-scale">
            <div class="rf-k">Classificação do risco</div>
            <div class="rf-bands">${[...FAIXAS].reverse().map(f => `<span style="background:${f[2]}"></span>`).join('')}<span class="rf-mk" style="left:${Math.min(99.5, C.risco)}%"><b>${nf(C.risco, 1)}%</b></span></div>
            <div class="rf-blab"><span>Baixo · até 39%</span><span>Moderado · 40–59%</span><span>Alto · 60–79%</span><span>Muito alto</span><span>Extremo</span></div>
            <div class="rf-cnt">${maiores.map(c => `<span><i class="rf-sq" style="background:${c.f[2]}"></i><b>${c.n}</b> em ${c.f[1].toLowerCase()}</span>`).join('')}</div>
          </div>
        </div>
        <div class="rf-kpis">
          <div class="rf-kpi"><div class="rf-k"><i class="fa-solid fa-temperature-three-quarters"></i> Temperatura média</div><div class="v">${nf(C.temp, 1)} °C</div><div class="s">${C.tMax ? `máxima ${nf(C.tMax.temp)} °C · ${esc(C.tMax.local)}` : '—'}</div></div>
          <div class="rf-kpi ${C.umid != null && C.umid < 30 ? 'is-alert' : ''}"><div class="rf-k"><i class="fa-solid fa-droplet"></i> Umidade relativa</div><div class="v">${nf(C.umid, 0)}%</div><div class="s">${C.uMin ? `mínima ${nf(C.uMin.umid)}% · ` : ''}${C.abaixo30 === C.atual.length ? 'abaixo de 30% em todos os locais' : `${C.abaixo30} locais abaixo de 30%`}</div></div>
          <div class="rf-kpi"><div class="rf-k"><i class="fa-solid fa-wind"></i> Vento médio</div><div class="v">${nf(C.vento, 0)} km/h</div><div class="s">${C.vMax ? `máximo ${nf(C.vMax.vento)} km/h · ${esc(C.vMax.local)}` : '—'}</div></div>
          <div class="rf-kpi"><div class="rf-k"><i class="fa-solid fa-cloud-rain"></i> Chuva</div><div class="v">${nf(C.chuvaMax ? C.chuvaMax.chuva : 0, C.chuvaMax && C.chuvaMax.chuva % 1 ? 1 : 0)} mm</div><div class="s">${C.chuvaLocais ? `${C.chuvaLocais} locais com chuva · máx. em ${esc(C.chuvaMax.local)}` : 'nenhum local com chuva'}</div></div>
        </div>
      </section>

      <section class="section" id="rfLocais">
        <div class="section__head"><h2><i class="fa-solid fa-location-dot"></i> Locais em destaque</h2><p>${C.atual.length} locais${C.ultHora != null ? ' na leitura das ' + hh(C.ultHora) : ''}</p></div>
        <div class="grid grid--2">
          <article class="card"><header class="card__head"><div><h3>Maior risco agora</h3><p class="hint">Empate desfeito pela menor umidade</p></div></header>
            <div class="rf-rank">${topRisco.map((x, i) => row(i + 1, x.local, x.risco, faixa(x.risco)[2], 100, '%')).join('')}</div></article>
          <article class="card"><header class="card__head"><div><h3>Umidade mais baixa</h3><p class="hint">Locais mais secos na leitura</p></div></header>
            <div class="rf-rank">${topUmid.map((x, i) => row(i + 1, x.local, x.umid, '#3C7A35', 30, '%')).join('')}</div></article>
        </div>
      </section>

      <section class="section" id="rfHora">
        <article class="card"><header class="card__head"><div><h3>Risco por hora</h3><p class="hint">Média de todos os locais em cada leitura${C.porHora.length < 3 ? ' · a linha fica completa quando a planilha tiver mais horários no dia' : ''}</p></div></header>
          <div style="position:relative;height:250px"><canvas id="rfChart" role="img" aria-label="Risco médio por hora"></canvas></div></article>
      </section>`;
    drawChart(C.porHora);
  };

  const drawChart = porHora => {
    if (!window.Chart) return;
    if (chart) chart.destroy();
    const make = () => {
      Chart.defaults.font.family = '"Archivo", system-ui, sans-serif';
      chart = new Chart($('#rfChart'), {
        type: 'line',
        data: { labels: porHora.map(p => hh(p.h)), datasets: [{ data: porHora.map(p => Math.round(p.risco * 10) / 10), borderColor: '#9E1F1F', backgroundColor: 'rgba(158,31,31,.08)', fill: true, borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: '#9E1F1F', tension: .3 }] },
        options: {
          responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22, left: 10, right: 20 } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${nf(c.parsed.y, 1)}% · ${porHora[c.dataIndex].n} locais` } } },
          scales: { y: { min: 0, max: 100, ticks: { stepSize: 20, callback: v => v + '%', color: '#6E7C72' }, grid: { color: '#E6EAE2' } }, x: { offset: true, ticks: { color: '#6E7C72' }, grid: { display: false } } },
        },
        plugins: [
          { id: 'faixas', beforeDatasetsDraw(c) { const { ctx: x, chartArea: a, scales: { y } } = c; FAIXAS.forEach((f, i) => { const hi = i ? FAIXAS[i - 1][0] : 100; x.save(); x.globalAlpha = .08; x.fillStyle = f[2]; x.fillRect(a.left, y.getPixelForValue(hi), a.right - a.left, y.getPixelForValue(f[0]) - y.getPixelForValue(hi)); x.restore(); }); } },
          { id: 'rotulos', afterDatasetsDraw(c) { const x = c.ctx; c.getDatasetMeta(0).data.forEach((p, i) => { x.save(); x.font = '700 12px Archivo, sans-serif'; x.fillStyle = '#18301F'; x.textAlign = 'center'; x.fillText(nf(c.data.datasets[0].data[i], 1) + '%', p.x, p.y - 12); x.restore(); }); } },
        ],
      });
    };
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(make);
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
  $('#btnPrint').addEventListener('click', () => window.print());
  $('#btnSair').addEventListener('click', () => { Acesso.logout(); try { localStorage.removeItem(STORE_KEY); } catch (e) { /* */ } location.reload(); });
  $('#year').textContent = new Date().getFullYear();
  document.querySelectorAll('.subnav a').forEach(a => a.addEventListener('click', () => { document.querySelectorAll('.subnav a').forEach(b => b.classList.toggle('is-active', b === a)); }));

  Acesso.gate().then(user => { const b = $('#btnSair'); if (b) b.title = `Sair (${user})`; carregar(); });
})();
