/* =========================================================================
   Pluviométrico · Situação das frentes de colheita (paradas e chuva do dia)
   Fonte: Pluviométrico 2026.xlsm, aba PLUVIOMÉTRICO 2026 (formulário do dia):
     J Data de parada · K Hr de parada · P Motivo · Q Previsão de retorno (hora de hoje)
     J/K preenchidas = PARADA; vazias = RODANDO. Chuva do dia = Turno A + B + C do formulário.
   Turnos: A 00h–08h (enviado às 08h) · B 08h–16h (enviado às 16h) · C 16h–24h (fecha o dia à meia-noite).
   Cada sincronização grava uma foto em historico/situacao/AAAA-MM.json; o seletor mostra
   a foto que fecha cada turno (a mais próxima do fim do turno, com 2 h de tolerância depois dele).
   ========================================================================= */
(function () {
  'use strict';
  const S = {};
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const hm = ms => { const m = Math.max(0, Math.round(ms / 6e4)); return `${Math.floor(m / 60)}h${pad(m % 60)}`; };
  const dmy = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  const dmya = d => `${dmy(d)}/${d.getFullYear()}`;
  const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const mm = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const SEM = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const TC = ['#93C5FD', '#3B82F6', '#1E3A8A'];
  const TURNO = { A: { fim: 8, txt: 'Turno A', faixa: '00h–08h' }, B: { fim: 16, txt: 'Turno B', faixa: '08h–16h' }, C: { fim: 24, txt: 'Turno C', faixa: '16h–24h' } };
  const toast = (m, ms) => (window.Painel && Painel.toast ? Painel.toast(m, ms) : null);

  let SIT = null, HIST = null, HPER = '7', TIMER = null, SEL = 'agora';

  /* ---------- turnos: cada foto vai para o turno que ela fecha ---------- */
  // janela de cada turno deslocada 2 h para frente (A 02h–10h, B 10h–18h, C 18h–02h do dia seguinte),
  // porque a planilha do fechamento costuma ser salva logo depois do fim do turno
  const turnoDa = em => {
    const d = new Date(new Date(em) - 2 * 36e5), h = d.getHours();
    const t = h < 8 ? 'A' : h < 16 ? 'B' : 'C';
    const dia = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return { t, dia, fim: new Date(+dia + TURNO[t].fim * 36e5) };
  };
  const fotos = () => {
    const L = (HIST && Array.isArray(HIST.snaps) ? HIST.snaps.slice() : []);
    if (SIT && SIT.em && !L.some(x => x.em === SIT.em)) L.push({ em: SIT.em, data: SIT.data, rows: SIT.rows });
    return L.filter(x => x && x.em && Array.isArray(x.rows) && x.rows.length);
  };
  const momentos = () => {
    const G = new Map();
    fotos().forEach(f => {
      const k = turnoDa(f.em), id = `${ymd(k.dia)}|${k.t}`;
      const dist = Math.abs(new Date(f.em) - k.fim), g = G.get(id);
      if (!g || dist < g.dist) G.set(id, { id, ...k, foto: f, dist });
    });
    return [...G.values()].sort((a, b) => b.fim - a.fim);
  };
  const rotulo = m => `${dmya(m.dia)} · ${TURNO[m.t].txt}`;

  /* ---------- cálculo da situação (de uma foto, num instante) ---------- */
  const calc = (foto, n) => {
    if (!foto || !Array.isArray(foto.rows) || !foto.rows.length) return null;
    const hoje = foto.data || ymd(n);
    const cont = {}; foto.rows.forEach(r => { cont[r.n] = (cont[r.n] || 0) + 1; });
    const rows = foto.rows.map((r, i) => {
      const x = { ...r, i, f: `Frente ${r.n}`, t: (r.t || [0, 0, 0]), stop: !!r.p };
      x.mm = x.t.reduce((s, v) => s + (Number(v) || 0), 0);
      x.fz = String(r.faz || '').replace(/^Faz\.\s*/, '');
      x.curto = `F${r.n}${cont[r.n] > 1 ? ' · ' + x.fz.slice(0, 4) + '.' : ''}`;
      if (x.stop) {
        x.pd = new Date(r.p); x.dur = n - x.pd;
        if (r.ret) { x.rd = new Date(`${hoje}T${r.ret}`); x.left = x.rd - n; }
      }
      return x;
    }).sort((a, b) => a.n - b.n || a.i - b.i);
    const nums = [...new Set(rows.map(r => r.n))];
    const stopN = nums.filter(x => rows.filter(r => r.n === x).every(r => r.stop)), runN = nums.filter(x => !stopN.includes(x));
    const perF = nums.map(x => { const a = rows.filter(r => r.n === x); return { n: x, mm: a.reduce((s, r) => s + r.mm, 0) / a.length }; });
    const wet = perF.filter(x => x.mm > 0), avg = wet.length ? wet.reduce((s, x) => s + x.mm, 0) / wet.length : 0;
    const mx = perF.reduce((a, x) => (x.mm > a.mm ? x : a), perF[0]);
    const st = rows.filter(r => r.stop), comRet = st.filter(r => r.rd);
    const cedo = l => l.length ? l.reduce((a, r) => (r.rd < a.rd ? r : a), l[0]) : null;
    const prox = cedo(comRet.filter(r => r.left >= 0)) || cedo(comRet);
    return { n, hoje, rows, nums, stopN, runN, wet, avg, mx, st, prox, em: foto.em ? new Date(foto.em) : null };
  };
  // o que está selecionado: "agora" (última planilha, tempos contados até este minuto) ou o fechamento de um turno
  const atual = () => {
    const agora = new Date();
    if (SEL !== 'agora') {
      const m = momentos().find(x => x.id === SEL);
      if (m) {
        const em = new Date(m.foto.em), n = em > m.fim ? em : new Date(Math.min(+m.fim, +agora));
        const d = calc(m.foto, n); if (d) { d.mom = m; return d; }
      }
      SEL = 'agora';
    }
    const f = SIT || fotos().sort((a, b) => b.em.localeCompare(a.em))[0];
    return calc(f, agora);
  };

  /* ---------- folha (a mesma que vira imagem para o grupo) ---------- */
  const folha = d => {
    const max = Math.max(1, ...d.rows.map(r => r.mm)), H = 130, y = v => v / max * H;
    const salvo = d.em;
    const ret = r => (r.rd ? `<b>${dmy(r.rd)} · ${hhmm(r.rd)}</b>${r.left >= 0 ? `<small>em ${hm(r.left)}</small>` : `<small class="late">atrasado ${hm(-r.left)}</small>`}` : `<b>${esc(r.retTxt || 'sem previsão')}</b>`);
    return `<div class="st-folha" id="stFolha">
      <div class="st-hd">
        <div class="st-brand"><img src="logo-icon.png" alt="" width="44" height="46"><div><b>Bioenergética Aroeira</b><small>COA · Centro de Operações Agrícolas</small></div></div>
        <div class="st-ttl"><h2>Situação das frentes de colheita</h2><p>Relatório pluviométrico · paradas e chuva do dia</p></div>
        <div class="st-when"><small>${d.mom ? `Fechamento ${TURNO[d.mom.t].txt} (${TURNO[d.mom.t].faixa})` : 'Situação em'}</small><b>${d.mom && +d.n === +d.mom.fim && d.mom.t === 'C' ? `${dmya(d.mom.dia)} · 24:00` : `${dmya(d.n)} · ${hhmm(d.n)}`}</b><span class="st-live${d.mom ? ' st-fixo' : ''}"><i></i>${salvo ? `planilha salva ${dmy(salvo)} · ${hhmm(salvo)}` : 'atualizando ao vivo'}</span></div>
      </div>
      <div class="st-kpis">
        <div class="st-kpi g"><small>Rodando</small><div><b>${d.runN.length}</b><span>de ${d.nums.length} frentes</span></div><p>${d.runN.length ? d.runN.map(x => 'Frente ' + x).join(' · ') : 'nenhuma frente rodando'}</p></div>
        <div class="st-kpi s"><small>Chuva média do dia</small><div><b>${mm(d.avg)}</b><span>mm</span></div><p>${d.wet.length ? `média de ${d.wet.length} ${d.wet.length === 1 ? 'frente' : 'frentes'} com chuva · máx. ${mm(d.mx.mm)} mm (Frente ${d.mx.n})` : 'sem chuva registrada no dia'}</p></div>
        <div class="st-kpi"><small>Próximo retorno previsto</small><div><b>${d.prox ? hhmm(d.prox.rd) : '—'}</b><span>${d.prox ? `hoje, ${dmy(d.prox.rd)}` : ''}</span></div><p>${d.prox ? `${esc(d.prox.f)} · ${esc(d.prox.faz)}${d.prox.left < 0 ? ` <small class="st-late">atrasado ${hm(-d.prox.left)}</small>` : ` · em ${hm(d.prox.left)}`}` : d.st.length ? 'sem horário de retorno informado' : 'todas as frentes rodando'}</p></div>
      </div>
      <div class="st-pv"><div class="st-h"><h3>Chuva do dia por frente e turno (mm)</h3><div class="st-lg"><span><i style="background:${TC[0]}"></i>Turno A</span><span><i style="background:${TC[1]}"></i>Turno B</span><span><i style="background:${TC[2]}"></i>Turno C</span></div></div>
        <div class="st-plot" style="height:${H + 26}px">${d.rows.map(r => `<div class="st-c" title="${esc(`${r.f} · ${r.faz}\nA ${mm(r.t[0])} · B ${mm(r.t[1])} · C ${mm(r.t[2])} mm`)}"><b>${mm(r.mm)}</b><div class="st-stk">${r.t.map((v, k) => (v ? `<i style="height:${y(v).toFixed(1)}px;background:${TC[k]}"></i>` : '')).join('')}</div></div>`).join('')}
          ${d.wet.length ? '' : '<div class="st-semchuva">Sem chuva registrada hoje até agora</div>'}
          ${d.avg > 0 ? `<div class="st-avg" style="bottom:${y(d.avg).toFixed(1)}px"><span>média ${mm(d.avg)} mm</span></div>` : ''}</div>
        <div class="st-xl">${d.rows.map(r => `<div><b>${esc(r.curto)}</b><span><i class="st-dot${r.stop ? '' : ' ok'}"></i>${r.stop ? 'parada' : 'rodando'}</span></div>`).join('')}</div></div>
      <div class="st-tbl"><table><thead><tr><th>Frente</th><th>Situação</th><th>Motivo</th><th>Chuva A · B · C</th><th>Total</th><th>Parada desde</th><th>Tempo parado</th><th>Retorno previsto</th></tr></thead><tbody>
        ${d.rows.map(r => `<tr><td class="st-fr"><b>${esc(r.f)}</b><small>${esc(r.cod)} · ${esc(r.faz)}</small></td>
          <td>${r.stop ? '<span class="st-farol"><span class="st-lamp"><i class="r"></i><i></i><i></i></span>PARADA</span>' : '<span class="st-farol ok"><span class="st-lamp"><i></i><i></i><i class="g"></i></span>RODANDO</span>'}</td>
          <td${r.stop ? '' : ' class="st-mute"'}>${r.stop ? esc(r.mot) : '—'}</td>
          <td class="st-mute">${r.t.map(mm).join(' · ')}</td><td class="st-mm">${mm(r.mm)} mm</td>
          <td${r.stop ? '' : ' class="st-mute"'}>${r.stop ? `${dmy(r.pd)} · ${hhmm(r.pd)}` : '—'}</td>
          <td class="${r.stop ? 'st-dur' : 'st-mute'}">${r.stop ? hm(r.dur) : '—'}</td>
          <td class="st-ret">${r.stop ? ret(r) : '<span class="st-op">Em operação</span>'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="st-foot"><span>Fonte: Pluviométrico 2026 — aba PLUVIOMÉTRICO 2026 (paradas e chuva por turno A, B e C)</span><span>Previsões de retorno referentes a ${d.hoje.split('-').reverse().slice(0, 2).join('/')}</span></div>
    </div>`;
  };

  /* ---------- imagem (html2canvas, carregado só quando usado) ---------- */
  let h2c = null;
  const carregaH2C = () => h2c || (h2c = new Promise((ok, nok) => {
    if (window.html2canvas) return ok(window.html2canvas);
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = () => ok(window.html2canvas); s.onerror = () => { h2c = null; nok(new Error('não consegui carregar o gerador de imagem')); }; document.head.appendChild(s);
  }));
  const gerarPng = async () => {
    const H = await carregaH2C(), el = $('#stFolha');
    const box = $('#stFolhaBox'), pal = box.parentElement, z = box.style.zoom, fl = pal.classList.contains('st-fluido');
    box.style.zoom = ''; pal.classList.remove('st-fluido'); el.classList.add('st-captura');
    try { const cv = await H(el, { scale: 2, backgroundColor: '#FFFFFF', useCORS: true, logging: false }); return await new Promise(ok => cv.toBlob(ok, 'image/png')); }
    finally { el.classList.remove('st-captura'); box.style.zoom = z; pal.classList.toggle('st-fluido', fl); }
  };
  const nomeArq = d => `situacao-frentes-${d.mom ? `${ymd(d.mom.dia)}-turno-${d.mom.t}` : `${ymd(d.n)}-${hhmm(d.n).replace(':', 'h')}`}.png`;
  const baixar = (blob, nome) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); };
  const copiarImagem = async () => {
    const d = atual(); if (!d) return;
    const p = gerarPng();
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('sem suporte');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': p })]);
      toast('<i class="fa-solid fa-circle-check"></i> Imagem copiada · cole no grupo do WhatsApp (Ctrl+V)', 4500);
    } catch (e) {
      try { baixar(await p, nomeArq(d)); toast('<i class="fa-solid fa-download"></i> O navegador não deixou copiar a imagem · baixei o PNG para você anexar', 5000); }
      catch (e2) { toast('Não foi possível gerar a imagem: ' + esc(e2.message || e2), 5000); }
    }
  };
  const baixarPng = async () => { const d = atual(); if (!d) return; try { baixar(await gerarPng(), nomeArq(d)); } catch (e) { toast('Não foi possível gerar a imagem: ' + esc(e.message || e), 5000); } };

  /* ---------- histórico das paradas (a partir das fotos de cada sincronização) ---------- */
  const eventos = () => {
    const snaps = (HIST && Array.isArray(HIST.snaps) ? HIST.snaps : []).slice().sort((a, b) => a.em.localeCompare(b.em));
    const ev = new Map();
    snaps.forEach((s, i) => (s.rows || []).forEach(r => {
      if (!r.p) return;
      const k = `${r.n}|${r.cod}|${r.p}`;
      const e = ev.get(k) || { k, n: r.n, cod: r.cod, faz: r.faz, ini: new Date(r.p), visto: i };
      e.mot = r.mot; e.visto = i; e.ret = r.ret ? new Date(`${s.data}T${r.ret}`) : null; e.retTxt = r.retTxt;
      ev.set(k, e);
    }));
    const agora = new Date();
    return [...ev.values()].map(e => {
      if (e.visto < snaps.length - 1) {
        const visto = new Date(snaps[e.visto].em), sumiu = new Date(snaps[e.visto + 1].em);
        // voltou entre duas fotos: usa a previsão de retorno se ela cair nesse intervalo, senão a foto em que sumiu
        if (e.ret && e.ret >= visto && e.ret <= sumiu) { e.fim = e.ret; e.est = 'pela previsão de retorno'; } else { e.fim = sumiu; e.est = 'pela sincronização seguinte'; }
      } else e.fim = null;
      e.dur = (e.fim || agora) - e.ini;
      return e;
    }).sort((a, b) => b.ini - a.ini);
  };
  const montarHist = () => {
    const el = $('#stHist'); if (!el) return;
    const E = eventos();
    if (!E.length) { el.innerHTML = `<p class="st-vazio"><i class="fa-regular fa-clock"></i> O histórico de paradas começa a ser gravado a partir da próxima sincronização: cada vez que a planilha for salva e sincronizada, o painel guarda a situação daquele momento.</p>`; return; }
    const agora = new Date(), ini = HPER === 'safra' ? new Date(0) : new Date(agora - (+HPER) * 864e5);
    const sobre = e => Math.max(0, Math.min(+(e.fim || agora), +agora) - Math.max(+e.ini, +ini));
    const P = E.filter(e => sobre(e) > 0);
    const porF = new Map(); P.forEach(e => { const x = porF.get(e.n) || { n: e.n, h: 0, q: 0 }; x.h += sobre(e) / 36e5; x.q++; porF.set(e.n, x); });
    const F = [...porF.values()].sort((a, b) => a.n - b.n), mx = Math.max(1, ...F.map(x => x.h)), tot = F.reduce((s, x) => s + x.h, 0);
    const maior = F.slice().sort((a, b) => b.h - a.h)[0];
    el.innerHTML = `
      <div class="st-hk"><div><small>Paradas no período</small><b>${P.length}</b></div><div><small>Horas paradas (soma das frentes)</small><b>${tot.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} h</b></div><div><small>Frente com mais horas paradas</small><b>${maior ? `Frente ${maior.n} · ${Math.round(maior.h)} h` : '—'}</b></div><div><small>Em aberto agora</small><b>${P.filter(e => !e.fim).length}</b></div></div>
      <div class="st-hg">
        <div class="st-hb">${F.map(x => `<div class="st-hl"><span>Frente ${x.n}</span><span class="st-ht"><i style="width:${(x.h / mx * 100).toFixed(1)}%"></i></span><b>${Math.round(x.h)} h</b><small>${x.q} ${x.q === 1 ? 'parada' : 'paradas'}</small></div>`).join('') || '<p class="hint">Nenhuma parada no período.</p>'}</div>
        <div class="st-ev"><table><thead><tr><th>Frente</th><th>Fazenda</th><th>Motivo</th><th>Parou</th><th>Voltou</th><th>Duração</th></tr></thead><tbody>
          ${P.map(e => `<tr><td><b>Frente ${e.n}</b></td><td>${esc(e.cod)} · ${esc(e.faz)}</td><td>${esc(e.mot)}</td><td>${dmy(e.ini)} · ${hhmm(e.ini)}</td>
            <td>${e.fim ? `<span title="horário estimado ${esc(e.est)}">≈ ${dmy(e.fim)} · ${hhmm(e.fim)}</span>` : '<span class="st-aberto">parada agora</span>'}</td><td class="st-dur">${hm(e.dur)}</td></tr>`).join('')}
        </tbody></table></div>
      </div>
      <p class="st-nota"><i class="fa-solid fa-circle-info"></i> O retorno é estimado entre duas sincronizações: vale a previsão de retorno informada, se ela cair nesse intervalo. Quanto mais vezes a planilha for sincronizada, mais preciso fica.</p>`;
  };

  /* ---------- seletor de data · turno ---------- */
  const opcoes = () => {
    const f = SIT || fotos().sort((a, b) => b.em.localeCompare(a.em))[0];
    const ag = f && f.em ? ` (planilha ${hhmm(new Date(f.em))})` : '';
    return [{ id: 'agora', txt: `Agora${ag}` }, ...momentos().map(m => ({ id: m.id, txt: rotulo(m) }))];
  };
  const montarSel = () => {
    const sel = $('#stSel'); if (!sel) return;
    const O = opcoes(); if (!O.some(o => o.id === SEL)) SEL = 'agora';
    sel.innerHTML = O.map(o => `<option value="${o.id}"${o.id === SEL ? ' selected' : ''}>${esc(o.txt)}</option>`).join('');
    const i = O.findIndex(o => o.id === SEL);
    $('#stAnt').disabled = i >= O.length - 1; $('#stProx').disabled = i <= 0;
  };
  const passo = k => { const O = opcoes(), i = O.findIndex(o => o.id === SEL), j = Math.max(0, Math.min(O.length - 1, i + k)); SEL = O[j].id; montarSel(); desenhar(); };

  /* ---------- montagem ---------- */
  // a folha tem 1120 px (tamanho da imagem) e é mostrada reduzida; em tela estreita vira layout fluido
  const ajustar = () => {
    const box = $('#stFolhaBox'), pal = box && box.parentElement; if (!pal) return;
    const w = pal.clientWidth, z = Math.min(0.76, w / 1120);
    pal.classList.toggle('st-fluido', z < 0.6);
    box.style.zoom = z < 0.6 ? '' : z.toFixed(3);
  };
  const desenhar = () => { const box = $('#stFolhaBox'), d = atual(); if (box && d) { box.innerHTML = folha(d); ajustar(); } };
  const montar = () => {
    const el = $('#sitConteudo'); if (!el) return;
    if (!atual()) { el.innerHTML = ''; return; }
    if (!el.querySelector('#stFolhaBox')) {
      el.innerHTML = `<section class="section st-sec" id="stSituacao" data-nome="Situação das frentes">
        <h2 class="tp-tit"><i class="fa-solid fa-traffic-light"></i>Situação das frentes de colheita</h2>
        <div class="st-bar">
          <div class="st-nav"><button type="button" id="stAnt" aria-label="Turno anterior"><i class="fa-solid fa-chevron-left"></i></button><label class="st-selw"><select id="stSel" aria-label="Data e turno"></select><i class="fa-solid fa-chevron-down"></i></label><button type="button" id="stProx" aria-label="Próximo turno"><i class="fa-solid fa-chevron-right"></i></button></div>
          <div class="st-acoes"><button type="button" class="st-bt" id="stImg"><i class="fa-regular fa-copy"></i>Copiar imagem</button><button type="button" class="st-bt pri" id="stPng"><i class="fa-solid fa-download"></i>Baixar imagem</button></div>
        </div>
        <div class="st-palco"><div id="stFolhaBox"></div></div>
        <article class="card st-card"><div class="st-hh"><div><h3><i class="fa-solid fa-clock-rotate-left"></i>Histórico de paradas</h3><p class="hint">Montado com a situação gravada em cada sincronização da planilha</p></div>
          <div class="hseg" id="stPer"><button type="button" data-v="7" class="is-on">7 dias</button><button type="button" data-v="30">30 dias</button><button type="button" data-v="safra">Safra</button></div></div>
          <div id="stHist"></div></article>
      </section>`;
      window.addEventListener('resize', ajustar);
      $('#stImg').addEventListener('click', copiarImagem);
      $('#stPng').addEventListener('click', baixarPng);
      $('#stSel').addEventListener('change', e => { SEL = e.target.value; montarSel(); desenhar(); });
      $('#stAnt').addEventListener('click', () => passo(1));
      $('#stProx').addEventListener('click', () => passo(-1));
      $$('#stPer button').forEach(b => b.addEventListener('click', () => { HPER = b.dataset.v; $$('#stPer button').forEach(x => x.classList.toggle('is-on', x === b)); montarHist(); }));
      montarHist();
      if (window.Layout && Layout.pagina && Layout.pagina() === 'pluvio') Layout.secoes();
    }
    montarSel(); desenhar();
  };
  const visivel = () => document.visibilityState === 'visible' && window.Layout && Layout.pagina && Layout.pagina() === 'pluvio';

  S.iniciar = async sit => {
    SIT = sit || null; montar();
    if (!TIMER) TIMER = setInterval(() => { if (SEL === 'agora' && visivel()) desenhar(); }, 30000);
    try { if (window.Hist && Hist.lerDividido) HIST = await Hist.lerDividido('situacao'); } catch (e) { HIST = null; }
    montar(); montarHist();
  };
  S.definir = sit => { SIT = sit || null; montar(); };
  S.definirHist = h => { HIST = h; montar(); montarHist(); };
  S.momentos = momentos;
  window.Situacao = S;
})();
