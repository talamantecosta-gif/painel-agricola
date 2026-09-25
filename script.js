/* =========================================================
   Gerenciamento Diário · Operação Agrícola
   JavaScript puro (ES6) — Chart.js · DataTables · pdf.js
   ========================================================= */
'use strict';

/* ---------------------------------------------------------
   1. UTILITÁRIOS
   --------------------------------------------------------- */
const fmt = (n, d = 2) =>
  (n === null || n === undefined || Number.isNaN(n)) ? '—'
    : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtT = (n, d = 2) => `${fmt(n, d)} t`;
const fmtSigned = (n, d = 2) => (n > 0 ? '+' : '') + fmt(n, d);
const fmtPct = (n, d = 1) => `${fmt(n, d)}%`;
const sum = (arr, f = x => x) => arr.reduce((a, b) => a + (Number(f(b)) || 0), 0);
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const titleCase = s => String(s).toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(De|Da|Do|Das|Dos|E)\b/g, w => w.toLowerCase()).replace(/^Faz\b/i, 'Faz.');

/** Converte número no formato brasileiro ("3.517,22", "+5,56%", "2413,54") em Number. */
function parseNum(str) {
  if (str === null || str === undefined) return NaN;
  let s = String(str).trim().replace(/%$/, '').replace(/^\+/, '').replace(/\s/g, '');
  if (!/^-?[\d.,]+$/.test(s)) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}
const isNum = s => /^[+-]?[\d.,]+%?$/.test(String(s).trim()) && !Number.isNaN(parseNum(s));
const near = (a, b, tol = 0.03) => Math.abs(a - b) <= tol;

/** Classificação de atingimento: verde (≥100%), amarelo (até 10% abaixo), vermelho (>10% abaixo). */
const statusOf = pct => (pct >= 100 ? 'ok' : pct >= 90 ? 'warn' : 'bad');
const STATUS_COLOR = { ok: '#2E7D32', warn: '#F9A825', bad: '#C62828' };

/* ---------------------------------------------------------
   2. PARSER DO PDF (relatório "Gerenciamento Diário")
   Recebe os itens de texto extraídos pelo pdf.js com posição
   { s: texto, x, y, page } e reconstrói todas as tabelas.
   --------------------------------------------------------- */
function parseReportItems(rawItems, info = {}) {
  const items = rawItems
    .map(i => ({ s: String(i.s).replace(/\s+/g, ' ').trim(), x: i.x, y: i.y, page: i.page || 1 }))
    .filter(i => i.s);

  // Agrupa em linhas visuais (por página e coordenada Y)
  const groupRows = list => {
    const sorted = [...list].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of sorted) {
      const last = rows[rows.length - 1];
      if (last && last.page === it.page && Math.abs(last.y - it.y) <= 2.5) last.items.push(it);
      else rows.push({ page: it.page, y: it.y, items: [it] });
    }
    rows.forEach(r => r.items.sort((a, b) => a.x - b.x));
    return rows;
  };
  const rows = groupRows(items);

  const heading = re => items.find(i => re.test(i.s));
  const H = {
    happening: heading(/Sum[aá]rio de Produ[cç][aã]o Happening/i),
    aroeira: heading(/Sum[aá]rio de Produ[cç][aã]o Aroeira/i),
    colhedoras: heading(/Produ[cç][aã]o Colhedoras/i),
    transbordos: heading(/Produ[cç][aã]o Transbordos/i),
    prancha: heading(/^\|?\s*Prancha$/i),
    vinhaca: heading(/^\|?\s*Vinha[cç]a$/i),
    turnoA: heading(/Ofensores Turno A/i),
    turnoB: heading(/Ofensores Turno B/i),
    turnoC: heading(/Ofensores Turno C/i),
  };
  const FRENTE_RE = /^(Frente\s*\d+|Cassia e Cassia)$/i;
  const normFrente = s => s.replace(/\s+/g, ' ').replace(/^frente/i, 'Frente').replace(/^cassia e cassia$/i, 'Cassia e Cassia');

  // Seção logística à qual um item pertence (cabeçalho mais próximo acima, na coluna esquerda)
  const leftHeads = [H.happening, H.aroeira, H.colhedoras].filter(Boolean);
  const logSectionOf = it => {
    const above = leftHeads.filter(h => h.page === it.page && h.y > it.y).sort((a, b) => a.y - b.y)[0];
    if (!above) return null;
    return above === H.happening ? 'happening' : above === H.aroeira ? 'aroeira' : null;
  };

  const out = {
    fazendas: [], totalGeral: null, entregaCota: [], totalEntrega: null,
    logistica: {
      happening: { composicao: [], total: null, frota: { operacao: {}, manutencao: {} } },
      aroeira: { composicao: [], total: null, frota: { operacao: {}, manutencao: {} } },
    },
    prancha: { operacao: {}, manutencao: {} },
    vinhaca: [], ofensores: { A: [], B: [], C: [] },
    colhedoras: [], transbordos: [],
  };
  const seenEntrega = new Set(), seenVinhaca = new Set();

  for (const row of rows) {
    const t = row.items;
    for (let k = 0; k < t.length; k++) {
      const s = t[k].s;
      const nums = n => { const a = []; for (let j = k + 1; j < t.length && a.length < n; j++) { if (!isNum(t[j].s)) break; a.push(t[j].s); } return a; };

      // --- Sumário de produção (linha por fazenda) ---
      if (FRENTE_RE.test(s) && t[k + 1] && /^\d{3,5}$/.test(t[k + 1].s) && t[k + 2] && !isNum(t[k + 2].s)) {
        const vals = [];
        for (let j = k + 3; j < t.length && vals.length < 15; j++) { if (!isNum(t[j].s)) break; vals.push(parseNum(t[j].s)); }
        if (vals.length === 15) {
          const [velDim, velReal, aderencia, piloto, tch, tiroMedio, eficiencia, tc, anlTon, tcCarga, distMed, fibra, atr, impMin, impVeg] = vals;
          out.fazendas.push({ frente: normFrente(s), codFaz: t[k + 1].s, fazenda: t[k + 2].s, velDim, velReal, aderencia, piloto, tch, tiroMedio, eficiencia, tc, anlTon, tcCarga, distMed, fibra, atr, impMin, impVeg });
          k += 17; continue;
        }
      }
      // --- Total Geral do sumário (15 números) ---
      if (/^Total Geral$/i.test(s)) {
        const a = nums(15);
        if (a.length === 15 && !out.totalGeral) {
          const v = a.map(parseNum);
          out.totalGeral = { velDim: v[0], velReal: v[1], aderencia: v[2], piloto: v[3], tch: v[4], tiroMedio: v[5], eficiencia: v[6], tc: v[7], anlTon: v[8], tcCarga: v[9], distMed: v[10], fibra: v[11], atr: v[12], impMin: v[13], impVeg: v[14] };
          k += 15; continue;
        }
      }
      // --- Entrega x Cota (produção − cota = diferença) e Vinhaça (realizado − dimensionado = dif) ---
      if (FRENTE_RE.test(s) || /^Total( Geral)?$/i.test(s)) {
        const a = nums(3).map(parseNum);
        if (a.length === 3) {
          const nextIsNum = t[k + 4] && isNum(t[k + 4].s);
          if (!nextIsNum && near(a[0] - a[1], a[2])) {
            if (/^Total/i.test(s)) { if (!out.totalEntrega) out.totalEntrega = { producao: a[0], cota: a[1], diferenca: a[2] }; }
            else if (!seenEntrega.has(normFrente(s))) { seenEntrega.add(normFrente(s)); out.entregaCota.push({ frente: normFrente(s), producao: a[0], cota: a[1], diferenca: a[2] }); }
            k += 3; continue;
          }
          if (!nextIsNum && near(a[1] - a[0], a[2]) && a[0] < 1000) {
            const key = /^Total/i.test(s) ? 'Total' : normFrente(s);
            if (!seenVinhaca.has(key)) { seenVinhaca.add(key); if (key !== 'Total') out.vinhaca.push({ frente: key, dimensionado: a[0], realizado: a[1], diferenca: a[2] }); }
            k += 3; continue;
          }
        }
      }
      // --- Composição de transporte (Rodotrem/TriTrem/Total: TC, cargas, TC/V, dist) ---
      if (/^(Rodotrem|Tritrem|Total Geral)$/i.test(s)) {
        const a = nums(4);
        if (a.length === 4 && /^\d+$/.test(a[1])) {
          const sec = logSectionOf(t[k]);
          if (sec) {
            const v = a.map(parseNum);
            const reg = { tc: v[0], cargas: v[1], tcv: v[2], dist: v[3] };
            if (/^Total/i.test(s)) out.logistica[sec].total = reg;
            else out.logistica[sec].composicao.push({ tipo: /^rodo/i.test(s) ? 'Rodotrem' : 'Tritrem', ...reg });
            k += 4; continue;
          }
        }
      }
      // --- Frota operação x manutenção (Cavalos 22 Cavalos 1) ---
      if (/^(Cavalos|Rodotrem|Tritrem)$/i.test(s) && t[k + 1] && /^\d+$/.test(t[k + 1].s) && t[k + 2] && t[k + 2].s.toLowerCase() === s.toLowerCase() && t[k + 3] && /^\d+$/.test(t[k + 3].s)) {
        const sec = logSectionOf(t[k]);
        if (sec) {
          const key = s.toLowerCase();
          out.logistica[sec].frota.operacao[key] = +t[k + 1].s;
          out.logistica[sec].frota.manutencao[key] = +t[k + 3].s;
          k += 3; continue;
        }
      }
      // --- Prancha (Caminhão 3 Caminhão 1 / Pranchas 3 Pranchas 1) ---
      if (/^(Caminh[aã]o|Caminh[oõ]es|Pranchas?)$/i.test(s) && t[k + 1] && /^\d+$/.test(t[k + 1].s) && t[k + 2] && /^(Caminh|Prancha)/i.test(t[k + 2].s) && t[k + 3] && /^\d+$/.test(t[k + 3].s)) {
        const key = /^caminh/i.test(s) ? 'caminhoes' : 'pranchas';
        out.prancha.operacao[key] = +t[k + 1].s;
        out.prancha.manutencao[key] = +t[k + 3].s;
        k += 3; continue;
      }
    }
  }

  // --- Colhedoras e transbordos (leitura por coluna) ---
  const readMachines = (head, xMax) => {
    if (!head) return [];
    const col = items.filter(i => i.page === head.page && i.y < head.y && i.x >= head.x - 6 && i.x < xMax);
    const list = []; let frente = null;
    for (const r of groupRows(col)) {
      const tk = r.items.map(i => i.s);
      if (/^Total Geral$/i.test(tk[0])) break;
      if (FRENTE_RE.test(tk[0])) { frente = normFrente(tk[0]); continue; }
      if (frente && tk.length >= 3 && /^\d{4,6}$/.test(tk[0]) && isNum(tk[1]) && /^\d+$/.test(tk[2])) {
        list.push({ frente, maquina: tk[0], tc: parseNum(tk[1]), cargas: +tk[2] });
      }
    }
    return list;
  };
  const xTrans = H.transbordos ? H.transbordos.x - 6 : Infinity;
  const xPran = H.prancha ? H.prancha.x - 6 : (H.turnoA ? H.turnoA.x - 6 : Infinity);
  out.colhedoras = readMachines(H.colhedoras, xTrans);
  out.transbordos = readMachines(H.transbordos, xPran);

  // --- Ofensores por turno (leitura por coluna, abaixo de cada título) ---
  const turnos = [['A', H.turnoA, H.turnoB], ['B', H.turnoB, H.turnoC], ['C', H.turnoC, null]];
  for (const [tk, head, next] of turnos) {
    if (!head) continue;
    const yMin = next ? next.y : head.y - 60;
    const col = items.filter(i => i.page === head.page && i.y < head.y - 1 && i.y > yMin + 1 && i.x >= head.x - 4 && i.x < head.x + 330);
    for (const r of groupRows(col)) {
      const txt = r.items.map(i => i.s).join(' ').trim();
      if (!txt || /^[0\s-]+$/.test(txt) || /Ofensores/i.test(txt)) continue;
      out.ofensores[tk].push(txt);
    }
  }

  // --- Data do relatório ---
  let data = null;
  const fromName = (info.fileName || '').match(/(\d{2})[-_.](\d{2})[-_.](\d{4})/);
  if (fromName) data = `${fromName[3]}-${fromName[2]}-${fromName[1]}`;
  else if (info.creationDate) {
    const m = String(info.creationDate).match(/(\d{4})(\d{2})(\d{2})/);
    if (m) data = `${m[1]}-${m[2]}-${m[3]}`;
  }

  return {
    meta: {
      dataRelatorio: data,
      titulo: 'Gerenciamento Diário',
      arquivo: info.fileName || null,
      origem: info.title || null,
      autor: info.author || null,
      importadoEm: new Date().toISOString(),
    },
    ...out,
  };
}

