// coa_extract.js — extração do Power BI do SGPA (Relatório de Variáveis Operacionais COA)
// Recriado em 02/11/2026. Rodar no javascript_tool da aba do relatório DEPOIS dos filtros + FILTRAR.
// Uso (cada passo em segundo plano, consultar window.__log a cada ~40 s):
//   window.__bg=__C.passo1();   // eficiência por equipamento, operações totais, período, hrGrp total, PML
//   window.__bg=__C.passo2();   // operações por frente×tipo + linha por hora + hrGrp por operação (~4 min)
//   window.__bg=__C.excluidas(); // tira o filtro Operacao Cod, exporta 568/535/505/... por equipamento/hora e restaura (~1,5 min)
//   __C.metricas();              // calcula M1–M11 em window.__OUT (ler com __C.show(0,30000) + get_page_text)
window.__sleep = ms => new Promise(r => setTimeout(r, ms));
window.__log = []; window.__L = m => { __log.push(new Date().toTimeString().slice(0, 8) + ' ' + m) };
window.__R = powerbi.embeds[0];
window.__C = { D: {}, last: {} };
__C.csv = t => { const rows = []; let row = [], f = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c == '"') { if (t[i + 1] == '"') { f += '"'; i++ } else q = false } else f += c } else { if (c == '"') q = true; else if (c == ',') { row.push(f); f = '' } else if (c == '\n') { row.push(f); rows.push(row); row = []; f = '' } else if (c != '\r') f += c } } if (f || row.length) { row.push(f); rows.push(row) } const h = rows.shift(); return rows.filter(r => r.length > 1).map(r => { const o = {}; h.forEach((k, j) => o[k] = r[j]); return o }) };
__C.n = s => { if (s == null || s === '') return 0; s = String(s).replace('%', '').trim(); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); const v = parseFloat(s); return isNaN(v) ? 0 : v };
__C.code = e => String(e).split(' - ')[0].trim();
__C.fc = f => { const m = f.match(/\d+/); return m ? m[0].padStart(2, '0') : f };
__C.page = async n => (await __R.getPages()).find(p => p.displayName == n);
__C.vis = async (pg, id) => (await pg.getVisuals()).find(x => x.name == id);
__C.bf = (table, column, values) => ({ $schema: 'http://powerbi.com/product/schema#basic', target: { table, column }, operator: 'In', values, filterType: 1 });
__C.exp = async (pgn, id, filters, waitMs = 4500) => { const pg = await __C.page(pgn); if (!pg.isActive) { await pg.setActive(); await __sleep(6000) } if (filters !== undefined) { await pg.setFilters(filters); await __sleep(waitMs) } const v = await __C.vis(pg, id); let d; for (let k = 0; k < 4; k++) { d = (await v.exportData(0, 30000)).data; if (filters === undefined || d !== __C.last[id] || k == 3) break; await __sleep(2500) } __C.last[id] = d; return d };
__C.hr = txt => { const m = {}; __C.csv(txt).forEach(r => { const v = __C.n(r['Tempo (h)']); if (!v) return; const k = r.Frente + '|' + r['Tipo Equipamento'][0] + '|' + __C.code(r.Equipamento) + '|' + r.Hora.slice(0, 2); m[k] = +((m[k] || 0) + v).toFixed(2) }); return m };
const EF = 'Eficiência', PML = 'Parado com Motor Ligado/Motor Ligado';
__C.passo1 = async () => { try {
  __C.D.periodo = await __C.exp(EF, 'ba8f9966ff1ff0ae9cde', []); __L('periodo ' + __C.D.periodo.replace(/\s+/g, ' '));
  __C.D.ef = __C.csv(await __C.exp(EF, 'd2111108013e54a0e6b7'));
  __C.frentes = [...new Set(__C.D.ef.map(r => r.Frente))];
  __C.D.opsAll = __C.csv(await __C.exp(EF, 'a0eabc6e171036b2071b')).map(r => [r['Grupo de Operação'], r['Operação'], +__C.n(r['Tempo Operacional (h)']).toFixed(3)]);
  __C.D.hrTot = __C.hr(await __C.exp(EF, '3fcc4e0eac66b4c00bbb'));
  __L('passo1 equip ' + __C.D.ef.length + ' frentes ' + __C.frentes.length + ' ops ' + __C.D.opsAll.length);
  const m = __C.csv(await __C.exp(PML, '924040e08209c2c21772')), g = __C.csv(await __C.exp(PML, 'd78baf9385b661eceb88'));
  __C.D.pmlOp = {}; m.forEach(r => { const h = __C.n(r['Tempo em Parada (h)']) * __C.n(r['Parado com Motor Ligado/Tempo em Parada (%)']) / 100; if (h < 0.005) return; const k = r.Frente + '|' + r['Tipo Equipamento'][0] + '|' + __C.code(r.Equipamento) + '|' + r.Operacao; __C.D.pmlOp[k] = +((__C.D.pmlOp[k] || 0) + h).toFixed(3) });
  __C.D.pmlEq = {}; g.forEach(r => { const k = r.Frente + '|' + r['Tipo Equipamento'][0] + '|' + __C.code(r.Equipamento); const a = __C.D.pmlEq[k] || [0, 0, 0, 0]; [r['Tempo (h)'], r['Motor Ligado (h)'], r['Tempo em Parada (h)'], r['Parado com Motor Ligado (h)']].forEach((x, i) => a[i] = +(a[i] + __C.n(x)).toFixed(3)); __C.D.pmlEq[k] = a });
  await (await __C.page(EF)).setActive(); await __sleep(5000); __L('DONE1');
} catch (e) { __L('ERR ' + e.message) } };
__C.passo2 = async () => { try {
  __C.D.ops = {}; __C.D.hora = {};
  for (const F of __C.frentes) for (const T of ['Colhedora', 'TRANSBORDO']) {
    const d = await __C.exp(EF, 'a0eabc6e171036b2071b', [__C.bf('dFrente', 'Frente', [F]), __C.bf('dEquipamento', 'Equipamento Tipo', [T])]);
    __C.D.ops[F + '|' + T] = __C.csv(d).map(r => [r['Grupo de Operação'], r['Operação'], +__C.n(r['Tempo Operacional (h)']).toFixed(3)]);
    __C.D.hora[F + '|' + T] = __C.csv(await __C.exp(EF, 'c4b7d7b55469adae6886')).map(r => [r.Hora, __C.n(r['Eficiência Operacional']), __C.n(r['Disponibilidade Mecânica'])]);
    __L('ops ' + F + ' ' + T) }
  __C.D.hrOp = {};
  for (const op of __C.D.opsAll.map(x => x[1])) { __C.D.hrOp[op] = __C.hr(await __C.exp(EF, '3fcc4e0eac66b4c00bbb', [__C.bf('dOperacao', 'Operacao', [op])])); __L('hrOp ' + op) }
  await (await __C.page(EF)).setFilters([]); __L('DONE2');
} catch (e) { __L('ERR ' + e.message) } };
__C.excluidas = async () => { try {
  window.__RF0 = await __R.getFilters(); __C.D.exc = {};
  await __R.setFilters(__RF0.filter(f => !(f.target && f.target.column == 'Operacao Cod'))); await __sleep(3000);
  for (const c of [568, 535, 505, 502, 541, 548, 542, 600, 575, 5351, -1]) { __C.D.exc[c] = __C.hr(await __C.exp(EF, '3fcc4e0eac66b4c00bbb', [__C.bf('dOperacao', 'Operacao Cod', [c])], 5000)); __L('exc ' + c) }
  await (await __C.page(EF)).setFilters([]); await __R.setFilters(__RF0); await __sleep(3000);
  const n = (await __R.getFilters()).find(f => f.target && f.target.column == 'Operacao Cod'); __L('restored ' + (n ? n.values.length : 'NONE'));
} catch (e) { __L('ERR ' + e.message) } };
__C.show = (a0, b0) => { let a = document.getElementById('__art'); if (!a) { a = document.createElement('article'); a.id = '__art'; document.body.prepend(a) } a.innerHTML = ''; const p = document.createElement('pre'); p.textContent = '<<B>>\n' + __TXT.slice(a0, b0) + '\n<<E>>'; a.appendChild(p); return 'ok' };
// Métricas M1–M11 (mesmo código usado em 02/11/2026): ver aprendizados. Saída window.__OUT por frente {C,T,ac}
__C.metricas = () => {
  const fc = __C.fc, FR = ['01', '02', '03', '04', '05', '11', '13', '34', '37'], r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100, hh = h => String(h).padStart(2, '0') + 'h';
  const eqH = {}; for (const k in __C.D.hrTot) { const [F, T, E] = k.split('|'); const kk = fc(F) + '|' + T + '|' + E; eqH[kk] = (eqH[kk] || 0) + __C.D.hrTot[k] }
  const ag = m => { const g = {}; for (const k in m) { const [F, T, E, H] = k.split('|'); const kk = fc(F) + '|' + T; g[kk] = g[kk] || {}; g[kk][+H] = (g[kk][+H] || 0) + m[k] } return g };
  const TOT = ag(__C.D.hrTot), OPA = {}; for (const op in __C.D.hrOp) OPA[op] = ag(__C.D.hrOp[op]);
  const tl = (F, T, ops, meta, lab, eql) => { const tot = TOT[F + '|' + T] || {}, s = {}; ops.forEach(op => { const g = (OPA[op] || {})[F + '|' + T] || {}; for (const h in g) s[h] = (s[h] || 0) + g[h] }); const pts = []; for (let h = 0; h < 24; h++) { if (!tot[h] || tot[h] < 0.05) continue; pts.push([h, 100 * (s[h] || 0) / tot[h]]) } if (!pts.some(p => p[1] > 0)) return { indicador: lab, equipamento: eql, meta, picoHora: null, picoValor: null, horasAcimaMeta: 0, faixas: [], media: 0 }; const pk = pts.reduce((a, b) => b[1] > a[1] ? b : a); const ac = pts.filter(p => p[1] > meta).map(p => p[0]); const runs = []; ac.forEach(h => { const l = runs[runs.length - 1]; if (l && l[1] == h - 1) l[1] = h; else runs.push([h, h]) }); const top = runs.slice().sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]) || a[0] - b[0]).slice(0, 3).sort((a, b) => a[0] - b[0]); return { indicador: lab, equipamento: eql, meta, picoHora: hh(pk[0]), picoValor: r1(pk[1]), horasAcimaMeta: ac.length, faixas: top.map(r => r[0] == r[1] ? hh(r[0]) : hh(r[0]) + '–' + hh(r[1])), media: r1(pts.reduce((a, p) => a + p[1], 0) / pts.length) } };
  const efRows = __C.D.ef.map(r => ({ F: fc(r.Frente), T: r['Tipo Equipamento'][0], E: __C.code(r.Equipamento), eo: __C.n(r['Eficiência Operacional']), dm: __C.n(r['Disponibilidade Mecânica']), em: __C.n(r['Eficiência Motor']) }));
  const OUT = {};
  for (const F of FR) { OUT[F] = {}; for (const T of ['C', 'T']) { const TT = T == 'C' ? 'Colhedora' : 'TRANSBORDO'; const fk = Object.keys(__C.D.ops).find(k => fc(k.split('|')[0]) == F && k.split('|')[1] == TT); const ops = fk ? __C.D.ops[fk] : []; const rows = efRows.filter(r => r.F == F && r.T == T); if (!rows.length) { OUT[F][T] = null; continue } const n = rows.length, H = ops.reduce((a, x) => a + x[2], 0), op = o => ops.filter(x => x[1] == o).reduce((a, x) => a + x[2], 0), grp = g => ops.filter(x => x[0] == g).reduce((a, x) => a + x[2], 0);
    let sw = 0, se = 0, sd = 0; const eqs = rows.map(r => { const w = eqH[F + '|' + T + '|' + r.E] || 0; sw += w; se += w * r.em; sd += w * r.dm; return [r.E, r1(w), r.em, r.dm] });
    const o = { n, H: r2(H), efMotor: sw ? r1(se / sw) : null, disp: sw ? r1(sd / sw) : null, eqs };
    const hr = __C.D.hora[Object.keys(__C.D.hora).find(k => fc(k.split('|')[0]) == F && k.split('|')[1] == TT)] || []; o.dispPorHora = hr.filter(x => x[2] < 85).map(x => x[0].slice(0, 2) + 'h:' + x[2]);
    if (T == 'C') { const at = op('AGUARD. TRANSBORDO'), am = op('AGUARDANDO MANOBRA TRANSBORDO'); Object.assign(o, { horasCorte: r1((op('COLHEITA CANA PICADA') + op('COLHEITA CANA QUEIMADA')) / n), manobraProdutivo: grp('PRODUTIVA') ? r1(100 * (op('MANOBRA COLHEDORA') + op('MANOBRA AUXILIAR')) / grp('PRODUTIVA')) : 0, aguardTransbordo: r2((at + am) / n), aguardTransbordoPct: H ? r1(100 * (at + am) / H) : 0, at: [r2(at / n), H ? r1(100 * at / H) : 0], am: [r2(am / n), H ? r1(100 * am / H) : 0] }); o.tl = [tl(F, T, ['AGUARD. TRANSBORDO'], 10, 'Aguardando Transbordo', 'colhedora')] }
    else { Object.assign(o, { aguardColhedora: r2(op('AGUARDANDO COLHEDORA') / n), fila: r2(op('EQUIPAMENTO EM FILA') / n), aguardCaminhao: r2(op('AGUARDANDO CAMINHÃO') / n) }); o.tl = [tl(F, T, ['AGUARDANDO CAMINHÃO'], 5, 'Aguardando Caminhão - Transbordo', 'transbordo'), tl(F, T, ['AGUARDANDO COLHEDORA'], 6, 'Aguardando Colhedora', 'transbordo'), tl(F, T, ['EQUIPAMENTO EM FILA'], 5, 'Equipamento em Fila', 'transbordo')] }
    let ml = 0, pm = 0; for (const k in __C.D.pmlEq) { const [FF, T2] = k.split('|'); if (fc(FF) == F && T2 == T) { ml += __C.D.pmlEq[k][1]; pm += __C.D.pmlEq[k][3] } } const po = {}, pe = {}; for (const k in __C.D.pmlOp) { const [FF, T2, E, O] = k.split('|'); if (fc(FF) == F && T2 == T) { po[O] = (po[O] || 0) + __C.D.pmlOp[k]; pe[E] = (pe[E] || 0) + __C.D.pmlOp[k] } }
    o.pml = { motorLigado: r1(ml), paradoMotorLigado: r1(pm), pctMotorLigado: ml ? r1(100 * pm / ml) : 0, porOperacao: Object.entries(po).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => ({ operacao: x[0], horas: r1(x[1]) })), porOpAll: Object.fromEntries(Object.entries(po).map(x => [x[0], r2(x[1])])), porEquip: Object.entries(pe).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => [x[0], r1(x[1])]) };
    OUT[F][T] = o } }
  // M10 cruzamento Aguardando Caminhão (cruzCaminhao)
  const eqOp = (op, F, T) => { const m = {}; for (const k in (__C.D.hrOp[op] || {})) { const [FF, TT, E, H] = k.split('|'); if (fc(FF) == F && TT == T) { m[+H] = m[+H] || {}; m[+H][E] = (m[+H][E] || 0) + __C.D.hrOp[op][k] } } return m };
  for (const F of FR) { const tAC = eqOp('AGUARDANDO CAMINHÃO', F, 'T'), cAC = eqOp('AGUARDANDO CAMINHÃO', F, 'C'), cAT = eqOp('AGUARD. TRANSBORDO', F, 'C'), cAM = eqOp('AGUARDANDO MANOBRA TRANSBORDO', F, 'C'); const res = { faltaCaminhao: [], possivelDivergencia: [], soTransbordo: [] }; const sum = m => Object.values(m).reduce((a, b) => a + b, 0), rr = m => Object.fromEntries(Object.entries(m).map(x => [x[0], r1(x[1])]));
    for (let h = 0; h < 24; h++) { const t = tAC[h] || {}, st = sum(t); if (st < 0.3 - 1e-9) continue; const ca = cAC[h] || {}, sca = sum(ca), ct = {}; [cAT[h] || {}, cAM[h] || {}].forEach(m => { for (const e in m) ct[e] = (ct[e] || 0) + m[e] }); const sct = sum(ct); const e = { hora: hh(h), transbordoAguardCaminhao: r1(st), transbordos: rr(t), colhedoraAguardCaminhao: r1(sca), colhedorasAguardCaminhao: rr(ca), colhedoraAguardTransbordo: r1(sct), colhedorasAguardTransbordo: rr(ct) }; if (sca >= 0.1 - 1e-9) res.faltaCaminhao.push(e); else if (sct >= 0.2 - 1e-9) res.possivelDivergencia.push(e); else res.soTransbordo.push(e) }
    OUT[F].ac = res }
  window.__OUT = OUT; window.__TXT = JSON.stringify(OUT); return __TXT.length };
'ok';
