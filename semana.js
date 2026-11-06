/* =========================================================================
   Histórico · Resumo da semana (segunda a domingo) — maiores impactos por frente
   Fontes (publicadas pela sincronização da pasta Histórico):
     historico/analise-coa.json    números diários da análise COA por frente
     historico/resumo-semanal.json texto da semana, escrito toda segunda-feira
   ========================================================================= */
(function () {
  'use strict';
  const S = {};
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v), 0);
  const brC = iso => iso.split('-').reverse().slice(0, 2).join('/');
  const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const segunda = iso => { const d = new Date(iso + 'T12:00:00'); const w = (d.getDay() + 6) % 7; return addDias(iso, -w); };
  const DSEM = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  const ST = { ok: ['#3C8A44', 'dentro'], warn: ['#D9A21B', 'atenção'], bad: ['#C9473A', 'crítico'] };
  const IND = { 'Aguardando Transbordo': 'Colhedoras aguardando transbordo', 'Aguardando Caminhão - Transbordo': 'Transbordos aguardando caminhão', 'Aguardando Colhedora': 'Transbordos aguardando colhedora', 'Equipamento em Fila': 'Transbordos em fila' };
  const soma = (a, f) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);

  let COA = null, RES = null, SEM = null, MONT = false;

  const semanas = () => {
    const ds = (COA && Array.isArray(COA.dias) ? COA.dias : []).map(d => d.data).filter(Boolean).sort();
    if (!ds.length) return [];
    const ult = ds[ds.length - 1], set = new Set(ds.map(segunda));
    return [...set].sort().map(ini => ({ ini, fim: addDias(ini, 6), completa: addDias(ini, 6) <= ult, dias: ds.filter(d => d >= ini && d <= addDias(ini, 6)).length }));
  };

  // números da semana por frente
  const calcular = sem => {
    const dias = COA.dias.filter(d => d.data >= sem.ini && d.data <= sem.fim);
    const nomes = [...new Set(dias.flatMap(d => Object.keys(d.frentes || {})))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
    return nomes.map(f => {
      const L = dias.map(d => ({ d: d.data, v: (d.frentes || {})[f] })).filter(x => x.v);
      const comEnt = L.filter(x => Number.isFinite(x.v.entrega) && Number.isFinite(x.v.meta) && x.v.meta > 0);
      const ent = soma(comEnt, x => x.v.entrega), meta = soma(comEnt, x => x.v.meta);
      const tl = {}; L.forEach(x => Object.entries(x.v.timeline || {}).forEach(([k, t]) => { tl[k] = (tl[k] || 0) + ((t && t.horasAcimaMeta) || 0); }));
      const ofs = Object.entries(tl).filter(([, h]) => h > 0).sort((a, b) => b[1] - a[1]);
      const sinal = L.filter(x => ((x.v.colhedora || {}).aguardTransbordoPct || 0) > 10).length;
      const mlp = soma(L, x => soma(['colhedora', 'transbordo'], t => ((x.v.motorLigadoParado || {})[t] || {}).horas));
      const falta = soma(L, x => ((x.v.aguardandoCaminhao || {}).faltaCaminhao || []).length);
      const div = soma(L, x => ((x.v.aguardandoCaminhao || {}).possivelDivergencia || []).length);
      const dc = L.map(x => (x.v.colhedora || {}).disponibilidade).filter(Number.isFinite), dt = L.map(x => (x.v.transbordo || {}).disponibilidade).filter(Number.isFinite);
      const st = {}; L.forEach(x => { st[x.d] = { s: x.v.status, ent: x.v.entrega, meta: x.v.meta }; });
      return { f, n: L.length, nEnt: comEnt.length, ent, meta, dif: comEnt.length ? ent - meta : null, pct: meta ? ent / meta * 100 : null, ofs, sinal, mlp, falta, div, dispC: dc.length ? soma(dc, x => x) / dc.length : null, dispT: dt.length ? soma(dt, x => x) / dt.length : null, st, ruins: L.filter(x => x.v.status === 'bad').length };
    });
  };

  const montar = () => {
    const el = $('#semConteudo'); if (!el) return;
    const ws = semanas();
    if (!ws.length) { el.innerHTML = ''; return; }
    if (!SEM || !ws.some(w => w.ini === SEM)) { const c = ws.filter(w => w.completa); SEM = (c.length ? c[c.length - 1] : ws[ws.length - 1]).ini; }
    const w = ws.find(x => x.ini === SEM), i = ws.indexOf(w);
    const F = calcular(w);
    // ordem: maior falta de entrega primeiro; sem entrega, por dias críticos
    F.sort((a, b) => (a.dif == null) - (b.dif == null) || (a.dif ?? 0) - (b.dif ?? 0) || b.ruins - a.ruins);
    const R = RES && Array.isArray(RES.semanas) ? RES.semanas.find(s => s.ini === w.ini) : null;
    const txt = f => (R && Array.isArray(R.frentes) ? R.frentes.find(x => x.frente === f) : null);
    const T = { ent: soma(F, x => x.ent), meta: soma(F, x => x.meta), nEnt: Math.max(0, ...F.map(x => x.nEnt)), acima: F.filter(x => x.dif != null && x.dif >= 0).length, sinal: soma(F, x => x.sinal), mlp: soma(F, x => x.mlp), falta: soma(F, x => x.falta) };
    const pctT = T.meta ? T.ent / T.meta * 100 : null;
    const corPct = p => (p == null ? '#9AA79E' : p >= 100 ? ST.ok[0] : p >= 90 ? ST.warn[0] : ST.bad[0]);
    const mxOf = Math.max(1, ...F.flatMap(x => x.ofs.map(o => o[1])));
    el.innerHTML = `
      <section class="section" id="hSemana" data-nome="Semana">
        <div class="tp-topo sm-topo"><h2 class="tp-tit"><i class="fa-solid fa-calendar-week"></i>Resumo da semana</h2>
          <div class="sm-nav"><button type="button" class="ib" data-p="-1" ${i ? '' : 'disabled'} aria-label="Semana anterior"><i class="fa-solid fa-chevron-left"></i></button>
            <select id="smSel" aria-label="Semana">${ws.map(x => `<option value="${x.ini}"${x.ini === w.ini ? ' selected' : ''}>${brC(x.ini)} a ${brC(x.fim)}${x.completa ? '' : ' · em andamento'}</option>`).join('')}</select>
            <button type="button" class="ib" data-p="1" ${i < ws.length - 1 ? '' : 'disabled'} aria-label="Próxima semana"><i class="fa-solid fa-chevron-right"></i></button></div></div>
        <article class="card sm-res">
          <div class="sm-k">
            <div><span>Entrega x meta</span><b style="color:${corPct(pctT)}">${pctT == null ? '—' : nf(pctT, 1) + '%'}</b><small>${T.meta ? `${nf(T.ent)} de ${nf(T.meta)} t · ${sg(T.ent - T.meta)} t` : 'sem entrega lida'}${T.nEnt && T.nEnt < w.dias ? ` · ${T.nEnt} de ${w.dias} dias` : ''}</small></div>
            <div><span>Frentes na meta</span><b>${T.acima}<em> de ${F.filter(x => x.dif != null).length || F.length}</em></b><small>entrega maior ou igual à meta</small></div>
            <div><span>Sinal de atenção</span><b>${T.sinal}<em> dias</em></b><small>colhedoras aguardando transbordo &gt; 10%</small></div>
            <div><span>Motor ligado parado</span><b>${nf(T.mlp)}<em> h</em></b><small>colhedoras + transbordos na semana</small></div>
            <div><span>Falta de caminhão</span><b>${T.falta}<em> horários</em></b><small>colhedora e transbordo esperando juntos</small></div>
          </div>
          ${R && R.resumo ? `<p class="sm-txt"><i class="fa-regular fa-lightbulb"></i>${esc(R.resumo)}</p>` : `<p class="sm-txt sm-txt--vazio"><i class="fa-regular fa-clock"></i>${w.completa ? 'O texto desta semana ainda não foi gerado.' : 'Semana em andamento: o texto sai na segunda-feira, depois de domingo fechar.'} Os números abaixo já são da semana.</p>`}
        </article>
        <div class="sm-grid">${F.map((x, k) => {
          const t = txt(x.f);
          return `<article class="card sm-fr" style="--i:${k}">
            <header class="sm-fr__h"><span class="sm-n">${k + 1}</span><b>${esc(x.f)}</b>${x.pct != null ? `<span class="sm-pct" style="--c:${corPct(x.pct)}">${nf(x.pct, 0)}% · ${sg(x.dif)} t</span>` : '<span class="sm-pct sm-pct--nd">sem entrega</span>'}</header>
            ${t && t.titulo ? `<div class="sm-tit${x.pct != null && x.pct >= 100 ? ' sm-tit--ok' : ''}">${esc(t.titulo)}</div>` : ''}
            <div class="sm-dias">${Array.from({ length: 7 }, (_, j) => { const d = addDias(w.ini, j), s = x.st[d]; const c = s && ST[s.s] ? ST[s.s][0] : null; return `<span class="sm-dia${c ? '' : ' nd'}" style="${c ? `--c:${c}` : ''}" title="${DSEM[j]} ${brC(d)}${s ? ` · ${ST[s.s] ? ST[s.s][1] : '—'}${Number.isFinite(s.ent) && Number.isFinite(s.meta) ? ` · ${nf(s.ent)} de ${nf(s.meta)} t` : ''}` : ' · sem análise'}"><i></i><small>${DSEM[j]}</small></span>`; }).join('')}</div>
            ${x.meta ? `<div class="sm-ent"><div class="sm-ent__bar"><i style="--w:${Math.min(100, x.ent / x.meta * 100).toFixed(1)}%;background:${corPct(x.pct)}"></i><span style="left:${Math.min(100, 100 / Math.max(1, x.ent / x.meta) ).toFixed(1)}%"></span></div><small>${nf(x.ent)} t entregues para ${nf(x.meta)} t de meta${x.nEnt < x.n ? ` (${x.nEnt} de ${x.n} dias com entrega lida)` : ''}</small></div>` : ''}
            <div class="sm-of"><span class="sm-lbl">Maiores ofensores · horas acima da referência</span>${x.ofs.slice(0, 3).map(([k2, h]) => `<div class="sm-of__l"><span>${esc(IND[k2] || k2)}</span><span class="sm-of__t"><i style="--w:${(h / mxOf * 100).toFixed(1)}%"></i></span><b>${nf(h)} h</b></div>`).join('') || '<p class="hint">Nenhum indicador acima da referência.</p>'}</div>
            <div class="sm-chips">
              <span class="${x.sinal >= 3 ? 'is-bad' : ''}"><i class="fa-solid fa-triangle-exclamation"></i>Sinal de atenção <b>${x.sinal} ${x.sinal === 1 ? 'dia' : 'dias'}</b></span>
              <span><i class="fa-solid fa-gas-pump"></i>Motor ligado parado <b>${nf(x.mlp, 1)} h</b></span>
              <span class="${x.falta >= 5 ? 'is-bad' : ''}"><i class="fa-solid fa-truck"></i>Falta de caminhão <b>${x.falta}</b></span>
              ${x.dispC != null ? `<span class="${x.dispC < 76.5 ? 'is-bad' : ''}"><i class="fa-solid fa-screwdriver-wrench"></i>Disp. colhedoras <b>${nf(x.dispC, 0)}%</b></span>` : ''}
            </div>
            ${t && t.texto ? `<p class="sm-p">${esc(t.texto)}</p>` : ''}
            ${t && t.acao ? `<p class="sm-acao"><i class="fa-solid fa-arrow-right"></i>${esc(t.acao)}</p>` : ''}
          </article>`;
        }).join('')}</div>
      </section>`;
    requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll('.sm-ent__bar i, .sm-of__t i').forEach(n => n.classList.add('on'))));
    el.querySelector('#smSel').addEventListener('change', e => { SEM = e.target.value; montar(); });
    el.querySelectorAll('.sm-nav [data-p]').forEach(b => b.addEventListener('click', () => { const n = ws[i + Number(b.dataset.p)]; if (n) { SEM = n.ini; montar(); } }));
    MONT = true;
    if (window.Layout && Layout.pagina && Layout.pagina() === 'historico') Layout.secoes();
  };

  const ler = async p => { try { const r = await fetch(p, { cache: 'no-store' }); if (!r.ok) return null; return (await Acesso.readJson(await r.json())).data; } catch (e) { return null; } };
  S.iniciar = async () => {
    [COA, RES] = await Promise.all([ler('historico/analise-coa.json'), ler('historico/resumo-semanal.json')]);
    const antes = Layout.aoEntrar;
    Layout.aoEntrar = pg => { if (antes) antes(pg); if (pg.dataset.p === 'historico' && !MONT) montar(); };
    montar();
  };
  // depois de sincronizar a pasta (só o que mudou)
  S.definir = ({ coa, resumo } = {}) => { if (coa) COA = coa; if (resumo) RES = resumo; montar(); };
  window.Semana = S;
})();