/** Valida o resultado do parser e lista seções encontradas / ausentes. */
function validateParsed(d) {
  const checks = [
    ['Sumário de produção por fazenda', d.fazendas.length > 0, `${d.fazendas.length} linhas`],
    ['Entrega x Cota por frente', d.entregaCota.length > 0, `${d.entregaCota.length} frentes`],
    ['Total geral', !!d.totalGeral, ''],
    ['Logística Happening', d.logistica.happening.composicao.length > 0, ''],
    ['Logística Aroeira', d.logistica.aroeira.composicao.length > 0, ''],
    ['Frota (operação x manutenção)', Object.keys(d.logistica.happening.frota.operacao).length > 0, ''],
    ['Prancha', Object.keys(d.prancha.operacao).length > 0, ''],
    ['Vinhaça', d.vinhaca.length > 0, `${d.vinhaca.length} frentes`],
    ['Colhedoras', d.colhedoras.length > 0, `${d.colhedoras.length} máquinas`],
    ['Transbordos', d.transbordos.length > 0, `${d.transbordos.length} máquinas`],
    ['Ofensores', (d.ofensores.A.length + d.ofensores.B.length + d.ofensores.C.length) >= 0, `${d.ofensores.A.length + d.ofensores.B.length + d.ofensores.C.length} registros`],
  ];
  return { ok: d.fazendas.length > 0 && d.entregaCota.length > 0, checks };
}

/* ---------------------------------------------------------
   3. MODELO (derivações e cálculos gerenciais)
   --------------------------------------------------------- */
const OFENSOR_ALIASES = [
  [/aguardando mec[aâ]nico/i, 'Aguardando mecânico'],
  [/mudan[cç]a de [aá]rea/i, 'Mudança de área'],
  [/aguardando insumos?/i, 'Aguardando insumos'],
  [/abastecimento do implemento/i, 'Abastecimento do implemento'],
  [/falta (de )?operador/i, 'Falta de operador'],
  [/embuchamento/i, 'Embuchamento'],
];
const normOfensor = s => {
  const t = s.trim();
  for (const [re, name] of OFENSOR_ALIASES) if (re.test(t)) return name;
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function buildModel(raw) {
  const faz = raw.fazendas || [];
  const cotaMap = new Map((raw.entregaCota || []).map(e => [e.frente, e]));
  const order = [];
  faz.forEach(f => { if (!order.includes(f.frente)) order.push(f.frente); });
  (raw.entregaCota || []).forEach(e => { if (!order.includes(e.frente)) order.push(e.frente); });

  const wavg = (list, key, weight = 'tc', skipZero = false) => {
    const l = list.filter(x => Number.isFinite(x[key]) && (!skipZero || x[key] !== 0));
    const w = sum(l, x => x[weight]);
    return w ? sum(l, x => x[key] * x[weight]) / w : (l.length ? sum(l, x => x[key]) / l.length : null);
  };

  const frentes = order.map(nome => {
    const fz = faz.filter(f => f.frente === nome);
    const e = cotaMap.get(nome) || {};
    const producao = Number.isFinite(e.producao) ? e.producao : sum(fz, f => f.tc);
    const cota = Number.isFinite(e.cota) ? e.cota : null;
    const diferenca = Number.isFinite(e.diferenca) ? e.diferenca : (cota != null ? producao - cota : null);
    const pct = cota ? (producao / cota) * 100 : null;
    const velDim = wavg(fz, 'velDim'), velReal = wavg(fz, 'velReal');
    const ader = fz.length && fz.every(f => f.aderencia === fz[0].aderencia) ? fz[0].aderencia
      : (velDim ? (velReal / velDim - 1) * 100 : null);
    return {
      frente: nome, fazendas: fz, producao, cota, diferenca, pct, status: pct != null ? statusOf(pct) : 'warn',
      velDim, velReal, aderencia: ader,
      eficiencia: wavg(fz, 'eficiencia'), tch: wavg(fz, 'tch'), atr: wavg(fz, 'atr', 'tc', true),
      fibra: wavg(fz, 'fibra', 'tc', true), impMin: wavg(fz, 'impMin', 'tc', true), impVeg: wavg(fz, 'impVeg', 'tc', true),
      piloto: wavg(fz, 'piloto'),
    };
  });

  // Linhas por fazenda com meta rateada (frentes com mais de uma fazenda)
  const linhas = faz.map(f => {
    const fr = frentes.find(x => x.frente === f.frente);
    const share = fr && fr.producao ? f.tc / sum(fr.fazendas, x => x.tc) : 1;
    const rateio = fr && fr.fazendas.length > 1;
    const meta = fr && fr.cota != null ? fr.cota * (rateio ? share : 1) : null;
    const dif = meta != null ? f.tc - meta : null;
    const pct = meta ? (f.tc / meta) * 100 : null;
    return { ...f, meta, dif, pct, rateio, status: pct != null ? statusOf(pct) : 'warn' };
  });

  // Ofensores
  const ofe = raw.ofensores || { A: [], B: [], C: [] };
  const turnos = ['A', 'B', 'C'].map(tk => {
    const regs = (ofe[tk] || []).map(line => line.split('/').map(normOfensor).filter(Boolean));
    return { turno: tk, registros: regs };
  });
  const pesos = new Map();
  turnos.forEach(t => t.registros.flat().forEach(o => {
    if (!pesos.has(o)) pesos.set(o, { nome: o, A: 0, B: 0, C: 0, total: 0 });
    const p = pesos.get(o); p[t.turno]++; p.total++;
  }));
  const ofensores = [...pesos.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));

  return { raw, frentes, linhas, turnos, ofensores };
}

