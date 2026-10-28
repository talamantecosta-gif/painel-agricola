/* Leitura da planilha de Risco de Incêndio (aba Planilha1).
   Compartilhado por incendio.html (importar) e pelo Histórico (sincronizar pasta). */
(function () {
  'use strict';
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
  const parsePlanilha = (wb, arquivo, X = window.XLSX) => {
    const nome = wb.SheetNames.find(n => norm(n) === 'planilha1') || wb.SheetNames[0];
    const rows = X.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: null });
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

  // true se a pasta de trabalho tem o cabeçalho Local + Risco
  const ehIncendio = (wb, X = window.XLSX) => wb.SheetNames.some(n => { const rows = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }).slice(0, 30); return rows.some(r => r && r.some(c => norm(c) === 'local') && r.some(c => norm(c) === 'risco')); });
  window.IncPlanilha = { parse: parsePlanilha, ehIncendio };
})();