/** Totais consolidados para um conjunto (filtrado) de frentes. */
function totals(frentes, M = null) {
  let producao = sum(frentes, f => f.producao);
  let cota = sum(frentes, f => f.cota);
  let diferenca = producao - cota;
  const fz = frentes.flatMap(f => f.fazendas);
  const tcFz = sum(fz, f => f.tc);
  let eficiencia = tcFz ? sum(fz, f => f.eficiencia * f.tc) / tcFz : null;
  // Sem filtro: usa os totais oficiais do relatório (linha "Total Geral")
  if (M && frentes.length === M.frentes.length) {
    const te = M.raw.totalEntrega, tg = M.raw.totalGeral;
    if (te) { producao = te.producao; cota = te.cota; diferenca = te.diferenca; }
    if (tg && Number.isFinite(tg.eficiencia)) eficiencia = tg.eficiencia;
  }
  return { producao, cota, diferenca, pct: cota ? producao / cota * 100 : null, eficiencia, n: frentes.length };
}

/* ---------------------------------------------------------
   4. INSIGHTS AUTOMÁTICOS
   --------------------------------------------------------- */
function buildInsights(M, frentes) {
  const ins = [];
  if (!frentes.length) return ins;
  const T = totals(frentes, M);
  const isAll = frentes.length === M.frentes.length;
  const tg = M.raw.totalGeral;
  const withCota = frentes.filter(f => f.cota);
  const byDif = [...withCota].sort((a, b) => b.diferenca - a.diferenca);

  const acima = byDif.filter(f => f.diferenca > 0);
  if (acima.length) {
    const b = acima[0];
    ins.push({ type: 'ok', icon: 'fa-trophy', title: `${b.frente} superou a meta em ${fmt(b.diferenca, 0)} t`,
      text: `Entregou ${fmtT(b.producao)} contra cota de ${fmtT(b.cota)} (${fmtPct(b.pct)} de atingimento).` });
    acima.slice(1).forEach(f => ins.push({ type: 'ok', icon: 'fa-circle-check', title: `${f.frente} acima da cota (+${fmt(f.diferenca, 0)} t)`,
      text: `Atingimento de ${fmtPct(f.pct)} da cota planejada.` }));
  }
  const worst = byDif[byDif.length - 1];
  if (worst && worst.diferenca < 0) {
    ins.push({ type: 'bad', icon: 'fa-arrow-trend-down', title: `${worst.frente} apresentou o maior desvio negativo (${fmt(worst.diferenca, 0)} t)`,
      text: `Atingiu apenas ${fmtPct(worst.pct)} da cota. Eficiência operacional de ${fmtPct(worst.eficiencia)}.` });
  }
  const lowEf = [...frentes].filter(f => f.eficiencia != null).sort((a, b) => a.eficiencia - b.eficiencia)[0];
  if (lowEf && lowEf.eficiencia < 65) {
    ins.push({ type: 'warn', icon: 'fa-gauge-simple', title: `${lowEf.frente} apresentou baixa Eficiência Operacional`,
      text: `${fmtPct(lowEf.eficiencia)} contra ${fmtPct(T.eficiencia)} do consolidado${lowEf.diferenca > 0 ? ' — mesmo acima da cota, há espaço de ganho' : ''}.` });
  }
  // Velocidade
  const vd = isAll && tg ? tg.velDim : sum(frentes, f => f.velDim) / frentes.length;
  const vr = isAll && tg ? tg.velReal : sum(frentes, f => f.velReal) / frentes.length;
  const va = isAll && tg ? tg.aderencia : (vr / vd - 1) * 100;
  if (vd) {
    const close = Math.abs(va) <= 5;
    ins.push({ type: close ? 'ok' : 'warn', icon: 'fa-gauge-high',
      title: close ? 'Velocidade média realizada ficou próxima do dimensionado' : 'Velocidade média realizada distante do dimensionado',
      text: `${fmt(vr, 1)} km/h realizada x ${fmt(vd, 1)} km/h dimensionada (${fmtSigned(va, 2)}%).` });
  }
  const velWorst = [...frentes].sort((a, b) => a.aderencia - b.aderencia)[0];
  if (velWorst && velWorst.aderencia < -10) {
    ins.push({ type: 'warn', icon: 'fa-person-running', title: `${velWorst.frente} com menor aderência de velocidade (${fmtSigned(velWorst.aderencia, 2)}%)`,
      text: `Realizou ${fmt(velWorst.velReal, 1)} km/h para ${fmt(velWorst.velDim, 1)} km/h dimensionados.` });
  }
  // Consolidado
  if (T.cota) {
    const gap = (1 - T.producao / T.cota) * 100;
    ins.push({ type: gap > 0 ? (gap > 10 ? 'bad' : 'warn') : 'ok', icon: 'fa-scale-unbalanced',
      title: gap > 0 ? `Produção consolidada ficou ${fmt(gap, 1)}% abaixo da cota planejada` : `Produção consolidada ${fmt(-gap, 1)}% acima da cota`,
      text: `${fmtT(T.producao)} entregues para ${fmtT(T.cota)} de cota (${fmtSigned(T.diferenca)} t).` });
  }
  if (!isAll) return ins;

  // Logística
  const L = M.raw.logistica || {};
  const th = L.happening?.total?.tc, ta = L.aroeira?.total?.tc;
  if (th && ta) {
    const main = ta >= th ? ['Aroeira', ta] : ['Happening', th];
    ins.push({ type: 'info', icon: 'fa-truck', title: `${main[0]} respondeu por ${fmtPct(main[1] / (th + ta) * 100)} do transporte`,
      text: `Happening ${fmt(th)} TC · Aroeira ${fmt(ta)} TC · ${fmt((L.happening.total.cargas || 0) + (L.aroeira.total.cargas || 0), 0)} cargas no total.` });
  }
  // Frota em manutenção
  const man = ['happening', 'aroeira'].map(k => [k, sum(Object.values(L[k]?.frota?.manutencao || {}))]);
  const totMan = sum(man, x => x[1]);
  if (totMan) {
    const rodoMan = (L.happening?.frota?.manutencao?.rodotrem || 0) + (L.aroeira?.frota?.manutencao?.rodotrem || 0);
    ins.push({ type: 'warn', icon: 'fa-wrench', title: `${totMan} conjuntos/frotas em manutenção`,
      text: `Happening ${man[0][1]} · Aroeira ${man[1][1]}. Rodotrens concentram ${rodoMan} das paradas.` });
  }
  // Ofensores
  if (M.ofensores.length) {
    const top = M.ofensores.filter(o => o.total === M.ofensores[0].total).map(o => o.nome);
    ins.push({ type: 'warn', icon: 'fa-triangle-exclamation', title: `Principal ofensor: ${top.join(' e ')}`,
      text: `${M.ofensores[0].total} citações cada no dia. Turno C sem registros de ofensores.`.replace(' Turno C sem registros de ofensores.', M.turnos[2].registros.length ? '' : ' Turno C sem registros de ofensores.') });
  }
  // Vinhaça
  const vin = M.raw.vinhaca || [];
  if (vin.length) {
    const d = sum(vin, v => v.dimensionado), r = sum(vin, v => v.realizado);
    ins.push({ type: r / d >= .9 ? 'ok' : 'warn', icon: 'fa-droplet', title: `Vinhaça: ${fmtPct(r / d * 100)} do dimensionado aplicado`,
      text: `${fmt(r)} ha realizados de ${fmt(d, 0)} ha (${fmt(r - d)} ha).` });
  }
  // Impureza vegetal
  const imp = [...M.linhas].filter(l => l.impVeg > 0).sort((a, b) => b.impVeg - a.impVeg)[0];
  if (imp && tg && imp.impVeg > tg.impVeg * 1.3) {
    ins.push({ type: 'warn', icon: 'fa-leaf', title: `Impureza vegetal elevada na ${imp.frente}`,
      text: `${fmtPct(imp.impVeg, 2)} em ${titleCase(imp.fazenda)} contra média de ${fmtPct(tg.impVeg, 2)}.` });
  }
  // Máquina destaque
  const col = M.raw.colhedoras || [];
  if (col.length) {
    const b = [...col].sort((a, c) => c.tc - a.tc)[0];
    ins.push({ type: 'info', icon: 'fa-star', title: `Colhedora destaque: ${b.maquina} (${b.frente})`,
      text: `${fmt(b.tc, 1)} t em ${b.cargas} cargas · média da frota ${fmt(sum(col, c => c.tc) / col.length, 1)} t/máquina.` });
  }
  const piloto0 = M.linhas.find(l => l.piloto === 0);
  if (piloto0) ins.push({ type: 'info', icon: 'fa-satellite-dish', title: `${piloto0.frente} sem uso de piloto automático`,
    text: `% Piloto zerado em ${titleCase(piloto0.fazenda)} — verificar sinal/equipamento.` });
  return ins;
}

/* ---------------------------------------------------------
   5. APLICAÇÃO (somente no navegador)
   --------------------------------------------------------- */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const STORE_KEY = 'ctt-dashboard-dados';
  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  const state = { M: null, frente: '', fazenda: '', q: '', rankSort: 'pct', log: 'happening', maq: 'colhedoras' };
  const charts = {};
  const tables = {};

  const PALETTE = ['#1B5E20', '#2E7D32', '#43A047', '#81C784', '#00897B', '#558B2F', '#9E9D24', '#5D4037', '#546E7A', '#26A69A'];

  /* ---------- Chart.js defaults ---------- */
  if (window.Chart) {
    Chart.defaults.font.family = '"Inter", system-ui, sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#455A64';
    Chart.defaults.borderColor = '#E3E9E4';
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxHeight = 8;
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(38,50,56,.95)';
    Chart.defaults.plugins.tooltip.padding = 12;
    Chart.defaults.plugins.tooltip.cornerRadius = 10;
    Chart.defaults.plugins.tooltip.titleFont = { weight: '700', size: 13 };
    Chart.defaults.maintainAspectRatio = false;
    if (window.ChartZoom) { try { Chart.register(window.ChartZoom); } catch (e) { /* já registrado */ } }
    // Fundo branco para exportação PNG
    Chart.register({ id: 'whiteBg', beforeDraw(c) { const { ctx } = c; ctx.save(); ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.restore(); } });
    // Rótulos de valor simples (sem plugin externo)
    Chart.register({
      id: 'valueLabels',
      afterDatasetsDraw(c, _a, opts) {
        if (!opts || !opts.enabled) return;
        const { ctx } = c; ctx.save();
        ctx.font = '600 10.5px Inter, sans-serif'; ctx.fillStyle = opts.color || '#263238'; ctx.textAlign = 'center';
        c.data.datasets.forEach((ds, di) => {
          if (opts.datasets && !opts.datasets.includes(di)) return;
          const meta = c.getDatasetMeta(di); if (meta.hidden) return;
          meta.data.forEach((el, i) => {
            const v = ds.data[i]; if (v == null) return;
            const txt = opts.format ? opts.format(v) : fmt(v, 0);
            if (c.options.indexAxis === 'y') { ctx.textAlign = v >= 0 ? 'left' : 'right'; ctx.fillText(txt, el.x + (v >= 0 ? 6 : -6), el.y + 4); }
            else ctx.fillText(txt, el.x, v >= 0 ? el.y - 6 : el.y + 14);
          });
        });
        ctx.restore();
      },
    });
  }
  const makeChart = (id, cfg) => {
    if (!window.Chart) return null;
    if (charts[id]) charts[id].destroy();
    const el = document.getElementById(id); if (!el) return null;
    charts[id] = new Chart(el, cfg);
    return charts[id];
  };

  /* ---------- Toast / Modal ---------- */
  const toast = (msg, ms = 3200) => {
    const t = $('#toast'); t.innerHTML = msg; t.classList.add('is-on');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('is-on'), ms);
  };
  const modal = (title, body, buttons = []) => {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = body;
    const foot = $('#modalFoot'); foot.innerHTML = '';
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.className = `btn ${b.primary ? 'btn--primary' : ''}`;
      el.innerHTML = b.html; el.onclick = b.onClick; foot.appendChild(el);
    });
    $('#modal').hidden = false;
  };
  const closeModal = () => { $('#modal').hidden = true; };
  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  /* ---------- Armazenamento local ---------- */
  const store = {
    get() { try { const s = localStorage.getItem(STORE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
    set(d) { try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch (e) { /* sem storage */ } },
    clear() { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* sem storage */ } },
  };

  /* ---------- Filtros ---------- */
  const filteredFrentes = () => {
    const M = state.M; if (!M) return [];
    let fr = M.frentes;
    if (state.frente) fr = fr.filter(f => f.frente === state.frente);
    if (state.fazenda) fr = fr.filter(f => f.fazendas.some(z => z.fazenda === state.fazenda));
    return fr;
  };
  const fillFilters = () => {
    const M = state.M;
    const sf = $('#filterFrente'), sz = $('#filterFazenda');
    sf.innerHTML = '<option value="">Todas as frentes</option>' + M.frentes.map(f => `<option>${escapeHtml(f.frente)}</option>`).join('');
    sf.value = state.frente;
    const fz = M.linhas.filter(l => !state.frente || l.frente === state.frente);
    const uniq = [...new Set(fz.map(l => l.fazenda))];
    sz.innerHTML = '<option value="">Todas as fazendas</option>' + uniq.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(titleCase(n))}</option>`).join('');
    if (!uniq.includes(state.fazenda)) state.fazenda = '';
    sz.value = state.fazenda;
  };

  /* ---------- Render: cabeçalho e KPIs ---------- */
  const fmtDate = iso => {
    if (!iso) return 'Data não identificada';
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const s = dt.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const renderHeader = () => {
    const M = state.M, fr = filteredFrentes(), T = totals(fr, M);
    const meta = M.raw.meta || {};
    $('#heroDate').textContent = fmtDate(meta.dataRelatorio);
    $('#hProd').textContent = fmtT(T.producao);
    $('#hCota').textContent = fmtT(T.cota);
    const hd = $('#hDif'); hd.textContent = `${fmtSigned(T.diferenca)} t`; hd.className = T.diferenca < 0 ? 'neg' : 'pos';
    $('#hEfic').textContent = fmtPct(T.eficiencia);
    $('#hFrentes').textContent = T.n;
    const filt = state.frente || state.fazenda ? ` · filtro: <b>${escapeHtml(state.fazenda ? titleCase(state.fazenda) : state.frente)}</b>` : '';
    $('#sourceInfo').innerHTML = `<i class="fa-regular fa-file-lines"></i> ${escapeHtml(meta.arquivo || 'dados.json')}${meta.dataRelatorio ? ' · ' + meta.dataRelatorio.split('-').reverse().join('/') : ''}${filt}`;
    $('#footerSource').textContent = `Fonte: ${meta.arquivo || 'dados.json'}${meta.origem ? ' (' + meta.origem + ')' : ''} · atualizado em ${new Date(meta.importadoEm || Date.now()).toLocaleString('pt-BR')}`;
  };

  const kpiCard = ({ label, value, unit = '', icon, sub = '', cls = '', iconCls = '', bar = null, barCls = '' }) => `
    <div class="kpi">
      <div class="kpi__top"><span class="kpi__label">${label}</span><span class="kpi__icon ${iconCls}"><i class="fa-solid ${icon}"></i></span></div>
      <div class="kpi__value ${cls}" title="${escapeHtml(String(value).replace(/<[^>]+>/g, ''))}">${value}${unit ? `<small>${unit}</small>` : ''}</div>
      ${sub ? `<div class="kpi__sub">${sub}</div>` : ''}
      ${bar != null ? `<div class="bar"><i class="${barCls}" style="width:${Math.max(0, Math.min(100, bar))}%"></i></div>` : ''}
    </div>`;

  const renderKpis = () => {
    const fr = filteredFrentes(), T = totals(fr, state.M);
    const withCota = fr.filter(f => f.cota);
    const best = [...withCota].sort((a, b) => b.pct - a.pct || b.diferenca - a.diferenca)[0];
    const worst = [...withCota].sort((a, b) => a.pct - b.pct)[0];
    const media = T.n ? T.producao / T.n : 0;
    const st = statusOf(T.pct || 0);
    $('#kpis').innerHTML = [
      kpiCard({ label: 'Produção Total', value: fmt(T.producao), unit: 't', icon: 'fa-wheat-awn', sub: `<b>${fmtPct(T.pct)}</b> da cota`, bar: T.pct, barCls: st }),
      kpiCard({ label: 'Cota Total', value: fmt(T.cota), unit: 't', icon: 'fa-bullseye', sub: `${T.n} frente(s) com cota` }),
      kpiCard({ label: 'Diferença', value: fmtSigned(T.diferenca), unit: 't', icon: 'fa-scale-unbalanced', cls: T.diferenca < 0 ? 'neg' : 'pos', iconCls: T.diferenca < 0 ? 'is-bad' : '', sub: `${fmtSigned(T.pct - 100, 1)}% vs. cota` }),
      kpiCard({ label: 'Eficiência Operacional', value: fmt(T.eficiencia, 1), unit: '%', icon: 'fa-gauge-high', sub: state.frente || state.fazenda ? 'Média ponderada pela produção' : 'Total geral do relatório', bar: T.eficiencia, barCls: T.eficiencia >= 70 ? '' : T.eficiencia >= 60 ? 'warn' : 'bad', iconCls: T.eficiencia >= 70 ? '' : 'is-warn' }),
      kpiCard({ label: 'Produção Média / Frente', value: fmt(media), unit: 't', icon: 'fa-calculator', sub: `${fmt(T.producao)} t ÷ ${T.n} frentes` }),
      best && withCota.length > 1 ? kpiCard({ label: 'Melhor Frente', value: best.frente, icon: 'fa-trophy', cls: 'pos', sub: `<b>${fmtPct(best.pct)}</b> · ${fmtSigned(best.diferenca, 0)} t` }) : '',
      worst && withCota.length > 1 ? kpiCard({ label: 'Pior Frente', value: worst.frente, icon: 'fa-arrow-trend-down', cls: 'neg', iconCls: 'is-bad', sub: `<b>${fmtPct(worst.pct)}</b> · ${fmtSigned(worst.diferenca, 0)} t` }) : '',
    ].join('');
  };

  const renderInsights = () => {
    const ins = buildInsights(state.M, filteredFrentes());
    $('#insights').innerHTML = ins.length ? ins.map(i => `
      <div class="insight insight--${i.type}">
        <span class="insight__icon"><i class="fa-solid ${i.icon}"></i></span>
        <div><h4>${i.type === 'ok' ? '✅ ' : i.type === 'info' ? '' : '⚠ '}${escapeHtml(i.title)}</h4><p>${escapeHtml(i.text)}</p></div>
      </div>`).join('') : '<div class="skeleton-msg">Sem observações para o filtro atual.</div>';
  };

  /* ---------- Render: frentes ---------- */
  const renderRanking = () => {
    const fr = filteredFrentes().filter(f => f.cota);
    const key = state.rankSort;
    const sorted = [...fr].sort((a, b) => key === 'prod' ? b.producao - a.producao : key === 'dif' ? b.diferenca - a.diferenca : b.pct - a.pct);
    const maxPct = Math.max(130, ...sorted.map(f => f.pct));
    $('#ranking').innerHTML = sorted.map((f, i) => {
      const w = f.pct / maxPct * 100, metaX = 100 / maxPct * 100;
      return `
      <div class="rank-row" title="${escapeHtml(f.frente)} — Produção ${fmtT(f.producao)} · Meta ${fmtT(f.cota)} · Dif. ${fmtSigned(f.diferenca)} t">
        <span class="rank-pos">${i + 1}</span>
        <span class="rank-name">${escapeHtml(f.frente)}<small>${fmt(f.producao, 0)} / ${fmt(f.cota, 0)} t</small></span>
        <div class="rank-track">
          <div class="rank-fill ${f.status}" style="width:${w}%"></div>
          <div class="rank-meta" style="left:${metaX}%"></div>
          <span class="rank-label ${w < 22 ? 'out' : ''}" style="${w < 22 ? `left:calc(${w}% + 6px)` : ''}">${fmtPct(f.pct)}</span>
        </div>
        <span class="rank-val t-${f.status}"><strong>${fmtSigned(f.diferenca, 0)}</strong><small>t</small></span>
      </div>`;
    }).join('') || '<div class="empty"><i class="fa-regular fa-folder-open"></i>Sem frentes para o filtro.</div>';
  };

  const renderFrenteCharts = () => {
    const fr = filteredFrentes().filter(f => f.cota);
    const labels = fr.map(f => f.frente);
    makeChart('chProdMeta', {
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Produção (t)', data: fr.map(f => f.producao), backgroundColor: fr.map(f => STATUS_COLOR[f.status] + 'E6'), borderRadius: 6, maxBarThickness: 46, order: 2 },
          { type: 'line', label: 'Meta / Cota (t)', data: fr.map(f => f.cota), borderColor: '#263238', backgroundColor: '#263238', borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: .25, order: 1 },
        ],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: { y: { beginAtZero: true, ticks: { callback: v => fmt(v, 0) }, title: { display: true, text: 'toneladas' } }, x: { grid: { display: false } } },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)} t`,
              afterBody: items => {
                const f = fr[items[0].dataIndex];
                return ['', `Diferença: ${fmtSigned(f.diferenca)} t`, `Atingimento: ${fmtPct(f.pct)}`, `Eficiência: ${fmtPct(f.eficiencia)}`, `TCH: ${fmt(f.tch, 0)} · ATR: ${fmt(f.atr, 2)}`, `Fazendas: ${f.fazendas.map(z => titleCase(z.fazenda)).join(', ')}`];
              },
            },
          },
          zoom: { zoom: { wheel: { enabled: true, modifierKey: 'ctrl' }, pinch: { enabled: true }, mode: 'x' }, pan: { enabled: true, mode: 'x' } },
        },
      },
    });

    makeChart('chDif', {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Diferença (t)', data: fr.map(f => f.diferenca), backgroundColor: fr.map(f => f.diferenca >= 0 ? '#2E7D32' : '#C62828'), borderRadius: 6, maxBarThickness: 46 }] },
      options: {
        layout: { padding: { top: 18 } },
        scales: { y: { ticks: { callback: v => fmt(v, 0) }, grid: { color: c => c.tick.value === 0 ? '#90A4AE' : '#E3E9E4' } }, x: { grid: { display: false } } },
        plugins: {
          legend: { display: false },
          valueLabels: { enabled: true, format: v => fmtSigned(v, 0) },
          tooltip: { callbacks: { label: c => { const f = fr[c.dataIndex]; return [` Diferença: ${fmtSigned(f.diferenca)} t`, ` Produção: ${fmt(f.producao)} t`, ` Cota: ${fmt(f.cota)} t`]; } } },
        },
      },
    });

    const all = filteredFrentes();
    makeChart('chVel', {
      data: {
        labels: all.map(f => f.frente),
        datasets: [
          { type: 'bar', label: 'Dimensionada (km/h)', data: all.map(f => f.velDim), backgroundColor: '#81C784', borderRadius: 5, maxBarThickness: 26, yAxisID: 'y' },
          { type: 'bar', label: 'Realizada (km/h)', data: all.map(f => f.velReal), backgroundColor: '#1B5E20', borderRadius: 5, maxBarThickness: 26, yAxisID: 'y' },
          { type: 'line', label: 'Aderência (%)', data: all.map(f => f.aderencia), borderColor: '#F9A825', backgroundColor: all.map(f => f.aderencia >= 0 ? '#2E7D32' : f.aderencia >= -10 ? '#F9A825' : '#C62828'), pointRadius: 5, pointHoverRadius: 7, borderWidth: 2, borderDash: [5, 4], yAxisID: 'y2' },
        ],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'km/h' } },
          y2: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: v => v + '%' }, title: { display: true, text: 'aderência' } },
          x: { grid: { display: false } },
        },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: c => c.dataset.yAxisID === 'y2' ? ` Aderência: ${fmtSigned(c.parsed.y, 2)}%` : ` ${c.dataset.label}: ${fmt(c.parsed.y, 1)}` } },
        },
      },
    });
  };

  /* ---------- Render: logística ---------- */
  const logData = key => {
    const L = state.M.raw.logistica || {};
    if (key !== 'consolidado') return L[key] || { composicao: [], total: null, frota: { operacao: {}, manutencao: {} } };
    const tipos = ['Rodotrem', 'Tritrem'];
    const comp = tipos.map(tp => {
      const regs = ['happening', 'aroeira'].map(k => (L[k]?.composicao || []).find(c => c.tipo === tp)).filter(Boolean);
      const tc = sum(regs, r => r.tc), cargas = sum(regs, r => r.cargas);
      return { tipo: tp, tc, cargas, tcv: cargas ? tc / cargas : 0, dist: tc ? sum(regs, r => r.dist * r.tc) / tc : 0 };
    });
    const tc = sum(comp, c => c.tc), cargas = sum(comp, c => c.cargas);
    return { composicao: comp, total: { tc, cargas, tcv: cargas ? tc / cargas : 0, dist: tc ? sum(comp, c => c.dist * c.tc) / tc : 0 } };
  };
  const renderLogistica = () => {
    const d = logData(state.log);
    const L = state.M.raw.logistica || {};
    const totAll = (L.happening?.total?.tc || 0) + (L.aroeira?.total?.tc || 0);
    const rod = d.composicao.find(c => c.tipo === 'Rodotrem') || {}, tri = d.composicao.find(c => c.tipo === 'Tritrem') || {};
    const tot = d.total || { tc: sum(d.composicao, c => c.tc), cargas: sum(d.composicao, c => c.cargas) };
    $('#logKpis').innerHTML = [
      kpiCard({ label: 'Rodotrem', value: fmt(rod.tc), unit: 'TC', icon: 'fa-truck-moving', sub: `<b>${fmt(rod.cargas, 0)}</b> cargas · ${fmt(rod.tcv, 1)} TC/v · ${fmt(rod.dist, 1)} km` }),
      kpiCard({ label: 'Tritrem', value: fmt(tri.tc), unit: 'TC', icon: 'fa-trailer', sub: `<b>${fmt(tri.cargas, 0)}</b> cargas · ${fmt(tri.tcv, 1)} TC/v · ${fmt(tri.dist, 1)} km` }),
      kpiCard({ label: 'Total Transportado', value: fmt(tot.tc), unit: 'TC', icon: 'fa-route', sub: `<b>${fmt(tot.cargas, 0)}</b> cargas · ${fmt(tot.tcv, 1)} TC/v` }),
      kpiCard({ label: 'Participação', value: fmtPct(totAll ? tot.tc / totAll * 100 : 0), icon: 'fa-chart-pie', sub: `do total de ${fmt(totAll)} TC`, bar: totAll ? tot.tc / totAll * 100 : 0 }),
    ].join('');
    const nome = { happening: 'Happening', aroeira: 'Aroeira', consolidado: 'Consolidado' }[state.log];
    $('#logPieHint').textContent = `Rodotrem x Tritrem · ${nome}`;
    makeChart('chLogPie', {
      type: 'pie',
      data: { labels: d.composicao.map(c => c.tipo), datasets: [{ data: d.composicao.map(c => c.tc), backgroundColor: ['#1B5E20', '#81C784'], borderColor: '#fff', borderWidth: 3 }] },
      options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => { const r = d.composicao[c.dataIndex]; return [` ${fmt(r.tc)} TC (${fmtPct(r.tc / sum(d.composicao, x => x.tc) * 100)})`, ` ${fmt(r.cargas, 0)} cargas · ${fmt(r.tcv, 1)} TC/viagem`]; } } } } },
    });
    const th = L.happening?.total?.tc || 0, ta = L.aroeira?.total?.tc || 0;
    makeChart('chLogDonut', {
      type: 'doughnut',
      data: { labels: ['Happening', 'Aroeira'], datasets: [{ data: [th, ta], backgroundColor: ['#2E7D32', '#A5D6A7'], borderColor: '#fff', borderWidth: 3 }] },
      options: {
        cutout: '64%',
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => ` ${fmt(c.parsed)} TC (${fmtPct(c.parsed / (th + ta) * 100)})` } } },
      },
      plugins: [{ id: 'center', afterDraw(c) { const { ctx, chartArea: a } = c; ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = '#263238'; ctx.font = '800 18px Inter, sans-serif'; ctx.fillText(fmt(th + ta, 0), (a.left + a.right) / 2, (a.top + a.bottom) / 2 + 2); ctx.font = '600 11px Inter, sans-serif'; ctx.fillStyle = '#78909C'; ctx.fillText('TC total', (a.left + a.right) / 2, (a.top + a.bottom) / 2 + 18); ctx.restore(); } }],
    });
    const ops = ['happening', 'aroeira'];
    makeChart('chLogTcv', {
      type: 'bar',
      data: {
        labels: ['Rodotrem', 'Tritrem'],
        datasets: ops.map((k, i) => ({ label: k === 'happening' ? 'Happening' : 'Aroeira', data: ['Rodotrem', 'Tritrem'].map(tp => (L[k]?.composicao || []).find(c => c.tipo === tp)?.tcv ?? null), backgroundColor: i ? '#81C784' : '#1B5E20', borderRadius: 6, maxBarThickness: 40 })),
      },
      options: {
        layout: { padding: { top: 16 } },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'TC / viagem' } }, x: { grid: { display: false } } },
        plugins: { legend: { position: 'bottom' }, valueLabels: { enabled: true, format: v => fmt(v, 1) }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y, 2)} TC/viagem` } } },
      },
    });
  };

  /* ---------- Render: equipamentos ---------- */
  const renderEquip = () => {
    const R = state.M.raw, L = R.logistica || {};
    const cards = [];
    const add = (title, icon, grupo, op, man) => {
      if (op == null && man == null) return;
      const tot = (op || 0) + (man || 0), disp = tot ? (op || 0) / tot * 100 : 0;
      const c = disp >= 90 ? 'var(--ok)' : disp >= 80 ? 'var(--warn)' : 'var(--bad)';
      cards.push(`<div class="eq">
        <div class="ring" style="--p:${disp.toFixed(1)};--c:${c}" title="Disponibilidade ${fmtPct(disp)}"><span>${fmt(disp, 0)}%</span></div>
        <div><small>${grupo}</small><h4><i class="fa-solid ${icon}"></i>${title}</h4>
          <div class="eq__nums"><div><b>${op ?? 0}</b><span>operando</span></div><div><b class="man">${man ?? 0}</b><span>manutenção</span></div></div>
        </div></div>`);
    };
    const P = R.prancha || { operacao: {}, manutencao: {} };
    add('Caminhões', 'fa-truck', 'Prancha', P.operacao.caminhoes, P.manutencao.caminhoes);
    add('Pranchas', 'fa-trailer', 'Prancha', P.operacao.pranchas, P.manutencao.pranchas);
    [['happening', 'Happening'], ['aroeira', 'Aroeira']].forEach(([k, nome]) => {
      const f = L[k]?.frota || { operacao: {}, manutencao: {} };
      add('Cavalos', 'fa-truck-front', nome, f.operacao.cavalos, f.manutencao.cavalos);
      add('Rodotrens', 'fa-truck-moving', nome, f.operacao.rodotrem, f.manutencao.rodotrem);
      add('Tritrens', 'fa-trailer', nome, f.operacao.tritrem, f.manutencao.tritrem);
    });
    $('#equipCards').innerHTML = cards.join('');

    const labels = ['Caminhões (prancha)', 'Pranchas', 'Cavalos', 'Rodotrens', 'Tritrens'];
    const val = (k, key) => (L.happening?.frota?.[k]?.[key] || 0) + (L.aroeira?.frota?.[k]?.[key] || 0);
    const op = [P.operacao.caminhoes || 0, P.operacao.pranchas || 0, val('operacao', 'cavalos'), val('operacao', 'rodotrem'), val('operacao', 'tritrem')];
    const man = [P.manutencao.caminhoes || 0, P.manutencao.pranchas || 0, val('manutencao', 'cavalos'), val('manutencao', 'rodotrem'), val('manutencao', 'tritrem')];
    makeChart('chEquip', {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Operando', data: op, backgroundColor: '#2E7D32', borderRadius: 5, maxBarThickness: 30 },
        { label: 'Manutenção', data: man, backgroundColor: '#C62828', borderRadius: 5, maxBarThickness: 30 },
      ] },
      options: {
        indexAxis: 'y',
        scales: { x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }, y: { stacked: true, grid: { display: false } } },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { afterBody: it => { const i = it[0].dataIndex, t = op[i] + man[i]; return t ? `Disponibilidade: ${fmtPct(op[i] / t * 100)}` : ''; } } } },
      },
    });

    const vin = R.vinhaca || [];
    const d = sum(vin, v => v.dimensionado), r = sum(vin, v => v.realizado);
    $('#vinhacaHint').textContent = vin.length ? `Dimensionado x Realizado (ha) · total ${fmt(r)} de ${fmt(d, 0)} ha (${fmtPct(d ? r / d * 100 : 0)})` : 'Sem dados de vinhaça';
    makeChart('chVinhaca', {
      type: 'bar',
      data: { labels: vin.map(v => v.frente), datasets: [
        { label: 'Dimensionado (ha)', data: vin.map(v => v.dimensionado), backgroundColor: '#C8E6C9', borderRadius: 5, maxBarThickness: 34 },
        { label: 'Realizado (ha)', data: vin.map(v => v.realizado), backgroundColor: '#2E7D32', borderRadius: 5, maxBarThickness: 34 },
      ] },
      options: {
        layout: { padding: { top: 16 } },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'hectares' } }, x: { grid: { display: false } } },
        plugins: { legend: { position: 'bottom' }, valueLabels: { enabled: true, datasets: [1], format: v => fmt(v, 1) },
          tooltip: { callbacks: { afterBody: it => { const v = vin[it[0].dataIndex]; return `Diferença: ${fmt(v.diferenca)} ha (${fmtPct(v.realizado / v.dimensionado * 100)})`; } } } },
      },
    });
  };

  /* ---------- Render: máquinas ---------- */
  const renderMaquinas = () => {
    const R = state.M.raw;
    let list = (R[state.maq] || []);
    const fset = new Set(filteredFrentes().map(f => f.frente));
    list = list.filter(m => fset.has(m.frente));
    const all = R[state.maq] || [];
    const frentes = [...new Set(all.map(m => m.frente))];
    const color = fr => PALETTE[frentes.indexOf(fr) % PALETTE.length];
    const nome = state.maq === 'colhedoras' ? 'Colhedora' : 'Transbordo';
    $('#maqTitle').textContent = `Produção por ${nome}`;
    const tc = sum(list, m => m.tc), cg = sum(list, m => m.cargas);
    const best = [...list].sort((a, b) => b.tc - a.tc)[0];
    $('#maqKpis').innerHTML = [
      kpiCard({ label: `Produção ${state.maq}`, value: fmt(tc, 1), unit: 't', icon: 'fa-wheat-awn', sub: `<b>${fmt(cg, 0)}</b> cargas` }),
      kpiCard({ label: 'Qtd. de máquinas', value: list.length, icon: 'fa-gears', sub: `${new Set(list.map(m => m.frente)).size} frente(s)` }),
      kpiCard({ label: 'Produção por máquina', value: fmt(list.length ? tc / list.length : 0, 1), unit: 't', icon: 'fa-calculator', sub: `${fmt(cg ? tc / cg : 0, 1)} t por carga` }),
      best ? kpiCard({ label: 'Destaque', value: best.maquina, icon: 'fa-star', cls: 'pos', sub: `<b>${fmt(best.tc, 1)} t</b> · ${best.frente}` }) : '',
    ].join('');
    const sorted = [...list].sort((a, b) => b.tc - a.tc);
    makeChart('chMaq', {
      type: 'bar',
      data: { labels: sorted.map(m => m.maquina), datasets: [{ label: 'Produção (t)', data: sorted.map(m => m.tc), backgroundColor: sorted.map(m => color(m.frente)), borderRadius: 5, maxBarThickness: 34 }] },
      options: {
        layout: { padding: { top: 16 } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => fmt(v, 0) } }, x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 90, minRotation: sorted.length > 16 ? 60 : 0 } } },
        plugins: {
          legend: { display: false },
          valueLabels: { enabled: sorted.length <= 16, format: v => fmt(v, 0) },
          tooltip: { callbacks: { title: it => `${nome} ${sorted[it[0].dataIndex].maquina}`, label: c => { const m = sorted[c.dataIndex]; return [` ${m.frente}`, ` ${fmt(m.tc, 2)} t · ${m.cargas} cargas`, ` ${fmt(m.tc / m.cargas, 1)} t/carga`]; } } },
        },
      },
      plugins: [{ id: 'legendFrentes', afterDraw(c) {
        const { ctx, chartArea: a } = c; ctx.save(); ctx.font = '600 11px Inter, sans-serif';
        let x = a.right; const used = frentes.filter(f => sorted.some(m => m.frente === f)).reverse();
        used.forEach(f => { const w = ctx.measureText(f).width; x -= w + 22; ctx.fillStyle = color(f); ctx.fillRect(x, a.top - 2, 10, 10); ctx.fillStyle = '#455A64'; ctx.fillText(f, x + 14, a.top + 7); });
        ctx.restore();
      } }],
    });
  };

  /* ---------- Render: ofensores ---------- */
  const renderOfensores = () => {
    const M = state.M, of = M.ofensores, total = sum(of, o => o.total);
    makeChart('chOfe', {
      type: 'bar',
      data: { labels: of.map(o => o.nome), datasets: [
        { label: 'Turno A', data: of.map(o => o.A), backgroundColor: '#C62828', borderRadius: 4, maxBarThickness: 26 },
        { label: 'Turno B', data: of.map(o => o.B), backgroundColor: '#EF9A9A', borderRadius: 4, maxBarThickness: 26 },
        { label: 'Turno C', data: of.map(o => o.C), backgroundColor: '#FFCDD2', borderRadius: 4, maxBarThickness: 26 },
      ] },
      options: {
        indexAxis: 'y',
        scales: { x: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'citações' } }, y: { stacked: true, grid: { display: false } } },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { footer: it => `Total: ${of[it[0].dataIndex].total} (${fmtPct(of[it[0].dataIndex].total / total * 100)})` } } },
      },
    });
    const max = of[0]?.total || 1;
    $('#ofeRank').innerHTML = of.map((o, i) => `
      <li><span class="pos">${i + 1}</span>
        <div><span class="nm">${escapeHtml(o.nome)}</span><div class="bar"><i style="width:${o.total / max * 100}%"></i></div></div>
        <span class="vl">${o.total}<small>${fmtPct(o.total / total * 100, 0)}</small></span></li>`).join('')
      || '<div class="empty"><i class="fa-solid fa-circle-check"></i>Nenhum ofensor registrado.</div>';
    $('#turnos').innerHTML = M.turnos.map(t => {
      const unicos = [...new Set(t.registros.flat())];
      return `<div class="turno">
        <header><h4><i class="fa-solid fa-clock-rotate-left" style="color:var(--green-700)"></i>Turno ${t.turno}</h4>
          <span class="badge ${t.registros.length ? '' : 'badge--ok'}">${t.registros.length ? `${t.registros.length} registro(s)` : 'Sem registros'}</span></header>
        ${t.registros.length ? `<ul>${t.registros.map(r => `<li>${r.map(o => `<span class="chip">${escapeHtml(o)}</span>`).join('')}</li>`).join('')}</ul>
          <p class="hint" style="margin-top:8px">Ofensores distintos: ${unicos.map(escapeHtml).join(', ')}</p>`
          : '<div class="empty"><i class="fa-solid fa-circle-check"></i>Turno sem ofensores registrados.</div>'}
      </div>`;
    }).join('');
  };

  /* ---------- Render: fazendas (bolhas + tabelas) ---------- */
  const filteredLinhas = () => {
    const fset = new Set(filteredFrentes().map(f => f.frente));
    return state.M.linhas.filter(l => fset.has(l.frente) && (!state.fazenda || l.fazenda === state.fazenda));
  };
  const renderFazChart = () => {
    const L = filteredLinhas().filter(l => l.atr > 0 && l.tch > 0);
    const maxTc = Math.max(...L.map(l => l.tc), 1);
    const frentes = state.M.frentes.map(f => f.frente);
    makeChart('chFaz', {
      type: 'bubble',
      data: { datasets: L.map(l => ({
        label: `${titleCase(l.fazenda)} (${l.frente})`,
        data: [{ x: l.tch, y: l.atr, r: 6 + Math.sqrt(l.tc / maxTc) * 22, l }],
        backgroundColor: PALETTE[frentes.indexOf(l.frente) % PALETTE.length] + 'B3',
        borderColor: PALETTE[frentes.indexOf(l.frente) % PALETTE.length], borderWidth: 1.5,
      })) },
      options: {
        scales: { x: { title: { display: true, text: 'TCH (t/ha)' }, grace: '8%' }, y: { title: { display: true, text: 'ATR (kg/t)' }, grace: '8%' } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: it => it[0].dataset.label, label: c => { const l = c.raw.l; return [` Produção: ${fmt(l.tc)} t`, ` TCH: ${fmt(l.tch, 0)} · ATR: ${fmt(l.atr, 2)}`, ` Fibra: ${fmt(l.fibra, 2)}% · Eficiência: ${fmtPct(l.eficiencia)}`]; } } },
        },
      },
    });
  };

  const DT_LANG = {
    search: '', searchPlaceholder: 'Buscar na tabela…', lengthMenu: '_MENU_ por página',
    info: '_START_–_END_ de _TOTAL_', infoEmpty: 'Nenhum registro', infoFiltered: '(de _MAX_)',
    zeroRecords: 'Nenhum registro encontrado', emptyTable: 'Sem dados',
    paginate: { first: '«', last: '»', next: '›', previous: '‹' },
  };
  const numCol = (data, title, d = 2, suffix = '') => ({ data, title, className: 'num', render: (v, type) => type === 'display' ? (v === null || v === undefined ? '—' : fmt(v, d) + suffix) : v });
  const qualCol = (data, title, d = 2) => ({ data, title, className: 'num', render: (v, type, row) => type === 'display' ? (row.anlTon === 0 && v === 0 ? '<span class="muted" title="Sem análise">s/ análise</span>' : fmt(v, d)) : v });
  const pctPill = (data, title) => ({ data, title, className: 'num', render: (v, type, row) => type === 'display' ? (v == null ? '—' : `<span class="pill ${row.status}">${fmt(v, 1)}%</span>`) : v });
  const efPill = (data, title) => ({ data, title, className: 'num', render: (v, type) => type === 'display' ? `<span class="pill ${v >= 70 ? 'ok' : v >= 60 ? 'warn' : 'bad'}">${fmt(v, 1)}%</span>` : v });
  const COLS = {
    tblFaz: [
      { data: 'fazenda', title: 'Fazenda', render: (v, t, r) => t === 'display' ? `<b>${escapeHtml(titleCase(v))}</b> <span class="tag">${escapeHtml(r.codFaz)}</span>` : v },
      { data: 'frente', title: 'Frente' },
      numCol('tc', 'Produção (t)'),
      numCol('tch', 'TCH', 0),
      qualCol('atr', 'ATR'),
      qualCol('fibra', 'Fibra'),
      efPill('eficiencia', 'Eficiência'),
    ],
    tblGer: [
      { data: 'frente', title: 'Frente' },
      { data: 'fazenda', title: 'Fazenda', render: (v, t, r) => t === 'display' ? `${escapeHtml(titleCase(v))} <span class="tag">${escapeHtml(r.codFaz)}</span>` : v },
      numCol('tc', 'Produção (t)'),
      { data: 'meta', title: 'Meta (t)', className: 'num', render: (v, t, r) => t === 'display' ? (v == null ? '—' : fmt(v) + (r.rateio ? '<span class="tag">*</span>' : '')) : v },
      { data: 'dif', title: 'Diferença (t)', className: 'num', render: (v, t) => t === 'display' ? (v == null ? '—' : `<span class="${v >= 0 ? 't-ok' : 't-bad'}"><b>${fmtSigned(v)}</b></span>`) : v },
      pctPill('pct', 'Ating.'),
      numCol('velDim', 'Vel. Plan.', 1),
      numCol('velReal', 'Vel. Real', 1),
      { data: 'aderencia', title: 'Aderência', className: 'num', render: (v, t) => t === 'display' ? `<span class="${v >= 0 ? 't-ok' : v >= -10 ? 't-warn' : 't-bad'}">${fmtSigned(v, 2)}%</span>` : v },
      numCol('tch', 'TCH', 0),
      efPill('eficiencia', 'Efic. Oper.'),
      qualCol('atr', 'ATR'),
      qualCol('fibra', 'Fibra'),
      qualCol('impMin', 'Imp. Mineral'),
      qualCol('impVeg', 'Imp. Vegetal'),
    ],
  };
  const renderTables = () => {
    const data = state.M.linhas;
    ['tblFaz', 'tblGer'].forEach(id => {
      if (!window.DataTable) { document.getElementById(id).outerHTML = '<div class="empty"><i class="fa-solid fa-plug-circle-xmark"></i>DataTables não carregou (verifique a conexão).</div>'; return; }
      if (tables[id]) { tables[id].clear(); tables[id].rows.add(data); applyTableFilters(); return; }
      tables[id] = new DataTable('#' + id, {
        data, columns: COLS[id], language: DT_LANG, pageLength: id === 'tblGer' ? 10 : 8,
        lengthMenu: [5, 8, 10, 25, 50], order: [[id === 'tblGer' ? 2 : 2, 'desc']], autoWidth: false,
      });
    });
    applyTableFilters();
  };
  const applyTableFilters = () => {
    Object.entries(tables).forEach(([id, dt]) => {
      const fCol = id === 'tblFaz' ? 1 : 0, zCol = id === 'tblFaz' ? 0 : 1;
      dt.column(fCol).search(state.frente ? '^' + escapeRegex(state.frente) + '$' : '', true, false);
      dt.column(zCol).search(state.fazenda ? '^' + escapeRegex(state.fazenda) + '$' : '', true, false);
      dt.search(state.q).draw();
    });
  };

  /* ---------- Render geral ---------- */
  const renderAll = () => {
    if (!state.M) return;
    renderHeader(); renderKpis(); renderInsights(); renderRanking(); renderFrenteCharts();
    renderLogistica(); renderEquip(); renderMaquinas(); renderOfensores(); renderFazChart(); renderTables();
  };
  const renderFiltered = () => { renderHeader(); renderKpis(); renderInsights(); renderRanking(); renderFrenteCharts(); renderMaquinas(); renderFazChart(); applyTableFilters(); };

  const setData = (raw, { persist = false } = {}) => {
    state.M = buildModel(raw);
    if (persist) store.set(raw);
    fillFilters(); renderAll();
  };

  /* ---------- Exportações ---------- */
  const download = (name, content, type) => {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  };
  const stamp = () => (state.M?.raw?.meta?.dataRelatorio || new Date().toISOString().slice(0, 10));
  const exportCsv = id => {
    const dt = tables[id]; if (!dt) return toast('Tabela indisponível');
    const cols = COLS[id];
    const rows = dt.rows({ search: 'applied', order: 'applied' }).data().toArray();
    const cell = v => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'number') return String(Math.round(v * 100) / 100).replace('.', ',');
      const s = String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.map(c => c.title).join(';'), ...rows.map(r => cols.map(c => cell(r[c.data])).join(';'))];
    download(`${id === 'tblGer' ? 'tabela-gerencial' : 'fazendas'}_${stamp()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    toast(`<i class="fa-solid fa-check"></i> CSV exportado (${rows.length} linhas)`);
  };
  const exportPng = id => {
    const c = charts[id]; if (!c) return;
    const a = document.createElement('a'); a.href = c.toBase64Image('image/png', 1); a.download = `${id}_${stamp()}.png`; a.click();
  };

  /* ---------- Importação do PDF ---------- */
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const extractPdfItems = async file => {
    if (!window.pdfjsLib) throw new Error('Biblioteca pdf.js não carregou. Verifique a conexão com a internet.');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const items = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      tc.items.forEach(i => { if (i.str && i.str.trim()) items.push({ s: i.str, x: i.transform[4], y: i.transform[5], page: p }); });
    }
    let info = {};
    try { info = (await pdf.getMetadata()).info || {}; } catch (e) { /* sem metadados */ }
    return { items, info: { fileName: file.name, creationDate: info.CreationDate, title: info.Title, author: info.Author } };
  };

  const handleFile = async file => {
    if (!file) return;
    const isJson = /\.json$/i.test(file.name) || file.type === 'application/json';
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    if (!isJson && !isPdf) return toast('Envie um arquivo PDF do relatório ou um dados.json');
    modal('Importando relatório', `<div class="spinner"></div><p style="text-align:center">Lendo <b>${escapeHtml(file.name)}</b>…</p>`);
    try {
      let parsed;
      if (isJson) {
        parsed = JSON.parse(await file.text());
      } else {
        const { items, info } = await extractPdfItems(file);
        parsed = parseReportItems(items, info);
        // mantém seções que não foram encontradas no novo PDF? Não — mostra aviso.
      }
      const v = validateParsed(parsed);
      if (!v.ok) {
        modal('Não foi possível ler o relatório', `<p>O arquivo não parece seguir o layout do <b>Gerenciamento Diário</b>. Seções verificadas:</p>
          <ul class="check-list">${v.checks.map(([n, ok]) => `<li><i class="fa-solid ${ok ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i>${n}</li>`).join('')}</ul>`,
          [{ html: 'Fechar', onClick: closeModal }]);
        return;
      }
      const PM = buildModel(parsed); const T = totals(PM.frentes, PM);
      modal('Relatório lido com sucesso', `
        <p><b>${escapeHtml(file.name)}</b> — ${escapeHtml(fmtDate(parsed.meta?.dataRelatorio))}</p>
        <div class="summary">
          <div><span>Produção</span><b>${fmt(T.producao)} t</b></div>
          <div><span>Cota</span><b>${fmt(T.cota)} t</b></div>
          <div><span>Diferença</span><b class="${T.diferenca < 0 ? 't-bad' : 't-ok'}">${fmtSigned(T.diferenca)} t</b></div>
        </div>
        <ul class="check-list">${v.checks.map(([n, ok, det]) => `<li><i class="fa-solid ${ok ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i><span>${n}${det ? ` <span class="muted">· ${det}</span>` : ''}${ok ? '' : ' <span class="muted">(não encontrado)</span>'}</span></li>`).join('')}</ul>
        <p class="hint" style="margin-top:12px">Os números ficam salvos neste navegador. Para publicar para todos no GitHub Pages, baixe o <b>dados.json</b> e substitua o arquivo no repositório.</p>`,
        [
          { html: '<i class="fa-solid fa-file-code"></i> Aplicar e baixar dados.json', onClick: () => { setData(parsed, { persist: true }); download('dados.json', JSON.stringify(parsed, null, 2), 'application/json'); closeModal(); toast('<i class="fa-solid fa-check"></i> Painel atualizado'); } },
          { html: '<i class="fa-solid fa-check"></i> Aplicar', primary: true, onClick: () => { setData(parsed, { persist: true }); closeModal(); toast('<i class="fa-solid fa-check"></i> Painel atualizado com o novo relatório'); } },
        ]);
    } catch (err) {
      console.error(err);
      modal('Erro na importação', `<p>${escapeHtml(err.message || String(err))}</p>`, [{ html: 'Fechar', onClick: closeModal }]);
    }
  };

  /* ---------- Carga inicial ---------- */
  const loadInitial = async () => {
    const cached = store.get();
    let remote = null;
    try {
      const r = await fetch('dados.json', { cache: 'no-store' });
      if (r.ok) remote = await r.json();
    } catch (e) { /* file:// ou offline */ }
    // usa o relatório mais recente entre o publicado (dados.json) e o importado neste navegador
    let use = remote, fromCache = false;
    if (cached && (!remote || (cached.meta?.dataRelatorio || '') > (remote.meta?.dataRelatorio || '') ||
      ((cached.meta?.dataRelatorio || '') === (remote.meta?.dataRelatorio || '') && (cached.meta?.importadoEm || '') > (remote.meta?.importadoEm || '')))) {
      use = cached; fromCache = true;
    }
    if (!use) {
      $('#kpis').innerHTML = `<div class="skeleton-msg"><i class="fa-solid fa-file-arrow-up" style="font-size:28px;color:var(--green-700)"></i>
        <h3 style="margin:10px 0 4px">Nenhum dado carregado</h3>
        <p>Não foi possível ler <b>dados.json</b> (ao abrir o arquivo direto do computador o navegador bloqueia a leitura).<br>
        Publique no GitHub Pages / use um servidor local, ou clique em <b>Importar PDF</b> para carregar o relatório.</p></div>`;
      $('#sourceInfo').innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> sem dados';
      return;
    }
    setData(use);
    if (fromCache) toast('<i class="fa-solid fa-circle-info"></i> Exibindo o último relatório importado neste navegador', 4200);
  };

  /* ---------- Eventos ---------- */
  $('#btnImport').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });
  $('#btnJson').addEventListener('click', () => {
    if (!state.M) return toast('Sem dados para exportar');
    download('dados.json', JSON.stringify(state.M.raw, null, 2), 'application/json');
  });
  $('#btnCsvAll').addEventListener('click', () => exportCsv('tblGer'));
  $('#btnPrint').addEventListener('click', () => window.print());
  $('#btnFull').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  });
  document.addEventListener('fullscreenchange', () => {
    $('#btnFull').innerHTML = `<i class="fa-solid ${document.fullscreenElement === document.documentElement ? 'fa-compress' : 'fa-expand'}"></i>`;
    setTimeout(() => Object.values(charts).forEach(c => c.resize()), 120);
  });

  document.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.png) exportPng(b.dataset.png);
    if (b.dataset.csv) exportCsv(b.dataset.csv);
    if (b.dataset.reset) charts[b.dataset.reset]?.resetZoom?.();
    if (b.hasAttribute('data-full')) {
      const card = b.closest('[data-card]');
      if (document.fullscreenElement) document.exitFullscreen(); else card?.requestFullscreen?.();
    }
    if (b.dataset.log) { $$('#logSeg .seg__btn').forEach(x => x.classList.toggle('is-active', x === b)); state.log = b.dataset.log; renderLogistica(); }
    if (b.dataset.maq) { $$('#maqSeg .seg__btn').forEach(x => x.classList.toggle('is-active', x === b)); state.maq = b.dataset.maq; renderMaquinas(); }
  });

  $('#filterFrente').addEventListener('change', e => { state.frente = e.target.value; fillFilters(); renderFiltered(); });
  $('#filterFazenda').addEventListener('change', e => {
    state.fazenda = e.target.value;
    if (state.fazenda && !state.frente) { /* fazenda define a frente implicitamente */ }
    renderFiltered();
  });
  let qT;
  $('#globalSearch').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { state.q = e.target.value.trim(); applyTableFilters(); }, 120); });
  $('#btnClear').addEventListener('click', () => { state.frente = ''; state.fazenda = ''; state.q = ''; $('#globalSearch').value = ''; fillFilters(); renderFiltered(); });
  $('#rankSort').addEventListener('change', e => { state.rankSort = e.target.value; renderRanking(); });

  // Arrastar e soltar PDF
  let dragN = 0;
  window.addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragN++; $('#dropzone').classList.add('is-on'); } });
  window.addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('#dropzone').classList.remove('is-on'); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('#dropzone').classList.remove('is-on'); handleFile(e.dataTransfer.files[0]); });

  // Impressão: mostra todas as linhas e ajusta gráficos
  const pageLens = {};
  window.addEventListener('beforeprint', () => {
    Object.entries(tables).forEach(([id, dt]) => { pageLens[id] = dt.page.len(); dt.page.len(-1).draw(false); });
    Object.values(charts).forEach(c => c.resize());
  });
  window.addEventListener('afterprint', () => {
    Object.entries(tables).forEach(([id, dt]) => dt.page.len(pageLens[id] || 10).draw(false));
    Object.values(charts).forEach(c => c.resize());
  });

  // Destaque da seção ativa no menu
  const links = $$('.subnav a');
  const spy = new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) links.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === '#' + en.target.id)); });
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('main section[id]').forEach(s => spy.observe(s));

  $('#year').textContent = new Date().getFullYear();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadInitial);
  else loadInitial();
}

/* Exporta funções puras para testes em Node (ignorado no navegador). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseReportItems, parseNum, buildModel, totals, buildInsights, validateParsed };
}
