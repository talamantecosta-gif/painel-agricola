/* =========================================================================
   Histórico do painel (Operação diária)

   Como os dados ficam no GitHub (todos protegidos com a chave do login):
     historico/indice-operacao.json   resumo leve de cada dia (para períodos)
     historico/dias/AAAA-MM-DD.json   relatório completo do dia (dados + análise)

   Sincronização: a página lê a pasta de PDFs do computador (vinculada uma vez),
   encontra os relatórios novos ou alterados, lê cada PDF no próprio navegador e
   publica tudo no GitHub num único commit (com o token salvo neste navegador).
   Sem token, gera um .zip com as pastas prontas para subir manualmente.

   A pasta concentra tudo o que o painel publica (cada arquivo só sobe quando muda):
     Relatório DD-MM-AAAA.pdf          → historico/dias + índice (+ dados.json do dia mais novo)
     planilha de viagens (transporte)  → historico/transporte.json
     planilha de incêndio (Local/Risco)→ incendio.json
     planilha de usuários (Usuário/Senha[/Ativo]) → acesso.json (mesma chave; senhas < 8 ficam como estavam)
     analise.json                      → analise.json + arquivo do dia
     historico_analise_coa.json        → historico/analise-coa.json
     Pluviométrico 2026.xlsm (aba Acumulado) → pluviometrico.json
   ========================================================================= */
(function () {
  'use strict';
  const H = {};
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sg = (v, d = 0) => (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v), d);
  const soma = (a, f = x => x) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const media = (a, f) => { const v = a.map(f).filter(Number.isFinite); return v.length ? soma(v) / v.length : null; };
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const br = iso => (iso && ISO.test(iso) ? iso.split('-').reverse().join('/') : '—');
  const brC = iso => (iso && ISO.test(iso) ? iso.split('-').reverse().slice(0, 2).join('/') : '—');
  const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const inicioSafra = iso => { const [y, m] = iso.split('-').map(Number); return `${m >= 4 ? y : y - 1}-04-01`; };
  const toast = (m, ms) => (window.Painel ? Painel.toast(m, ms) : null);
  const C = { ok: '#2E7D32', bad: '#C62828', warn: '#E0A100', can: '#1F4D2B', folha: '#3C7A35', palha: '#B98A2E', ink: '#18301F', muted: '#5E6C62', hair: '#EEF1EC', broto: '#97C459' };

  /* ---------- armazenamento local (protegido) ---------- */
  const CFG_KEY = 'painel-github';
  const cfg = {
    async get() { try { const s = localStorage.getItem(CFG_KEY); if (!s) return null; const o = JSON.parse(s); return Acesso.isProtected(o) ? await Acesso.decryptJson(o) : null; } catch (e) { return null; } },
    async set(v) { try { if (!v) localStorage.removeItem(CFG_KEY); else localStorage.setItem(CFG_KEY, JSON.stringify(await Acesso.encryptJson(v))); } catch (e) { /* sem storage */ } },
  };
  // pasta vinculada (o navegador guarda a autorização, não os arquivos)
  const idb = (modo, fn) => new Promise((ok, nok) => {
    const r = indexedDB.open('painel-historico', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('h');
    r.onerror = () => nok(r.error);
    r.onsuccess = () => { try { const tx = r.result.transaction('h', modo); const st = tx.objectStore('h'); const q = fn(st); tx.oncomplete = () => ok(q && q.result); tx.onerror = () => nok(tx.error); } catch (e) { nok(e); } };
  });
  const pastaGuardada = () => idb('readonly', st => st.get('pasta')).catch(() => null);
  const guardarPasta = h => idb('readwrite', st => st.put(h, 'pasta')).catch(() => null);
  const SUPORTA_PASTA = 'showDirectoryPicker' in window;

  /* ---------- zip sem compressão (quando não há token) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const zip = arquivos => {
    const enc = new TextEncoder(), partes = [], central = []; let off = 0;
    const w = (dv, lista) => lista.forEach(([o, v, s]) => (s === 4 ? dv.setUint32(o, v, true) : dv.setUint16(o, v, true)));
    arquivos.forEach(({ path, content }) => {
      const n = enc.encode(path), d = enc.encode(content), c = crc32(d);
      const lh = new DataView(new ArrayBuffer(30)); w(lh, [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, c, 4], [18, d.length, 4], [22, d.length, 4], [26, n.length, 2], [28, 0, 2]]);
      partes.push(new Uint8Array(lh.buffer), n, d);
      const ch = new DataView(new ArrayBuffer(46)); w(ch, [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, c, 4], [20, d.length, 4], [24, d.length, 4], [28, n.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]]);
      central.push(new Uint8Array(ch.buffer), n);
      off += 30 + n.length + d.length;
    });
    const tamC = soma(central, x => x.length), fim = new DataView(new ArrayBuffer(22));
    w(fim, [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, arquivos.length, 2], [10, arquivos.length, 2], [12, tamC, 4], [16, off, 4], [20, 0, 2]]);
    return new Blob([...partes, ...central, new Uint8Array(fim.buffer)], { type: 'application/zip' });
  };
  const baixar = (blob, nome) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); };

  /* ---------- GitHub (API) ---------- */
  const gh = async (c, metodo, rota, corpo) => {
    const r = await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}${rota}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      cache: 'no-store',
    });
    if (r.status === 404 && metodo === 'GET') return null;
    if (!r.ok) {
      let msg = ''; try { msg = (await r.json()).message || ''; } catch (e) { /* */ }
      if (r.status === 401) throw new Error('o GitHub recusou o token (expirado ou inválido). Gere um novo em Configurar GitHub.');
      if (r.status === 403) throw new Error('o token não tem permissão de escrita neste repositório (Contents: Read and write).');
      throw new Error(`GitHub respondeu ${r.status}${msg ? ': ' + msg : ''}`);
    }
    return r.status === 204 ? null : r.json();
  };
  const b64utf8 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), ch => ch.charCodeAt(0)));
  // lê um arquivo do repositório (versão mais nova, sem esperar o GitHub Pages)
  const lerRepo = async (c, path) => {
    const x = await gh(c, 'GET', `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(c.branch)}`);
    if (!x || !x.content) return null;
    return (await Acesso.readJson(JSON.parse(b64utf8(x.content)))).data;
  };
  // grava vários arquivos num único commit
  const commit = async (c, arquivos, msg) => {
    for (let tent = 0; tent < 2; tent++) {
      const ref = await gh(c, 'GET', `/git/ref/heads/${encodeURIComponent(c.branch)}`);
      if (!ref) throw new Error(`não encontrei o branch "${c.branch}" no repositório ${c.owner}/${c.repo}.`);
      const base = await gh(c, 'GET', `/git/commits/${ref.object.sha}`);
      const tree = await gh(c, 'POST', '/git/trees', { base_tree: base.tree.sha, tree: arquivos.map(a => ({ path: a.path, mode: '100644', type: 'blob', content: a.content })) });
      const novo = await gh(c, 'POST', '/git/commits', { message: msg, tree: tree.sha, parents: [ref.object.sha] });
      try { await gh(c, 'PATCH', `/git/refs/heads/${encodeURIComponent(c.branch)}`, { sha: novo.sha }); return novo.sha; }
      catch (e) { if (tent) throw e; } // alguém publicou no meio: tenta de novo sobre a versão nova
    }
  };

  /* ---------- leitura do que está publicado ---------- */
  const lerSite = async caminho => {
    try { const r = await fetch(caminho, { cache: 'no-store' }); if (!r.ok) return null; return (await Acesso.readJson(await r.json())).data; }
    catch (e) { return null; }
  };
  let IDX = { dias: {} };
  const carregarIndice = async (c = null) => {
    const x = c ? await lerRepo(c, 'historico/indice-operacao.json').catch(() => null) : await lerSite('historico/indice-operacao.json');
    IDX = x && x.dias ? x : (c ? IDX : { dias: {} });
    return IDX;
  };
  const datas = () => Object.keys(IDX.dias).filter(d => ISO.test(d)).sort();
  H.datas = datas;
  // dia completo: site (GitHub Pages) → arquivo bruto do repositório → API (quando há token)
  const REPO_PADRAO = { owner: 'talamantecosta-gif', repo: 'painel-agricola', branch: 'main' };
  const lerDia = async d => {
    const p = `historico/dias/${d}.json`;
    let x = await lerSite(p);
    if (x && x.dados) return x;
    const c = (await cfg.get()) || REPO_PADRAO;
    x = await lerSite(`https://raw.githubusercontent.com/${c.owner}/${c.repo}/${c.branch || 'main'}/${p}`);
    if (x && x.dados) return x;
    if (c.token) { try { x = await lerRepo(c, p); if (x && x.dados) return x; } catch (e) { /* */ } }
    return null;
  };

  /* ---------- resumo leve de um dia (vai para o índice) ---------- */
  H.resumo = (raw, analise, src) => {
    const r = { d: raw?.meta?.dataRelatorio || analise?.data || null, t: new Date().toISOString() };
    if (src) r.src = src;
    if (raw) {
      const M = buildModel(JSON.parse(JSON.stringify(raw)));
      const T = totals(M.frentes, M);
      const L = raw.logistica || {};
      const comp = tp => ['happening', 'aroeira'].map(k => (L[k]?.composicao || []).find(c => c.tipo === tp)).filter(Boolean);
      const rod = comp('Rodotrem'), tri = comp('Tritrem'), vin = raw.vinhaca || [];
      const ader = (() => { const l = M.frentes.filter(f => Number.isFinite(f.aderencia) && f.producao); const w = soma(l, f => f.producao); return w ? soma(l, f => f.aderencia * f.producao) / w : null; })();
      // relatórios antigos (agosto) tinham outra coluna no lugar da indisponibilidade: descarta valores impossíveis
      const indOk = !M.frentes.some(f => Number.isFinite(f.indisp) && f.indisp > 100);
      if (!indOk) M.frentes.forEach(f => { f.indisp = null; });
      Object.assign(r, {
        prod: T.producao, cota: T.cota, ef: T.eficiencia, ind: indOk ? indispTotal(M, M.frentes) : null, ader,
        log: { tot: (L.happening?.total?.tc || 0) + (L.aroeira?.total?.tc || 0), rod: soma(rod, x => x.tc), tri: soma(tri, x => x.tc), via: soma(rod, x => x.cargas) + soma(tri, x => x.cargas) },
        vin: vin.length ? { dim: soma(vin, v => v.dimensionado), real: soma(vin, v => v.realizado) } : null,
        fr: M.frentes.map(f => [f.frente, f.producao, f.cota, f.eficiencia, f.indisp]),
        col: (raw.colhedoras || []).map(m => [String(m.maquina), m.tc, m.frente]),
        of: M.ofensores.slice(0, 12).map(o => [o.nome, o.total]),
      });
    }
    const ec = analise && analise.entregaCota && Array.isArray(analise.entregaCota.frentes) && analise.entregaCota.frentes.length ? analise.entregaCota : null;
    if (ec) r.ec = { meta: ec.total?.meta ?? soma(ec.frentes, f => f.meta), ent: ec.total?.entrega ?? soma(ec.frentes, f => f.entrega) };
    return r;
  };

  /* ---------- sincronização com a pasta ---------- */
  let SYNC = false;
  const dataDoNome = n => { const m = String(n).match(/(\d{2})[-_.](\d{2})[-_.](\d{4})/) || String(n).match(/(\d{4})-(\d{2})-(\d{2})/); if (!m) return null; return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`; };
  const pedirPasta = async () => {
    const h = await window.showDirectoryPicker({ id: 'painel-historico', mode: 'read' });
    await guardarPasta(h); return h;
  };
  const permissao = async (h, pedir) => {
    if (!h) return false;
    const o = { mode: 'read' };
    if ((await h.queryPermission(o)) === 'granted') return true;
    return pedir ? (await h.requestPermission(o)) === 'granted' : false;
  };
  const progresso = txt => { const el = $('#syncMsg'); if (el) el.textContent = txt; const st = $('#syncTip'); if (st) st.textContent = txt; };

  /* ---------- planilha de transporte (Controle de viagens Próprio e Happening) ---------- */
  let TRANSP = null; // { meta, dias: [...] }
  const carregaXlsx = () => new Promise((ok, nok) => {
    if (window.XLSX) return ok(window.XLSX);
    const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    sc.onload = () => ok(window.XLSX); sc.onerror = () => nok(new Error('o leitor de planilhas não carregou (verifique a internet)'));
    document.head.appendChild(sc);
  });
  const normT = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const numT = v => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && /^-?[\d.,]+$/.test(v.trim()) ? parseFloat(v.replace(/\./g, '').replace(',', '.')) : null));
  const isoT = v => (v instanceof Date && !isNaN(v) ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : null);
  H.lerPlanilhaTransporte = async (file) => {
    const X = await carregaXlsx();
    const wb = X.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const hoje = isoT(new Date());
    const dias = new Map(), meses = {};
    wb.SheetNames.forEach(nome => {
      const rows = X.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: null });
      if (!rows.length || normT(rows[0][0]) !== 'data' || normT(rows[0][1]) !== 'moagem') return;
      const h1 = [], h2 = rows[1] || []; let cur = null;
      rows[0].forEach((v, i) => { if (v) cur = String(v); h1[i] = cur; });
      const cols = [];
      h1.forEach((g, i) => {
        const sub = normT(h2[i]);
        const m = String(g || '').match(/controle de densidade\s+(.+?)\s+-\s+(.+)$/i);
        if (m && !/geral/i.test(m[1])) {
          const frota = `${m[1].trim()} - ${m[2].trim()}`;
          if (sub.startsWith('peso')) cols.push({ i, k: 'peso', frota });
          else if (sub === 'viagens totais') cols.push({ i, k: 'viagens', frota });
          else if (sub.replace(/\s/g, '') === '%transportada') cols.push({ i, k: 'pct', frota });
        } else if (sub.startsWith('posicao na cota - proprio')) cols.push({ i, k: 'posP' });
        else if (sub === 'motivo proprio') cols.push({ i, k: 'motP' });
        else if (sub.startsWith('posicao na cota - happening')) cols.push({ i, k: 'posH' });
        else if (sub === 'motivo happening') cols.push({ i, k: 'motH' });
        else if (sub.startsWith('projecao de moagem')) cols.push({ i, k: 'proj' });
      });
      // frota → [t, viagens, % transportada (fração da moagem)]
      const lerFr = (r, x) => cols.forEach(c => {
        const v = r[c.i];
        if (c.frota) { const f = x.fr[c.frota] || (x.fr[c.frota] = [0, 0, null]); if (c.k === 'peso') f[0] = numT(v) || 0; else if (c.k === 'viagens') f[1] = numT(v) || 0; else f[2] = numT(v); }
        else if (c.k.startsWith('mot')) x[c.k] = v ? String(v).trim() : null;
        else x[c.k] = numT(v);
      });
      const limpa = x => Object.keys(x.fr).forEach(k => { if (!x.fr[k][0] && !x.fr[k][1]) delete x.fr[k]; });
      let mesAba = null; const totais = {};
      rows.slice(2).forEach(r => {
        const rot = normT(r[0]);
        if (rot === 'total' || rot === 'total safra') { const x = { moagem: numT(r[1]) || 0, fr: {} }; lerFr(r, x); limpa(x); delete x.posP; delete x.posH; delete x.motP; delete x.motH; delete x.proj; totais[rot === 'total' ? 'total' : 'safra'] = x; return; }
        const d = isoT(r[0]); if (!d) return;
        if (!mesAba) mesAba = d.slice(0, 7);
        if (d > hoje) return;
        const x = { d, moagem: numT(r[1]) || 0, fr: {} };
        lerFr(r, x); limpa(x);
        if (x.moagem > 0 || x.motP || x.motH) dias.set(d, x);
      });
      if (mesAba && (totais.total || totais.safra)) meses[mesAba] = totais;
    });
    const lista = [...dias.values()].sort((a, b) => a.d.localeCompare(b.d));
    if (!lista.length) throw new Error('não encontrei as abas por mês (colunas Data e Moagem) na planilha');
    return { meta: { arquivo: file.name, mtime: file.lastModified, lidoEm: new Date().toISOString() }, dias: lista, meses };
  };

  // planilha sem nome conhecido: descobre pelo conteúdo
  const COL_USER = ['usuario', 'usuarios', 'login', 'user', 'nome de usuario', 'usuario do site', 'usuario painel'];
  const COL_SENHA = ['senha', 'password', 'senha do site', 'senha painel'];
  const COL_ATIVO = ['ativo', 'status', 'situacao', 'acesso', 'liberado'];
  const normU = s => normT(s).replace(/[^a-z0-9]+/g, ' ').trim();
  const achaCab = rows => {
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const h = (rows[i] || []).map(normU);
      const u = h.findIndex(x => COL_USER.includes(x)), p = h.findIndex(x => COL_SENHA.includes(x));
      if (u >= 0 && p >= 0) return { i, u, p, a: h.findIndex(x => COL_ATIVO.includes(x)) };
    }
    return null;
  };
  const tipoPlanilha = async f => {
    const X = await carregaXlsx();
    const wb = X.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
    const linhas = n => X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null });
    if (wb.SheetNames.some(n => { const r = linhas(n); return r.length && normT(r[0][0]) === 'data' && normT(r[0][1]) === 'moagem'; })) return 'transporte';
    if (wb.SheetNames.some(n => linhas(n).slice(0, 10).some(r => r && normU(r[0]) === 'data' && r.some(c => normU(c) === 'turno') && r.some(c => normU(c).startsWith('chuva'))))) return 'pluvio';
    if (wb.SheetNames.some(n => achaCab(linhas(n)))) return 'usuarios';
    if (window.IncPlanilha && IncPlanilha.ehIncendio(wb, X)) return 'incendio';
    return null;
  };
  // planilha de usuários → acesso.json (mesma chave do painel: os dados publicados continuam abrindo)
  const atualizarUsuarios = async (file, c) => {
    const X = await carregaXlsx();
    const wb = X.read(await file.arrayBuffer(), { type: 'array' });
    let tab = null;
    for (const n of wb.SheetNames) { const rows = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: null }); const cab = achaCab(rows); if (cab) { tab = { rows, cab }; break; } }
    if (!tab) throw new Error('não encontrei as colunas "Usuário" e "Senha"');
    const inativo = v => /^(nao|n|inativo|bloqueado|desativado|removido|sem acesso|0|false)$/.test(normU(v));
    const lista = new Map(), avisos = [];
    tab.rows.slice(tab.cab.i + 1).forEach((r, k) => {
      const u = String(r[tab.cab.u] ?? '').trim().toLowerCase(); if (!u) return;
      if (tab.cab.a >= 0 && inativo(r[tab.cab.a])) return; // fica de fora (é removido)
      const p = String(r[tab.cab.p] ?? '');
      if (!Acesso.checkPass(p)) { avisos.push(`a senha de ${u} tem menos de 8 caracteres (linha ${tab.cab.i + k + 2}) — mantive o acesso como estava`); lista.set(u, null); return; }
      lista.set(u, p);
    });
    if (![...lista.values()].some(Boolean)) throw new Error('nenhum usuário com senha válida na planilha');
    // acesso.json mais novo (repositório quando há token; senão o do site)
    let cfgA = null;
    if (c && c.token) { try { const x = await gh(c, 'GET', `/contents/acesso.json?ref=${encodeURIComponent(c.branch)}`); if (x && x.content) cfgA = JSON.parse(b64utf8(x.content)); } catch (e) { cfgA = null; } }
    if (!cfgA) cfgA = await Acesso.loadConfig();
    if (!cfgA || !Array.isArray(cfgA.usuarios)) throw new Error('não consegui ler o acesso.json atual');
    const atuais = await Acesso.listUsers(cfgA);
    const eu = String(Acesso.user || '').toLowerCase();
    let cfgN = cfgA, removidos = 0;
    for (const [u, p] of lista) if (p) cfgN = await Acesso.addUser(cfgN, u, p);
    for (const x of atuais) {
      const nome = String(x.nome || '').toLowerCase();
      if (lista.has(nome) || nome === eu || nome === '(sem nome)') continue;
      cfgN = await Acesso.removeUser(cfgN, x.id); removidos++;
    }
    return { cfg: cfgN, mudou: true, total: cfgN.usuarios.length, removidos, avisos };
  };

  H.sincronizar = async ({ silencioso = false, trocarPasta = false } = {}) => {
    if (SYNC) return; SYNC = true; marcarStatus();
    try {
      if (!SUPORTA_PASTA) { if (!silencioso) Painel.modal('Navegador sem suporte', '<p>Para ler a pasta do computador, abra o painel no <b>Google Chrome</b> ou no <b>Microsoft Edge</b> (no computador).</p>', [{ html: 'Fechar', onClick: Painel.fecharModal }]); return; }
      let dir = trocarPasta ? null : await pastaGuardada();
      if (!dir) { if (silencioso) return; dir = await pedirPasta(); }
      if (!(await permissao(dir, !silencioso))) { if (!silencioso) toast('<i class="fa-solid fa-folder-closed"></i> Sem permissão para ler a pasta', 4000); marcarStatus(); return; }
      const c = await cfg.get();
      if (!silencioso) Painel.modal('Sincronizando histórico', `<div class="spinner"></div><p style="text-align:center" id="syncMsg">Lendo a pasta ${esc(dir.name)}…</p>`);
      await carregarIndice(c && c.token ? c : null);
      // arquivos da pasta
      const pdfs = [], analises = [], planilhas = [];
      let coaArq = null;
      for await (const [nome, h] of dir.entries()) {
        if (h.kind !== 'file') continue;
        if (/\.pdf$/i.test(nome)) pdfs.push({ nome, h });
        else if (/\.json$/i.test(nome) && /hist.*analise|analise.*coa/i.test(nome)) { const f = await h.getFile(); if (!coaArq || f.lastModified > coaArq.f.lastModified) coaArq = { nome, h, f }; }
        else if (/analise.*\.json$/i.test(nome)) analises.push({ nome, h });
        else if (/\.xls[xmb]?$/i.test(nome) && !nome.startsWith('~$')) planilhas.push({ nome, h });
      }
      const F = IDX.fontes || {};
      const mudou = (k, a) => a && (!F[k] || F[k].nome !== a.nome || F[k].mtime < a.f.lastModified);
      // dias que estão no índice mas cujo arquivo completo não foi publicado (ex.: upload manual incompleto)
      progresso('Conferindo os arquivos publicados…');
      let publicados = null;
      if (c && c.token) {
        try { const l = await gh(c, 'GET', `/contents/historico/dias?ref=${encodeURIComponent(c.branch)}`); publicados = new Set((Array.isArray(l) ? l : []).map(x => x.name)); } catch (e) { publicados = null; }
      } else {
        publicados = new Set();
        await Promise.all(Object.keys(IDX.dias).map(async d => { try { const r = await fetch(`historico/dias/${d}.json`, { method: 'HEAD', cache: 'no-store' }); if (r.ok) publicados.add(`${d}.json`); } catch (e) { /* */ } }));
      }
      const novos = [];
      for (const p of pdfs) {
        const d = dataDoNome(p.nome);
        const f = await p.h.getFile();
        const ja = d && IDX.dias[d];
        const faltaArquivo = d && publicados && !publicados.has(`${d}.json`);
        if (!ja || !ja.src || ja.src.mtime < f.lastModified || ja.src.nome !== p.nome || faltaArquivo) novos.push({ ...p, f, d });
      }
      // análises (entrega x cota do Flow) por data: da pasta e a publicada hoje
      const anMap = new Map(), anFontes = new Map();
      let anArq = null; // analise.json mais recente da pasta (vira o analise.json do site)
      for (const a of analises) {
        try {
          const f = await a.h.getFile();
          const x = (await Acesso.readJson(JSON.parse(await f.text()))).data;
          if (!x || !x.data) continue;
          anMap.set(x.data, x); anFontes.set(x.data, { nome: a.nome, f });
          if (!anArq || f.lastModified > anArq.f.lastModified) anArq = { nome: a.nome, f, x };
        } catch (e) { /* ignora */ }
      }
      if (Painel.analise && Painel.analise.data && !anMap.has(Painel.analise.data)) anMap.set(Painel.analise.data, Painel.analise);
      const anArqNovo = mudou('analise', anArq);
      const anNovas = [...anMap.keys()].filter(d => IDX.dias[d] && (!IDX.dias[d].ec || (anArqNovo && anArq.x.data === d)) && !novos.some(n => n.d === d));
      // planilhas: cada uma pelo nome (ou pelo conteúdo, se o nome não disser)
      progresso('Conferindo as planilhas…');
      const pls = { transporte: null, incendio: null, usuarios: null, pluvio: null };
      for (const p of planilhas) {
        const f = await p.h.getFile();
        let tipo = /usu[aá]rio/i.test(p.nome) ? 'usuarios' : /pluvi/i.test(p.nome) ? 'pluvio' : /inc[eê]ndio|risco|queimada/i.test(p.nome) ? 'incendio' : /viage|transporte|happ/i.test(p.nome) ? 'transporte' : null;
        if (!tipo) { try { tipo = await tipoPlanilha(f); } catch (e) { tipo = null; } }
        if (tipo && (!pls[tipo] || f.lastModified > pls[tipo].f.lastModified)) pls[tipo] = { ...p, f };
      }
      const pl = pls.transporte;
      const plNova = pl && (!IDX.transporte || IDX.transporte.mtime < pl.f.lastModified || IDX.transporte.nome !== pl.nome);
      const incNova = mudou('incendio', pls.incendio), usNova = mudou('usuarios', pls.usuarios), coaNova = mudou('coa', coaArq), pvNova = mudou('pluvio', pls.pluvio) || !!(pls.pluvio && window.Pluvio && (F.pluvio || {}).v !== Pluvio.VERSAO);
      if (!novos.length && !anNovas.length && !plNova && !incNova && !usNova && !coaNova && !pvNova && !anArqNovo) {
        if (!silencioso) { Painel.fecharModal(); toast(`<i class="fa-solid fa-circle-check"></i> Histórico em dia · ${datas().length} relatórios`, 3500); }
        await guardarUltima(); marcarStatus(); return;
      }
      // lê os PDFs novos
      const arquivos = [], resumos = [], lidos = [], erros = [];
      for (const [i, n] of novos.entries()) {
        progresso(`Lendo ${i + 1} de ${novos.length}: ${n.nome}`);
        try {
          const raw = await Painel.lerPdf(n.f);
          if (n.d) raw.meta.dataRelatorio = n.d;
          const d = raw.meta.dataRelatorio;
          if (!d) throw new Error('sem data no nome do arquivo');
          raw.meta.arquivo = n.nome;
          const an = anMap.get(d) || null;
          arquivos.push({ path: `historico/dias/${d}.json`, content: JSON.stringify(await Acesso.encryptJson({ data: d, dados: raw, analise: an })) });
          resumos.push(H.resumo(raw, an, { nome: n.nome, mtime: n.f.lastModified }));
          lidos.push({ d, raw, an });
        } catch (e) { erros.push(`${n.nome}: ${e.message || e}`); }
      }
      // análises de dias que já estavam no histórico
      for (const d of anNovas) {
        progresso(`Juntando a entrega x cota de ${br(d)}`);
        const dia = c && c.token ? await lerRepo(c, `historico/dias/${d}.json`).catch(() => null) : await lerDia(d);
        if (!dia || !dia.dados) continue;
        const an = anMap.get(d);
        arquivos.push({ path: `historico/dias/${d}.json`, content: JSON.stringify(await Acesso.encryptJson({ data: d, dados: dia.dados, analise: an })) });
        resumos.push({ ...H.resumo(dia.dados, an, IDX.dias[d].src) });
      }
      let plLida = false;
      if (plNova) {
        progresso(`Lendo a planilha ${pl.nome}`);
        try {
          const T = await H.lerPlanilhaTransporte(pl.f);
          arquivos.push({ path: 'historico/transporte.json', content: JSON.stringify(await Acesso.encryptJson(T)) });
          IDX.transporte = { nome: pl.nome, mtime: pl.f.lastModified, de: T.dias[0].d, ate: T.dias[T.dias.length - 1].d };
          TRANSP = T; plLida = true;
        } catch (e) { erros.push(`${pl.nome}: ${e.message || e}`); }
      }
      // demais arquivos da pasta: incêndio, usuários, análise do COA
      const extras = []; // o que foi lido, para a mensagem
      const novasF = { ...F };
      if (incNova) {
        const p = pls.incendio; progresso(`Lendo a planilha ${p.nome}`);
        try {
          const X = await carregaXlsx();
          const D = IncPlanilha.parse(X.read(await p.f.arrayBuffer(), { type: 'array' }), p.nome, X);
          D.meta.dataLeitura = isoT(new Date(p.f.lastModified)) || D.meta.dataLeitura;
          arquivos.push({ path: 'incendio.json', content: JSON.stringify(await Acesso.encryptJson(D)) });
          novasF.incendio = { nome: p.nome, mtime: p.f.lastModified };
          extras.push(`risco de incêndio (${D.leituras.length} leituras)`);
        } catch (e) { erros.push(`${p.nome}: ${e.message || e}`); }
      }
      if (usNova) {
        const p = pls.usuarios; progresso('Atualizando os usuários do painel…');
        try {
          const r = await atualizarUsuarios(p.f, c);
          if (r.mudou) arquivos.push({ path: 'acesso.json', content: JSON.stringify(r.cfg, null, 1) });
          novasF.usuarios = { nome: p.nome, mtime: p.f.lastModified };
          extras.push(`usuários (${r.total} liberados${r.removidos ? `, ${r.removidos} removido${r.removidos > 1 ? 's' : ''}` : ''})`);
          r.avisos.forEach(a => erros.push(`${p.nome}: ${a}`));
        } catch (e) { erros.push(`${p.nome}: ${e.message || e}`); }
      }
      let pvLido = null;
      if (pvNova) {
        const p = pls.pluvio; progresso(`Lendo a planilha ${p.nome}`);
        try {
          if (!window.Pluvio) throw new Error('o leitor do pluviométrico não carregou (atualize a página)');
          const X = await carregaXlsx();
          const PV = Pluvio.ler(X.read(await p.f.arrayBuffer(), { type: 'array', cellDates: true }), X, p.nome);
          arquivos.push({ path: 'pluviometrico.json', content: JSON.stringify(await Acesso.encryptJson(PV)) });
          novasF.pluvio = { nome: p.nome, mtime: p.f.lastModified, v: Pluvio.VERSAO };
          extras.push(`pluviométrico (até ${brC(PV.meta.ate)})`); pvLido = PV;
        } catch (e) { erros.push(`${p.nome}: ${e.message || e}`); }
      }
      if (coaNova) {
        progresso(`Lendo ${coaArq.nome}`);
        try {
          const x = (await Acesso.readJson(JSON.parse(await coaArq.f.text()))).data;
          if (!x || typeof x !== 'object') throw new Error('arquivo vazio');
          arquivos.push({ path: 'historico/analise-coa.json', content: JSON.stringify(await Acesso.encryptJson(x)) });
          novasF.coa = { nome: coaArq.nome, mtime: coaArq.f.lastModified };
          extras.push(`histórico da análise COA${Array.isArray(x.dias) ? ` (${x.dias.length} dias)` : ''}`);
        } catch (e) { erros.push(`${coaArq.nome}: ${e.message || e}`); }
      }
      if (anArqNovo) novasF.analise = { nome: anArq.nome, mtime: anArq.f.lastModified };
      if (!resumos.length && !plLida && !extras.length && !anArqNovo) { Painel.modal('Nada foi publicado', `<p>Não consegui ler os arquivos novos:</p><ul class="check-list">${erros.map(x => `<li><i class="fa-solid fa-circle-exclamation"></i>${esc(x)}</li>`).join('')}</ul>`, [{ html: 'Fechar', onClick: Painel.fecharModal }]); return; }
      resumos.forEach(r => { IDX.dias[r.d] = r; });
      const ordenado = {}; datas().forEach(d => { ordenado[d] = IDX.dias[d]; });
      IDX = { versao: 1, atualizado: new Date().toISOString(), pasta: dir.name, transporte: IDX.transporte, fontes: novasF, dias: ordenado };
      arquivos.push({ path: 'historico/indice-operacao.json', content: JSON.stringify(await Acesso.encryptJson(IDX)) });
      // o relatório mais novo também vira o dados.json da página
      const ultimo = lidos.sort((a, b) => a.d.localeCompare(b.d)).pop();
      const atualD = Painel.atual?.raw?.meta?.dataRelatorio || '';
      const virouAtual = ultimo && ultimo.d >= atualD;
      let anRaiz = null;
      if (virouAtual) {
        arquivos.push({ path: 'dados.json', content: JSON.stringify(await Acesso.encryptJson(ultimo.raw)) });
        if (ultimo.an) anRaiz = ultimo.an;
      }
      // analise.json novo na pasta: vira o analise.json do site se for do dia exibido (ou mais novo)
      if (anArqNovo && !anRaiz && anArq.x.data >= (virouAtual ? ultimo.d : atualD)) anRaiz = anArq.x;
      if (anRaiz) arquivos.push({ path: 'analise.json', content: JSON.stringify(await Acesso.encryptJson(anRaiz)) });
      const dias = resumos.map(r => r.d).sort();
      const partes = [];
      if (dias.length) partes.push(dias.length === 1 ? `relatório de ${br(dias[0])}` : `${dias.length} relatórios (${brC(dias[0])} a ${brC(dias[dias.length - 1])})`);
      if (plLida) partes.push('planilha de transporte');
      if (anRaiz || (anArqNovo && anNovas.length)) partes.push(`análise do dia ${br(anArq ? anArq.x.data : anRaiz.data)}`);
      partes.push(...extras);
      const lista = partes.length > 1 ? partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1] : (partes[0] || 'índice');
      const titulo = `Painel: ${lista}`;
      const ul = xs => `<ul class="check-list">${xs.map(x => `<li><i class="fa-solid fa-circle-exclamation"></i>${esc(x)}</li>`).join('')}</ul>`;
      if (c && c.token) {
        progresso('Publicando no GitHub…');
        await commit(c, arquivos, titulo);
        if (!silencioso) Painel.modal('Painel atualizado', `<p>Publiquei no GitHub num único envio:</p><ul class="check-list">${partes.map(x => `<li><i class="fa-solid fa-circle-check"></i>${esc(x)}</li>`).join('')}</ul>${virouAtual ? `<p>O painel passou a abrir em <b>${br(ultimo.d)}</b>.</p>` : ''}<p class="hint">O site atualiza para todos em cerca de 1 minuto.</p>${erros.length ? `<p>Atenção:</p>${ul(erros)}` : ''}`, [{ html: 'Fechar', primary: true, onClick: Painel.fecharModal }]);
        else toast(`<i class="fa-solid fa-cloud-arrow-up"></i> Publicado: ${esc(lista)}${erros.length ? ` · ${erros.length} arquivo(s) com problema` : ''}`, 6000);
      } else {
        baixar(zip(arquivos), `painel-${dias[dias.length - 1] || new Date().toISOString().slice(0, 10)}.zip`);
        Painel.modal('Pacote baixado', `<p>Sem o GitHub configurado, juntei num .zip: ${esc(lista)}.</p>
          <ol class="hist-passos"><li>Extraia o .zip.</li><li>No GitHub: <b>Add file → Upload files</b>.</li><li>Arraste tudo o que foi extraído (mantendo a pasta <b>historico</b>) e clique em <b>Commit changes</b>.</li></ol>
          <p class="hint">Para não precisar mais disso, use <b>Configurar GitHub</b> na página Histórico.</p>${erros.length ? `<p>Atenção:</p>${ul(erros)}` : ''}`, [{ html: 'Fechar', primary: true, onClick: Painel.fecharModal }]);
      }
      if (pvLido && window.Pluvio) Pluvio.definir(pvLido);
      if (virouAtual) Painel.definirAtual(ultimo.raw, ultimo.an || (anRaiz && anRaiz.data === ultimo.d ? anRaiz : (Painel.analise && Painel.analise.data === ultimo.d ? Painel.analise : null)));
      else if (anRaiz && Painel.atual?.raw) Painel.definirAtual(Painel.atual.raw, anRaiz);
      await guardarUltima();
      atualizarTela();
    } catch (e) {
      if (e && e.name === 'AbortError') { Painel.fecharModal(); return; }
      console.error(e);
      if (!silencioso) Painel.modal('Não foi possível sincronizar', `<p>${esc(e.message || String(e))}</p>`, [{ html: 'Fechar', onClick: Painel.fecharModal }]);
      else toast(`<i class="fa-solid fa-triangle-exclamation"></i> Histórico: ${esc(e.message || e)}`, 6000);
    } finally { SYNC = false; marcarStatus(); }
  };
  const ULT = 'painel-hist-ultima';
  const guardarUltima = async () => { try { localStorage.setItem(ULT, new Date().toISOString()); } catch (e) { /* */ } };

  /* ---------- configurar GitHub ---------- */
  H.configurar = async () => {
    const c = (await cfg.get()) || { owner: 'talamantecosta-gif', repo: 'painel-agricola', branch: 'main', token: '' };
    Painel.modal('Publicar direto no GitHub', `
      <p>Com um token do GitHub salvo neste navegador, a sincronização publica o histórico sozinha, sem baixar nem subir arquivos.</p>
      <div class="gh-form">
        <label>Usuário ou organização<input id="ghOwner" value="${esc(c.owner)}" autocomplete="off"></label>
        <label>Repositório<input id="ghRepo" value="${esc(c.repo)}" autocomplete="off"></label>
        <label>Branch<input id="ghBranch" value="${esc(c.branch)}" autocomplete="off"></label>
        <label class="gh-full">Token (fine-grained)<input id="ghToken" type="password" placeholder="${c.token ? 'Token salvo — deixe em branco para manter' : 'github_pat_…'}" autocomplete="off"></label>
      </div>
      <p class="hint">O token fica guardado protegido pela sua senha do painel, só neste navegador, e só é enviado para api.github.com. Crie em GitHub → Settings → Developer settings → Fine-grained tokens, com acesso só ao repositório do painel e a permissão <b>Contents: Read and write</b>.</p>
      <p class="hint" id="ghMsg"></p>`,
    [
      { html: '<i class="fa-solid fa-folder-open"></i> Trocar pasta', onClick: () => { Painel.fecharModal(); H.sincronizar({ trocarPasta: true }); } },
      ...(!c.token ? [{ html: '<i class="fa-solid fa-file-zipper"></i> Sincronizar sem GitHub (.zip)', onClick: () => { Painel.fecharModal(); H.sincronizar(); } }] : []),
      ...(c.token ? [{ html: '<i class="fa-solid fa-trash"></i> Remover token', onClick: async () => { await cfg.set(null); Painel.fecharModal(); toast('Token removido deste navegador'); marcarStatus(); } }] : []),
      { html: '<i class="fa-solid fa-plug-circle-check"></i> Testar e salvar', primary: true, onClick: async () => {
        const n = { owner: $('#ghOwner').value.trim(), repo: $('#ghRepo').value.trim(), branch: $('#ghBranch').value.trim() || 'main', token: $('#ghToken').value.trim() || c.token };
        const msg = $('#ghMsg');
        if (!n.owner || !n.repo || !n.token) { msg.textContent = 'Preencha usuário, repositório e token.'; return; }
        msg.textContent = 'Testando…';
        try {
          const rep = await gh(n, 'GET', '');
          if (!rep) throw new Error('repositório não encontrado para este token.');
          if (rep.permissions && !rep.permissions.push) throw new Error('o token não tem permissão de escrita (Contents: Read and write).');
          await cfg.set(n); Painel.fecharModal(); toast('<i class="fa-solid fa-circle-check"></i> GitHub conectado neste navegador', 3500); marcarStatus();
        } catch (e) { msg.textContent = 'Não funcionou: ' + (e.message || e); }
      } },
    ]);
  };

  /* ---------- tela: status, seletor de dia e período ---------- */
  const marcarStatus = async () => {
    const bt = $('#btnSync'); if (!bt) return;
    const c = await cfg.get(), p = SUPORTA_PASTA ? await pastaGuardada() : null;
    let ult = null; try { ult = localStorage.getItem(ULT); } catch (e) { /* */ }
    bt.classList.toggle('girando', SYNC);
    const tip = $('#syncTip');
    if (tip) tip.textContent = SYNC ? 'Sincronizando…' : `Sincronizar pasta${p ? ' ' + p.name : ''}${ult ? ' · última: ' + new Date(ult).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''}${c && c.token ? '' : ' · GitHub não configurado'}`;
  };

  // seletor "ver outro dia" no chip da data
  const abrirDia = async d => {
    if (!d) return;
    if (Painel.atual && Painel.atual.raw.meta?.dataRelatorio === d) { Painel.voltarAtual(); fecharPop(); return; }
    const x = await lerDia(d);
    if (!x || !x.dados) { toast(`<i class="fa-solid fa-circle-info"></i> O relatório de ${br(d)} não foi encontrado no GitHub${Layout.editor() ? ' · clique em Sincronizar no Histórico para publicá-lo' : ''}`, 5000); return; }
    Painel.mostrarDia(x.dados, x.analise || null);
    fecharPop();
    if (Layout.pagina() === 'historico') location.hash = 'ct';
    toast(`<i class="fa-regular fa-calendar"></i> Mostrando o relatório de ${br(d)}`, 2600);
  };
  H.abrirDia = abrirDia;
  const fecharPop = () => { const p = $('#diaPop'); if (p) p.hidden = true; };
  const montarPop = () => {
    const chip = $('#reportChip'); if (!chip || $('#diaPop')) return;
    chip.classList.add('is-btn'); chip.setAttribute('role', 'button'); chip.tabIndex = 0; chip.title = 'Ver o relatório de outro dia';
    const pop = document.createElement('div'); pop.id = 'diaPop'; pop.className = 'dia-pop'; pop.hidden = true;
    chip.parentNode.insertBefore(pop, chip.nextSibling);
    const abre = () => {
      const ds = datas();
      pop.innerHTML = `<b>Ver outro dia</b>
        ${ds.length ? `<label class="dp-in"><input type="date" id="dpData" min="${ds[0]}" max="${ds[ds.length - 1]}" value="${Painel.raw?.meta?.dataRelatorio || ds[ds.length - 1]}"></label>
        <div class="dp-rec">${ds.slice(-8).reverse().map(d => `<button type="button" data-d="${d}" class="${d === Painel.raw?.meta?.dataRelatorio ? 'is-on' : ''}">${brC(d)}</button>`).join('')}</div>` : '<p class="hint">O histórico ainda está vazio. Sincronize a pasta na página Histórico.</p>'}
        <button type="button" class="bt" data-ultimo><i class="fa-solid fa-clock-rotate-left"></i>Voltar ao mais recente</button>`;
      pop.hidden = false;
    };
    chip.addEventListener('click', e => { e.stopPropagation(); if (pop.hidden) abre(); else fecharPop(); });
    chip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chip.click(); } });
    pop.addEventListener('click', e => {
      e.stopPropagation();
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.d) abrirDia(b.dataset.d);
      if (b.hasAttribute('data-ultimo')) { Painel.voltarAtual(); fecharPop(); }
    });
    pop.addEventListener('change', e => {
      if (e.target.id !== 'dpData') return;
      const d = e.target.value, ds = datas();
      if (ds.includes(d)) return abrirDia(d);
      const prox = ds.reduce((m, x) => (m == null || Math.abs(new Date(x) - new Date(d)) < Math.abs(new Date(m) - new Date(d)) ? x : m), null);
      toast(`Sem relatório em ${br(d)}${prox ? ` · abrindo ${br(prox)}` : ''}`, 3200);
      if (prox) abrirDia(prox);
    });
    document.addEventListener('click', fecharPop);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharPop(); });
  };

  /* ---------- período (página Histórico) ---------- */
  const G = {};
  const CR = { rod: '#2E6B3A', tri: '#C9973A' }; // Rodotrem x Tritrem (paleta validada para daltonismo)
  const ST = { ok: '#3C8A44', warn: '#D9A21B', bad: '#C9473A' };
  const graf = (id, cfgG) => { if (G[id]) G[id].destroy(); const el = document.getElementById(id); if (!el || !window.Chart) return null; G[id] = new Chart(el, cfgG); return G[id]; };
  const curtoK = v => (Math.abs(v) >= 1000 ? `${nf(v / 1000, 1)}k` : nf(v, 0));
  const curto = v => (Math.abs(v) >= 1000 ? `${nf(v / 1000, Math.abs(v) >= 10000 ? 1 : 2)} mil` : nf(v, 0));
  const anim = { duration: 650, easing: 'easeOutQuart', delay: c => (c.type === 'data' && c.mode === 'default' ? c.dataIndex * 28 + c.datasetIndex * 60 : 0) };

  // texto com contorno branco (legível sobre linhas e grade)
  const texto = (ctx, t, x, y, cor) => { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineJoin = 'round'; ctx.strokeText(t, x, y); ctx.fillStyle = cor; ctx.fillText(t, x, y); };
  // rótulos de dados: todos quando cabem (e até "limite" pontos); senão, só o maior, o menor e o último
  const rotulos = ({ fmt, ds = [0], cor = C.ink, total = null, acima = null, limite = 40 }) => ({
    id: 'rotulos', afterDatasetsDraw(ch) {
      const { ctx, scales: { y: ey } } = ch;
      const meta0 = ch.getDatasetMeta(ds[0]); if (!meta0 || meta0.hidden) return;
      const pts = meta0.data, n = pts.length; if (!n) return;
      ctx.save(); ctx.font = '600 10.5px Archivo, sans-serif'; ctx.textAlign = 'center';
      const valores = total ? total() : ch.data.datasets[ds[0]].data;
      const fin = valores.filter(Number.isFinite); if (!fin.length) { ctx.restore(); return; }
      const amostra = fmt(Math.max(...fin));
      const passo = n > 1 ? Math.abs(pts[1].x - pts[0].x) : 999;
      let mostrar = new Set(valores.map((_, i) => i));
      if (n > limite || passo < ctx.measureText(amostra).width + 6) {
        const idx = valores.map((v, i) => [v, i]).filter(x => Number.isFinite(x[0]));
        const mx = idx.reduce((p, q) => (q[0] > p[0] ? q : p)), mn = idx.reduce((p, q) => (q[0] < p[0] ? q : p));
        mostrar = new Set([mx[1], mn[1], n - 1]);
      }
      pts.forEach((p, i) => {
        const v = valores[i]; if (!Number.isFinite(v) || !mostrar.has(i)) return;
        let y;
        if (total) { const topo = ds.map(k => ch.getDatasetMeta(k)).filter(m => !m.hidden).map(m => m.data[i].y); y = Math.min(...topo); }
        else y = p.y - (p.options?.radius || 0);
        if (acima && Number.isFinite(acima[i])) y = Math.min(y, ey.getPixelForValue(acima[i]));
        texto(ctx, fmt(v), p.x, y - 6, cor);
      });
      ctx.restore();
    },
  });
  // média (tracejada) e meta (pontilhada); as etiquetas ficam na margem direita, fora dos dados
  const MARGEM = 96;
  const linhas = ({ media: vm, fmtMedia, meta: vt, fmtMeta }) => ({
    id: 'linhas',
    beforeDatasetsDraw(ch) {
      const { ctx, chartArea: a, scales: { y } } = ch;
      ctx.save();
      if (Number.isFinite(vt)) { const yy = y.getPixelForValue(vt); if (yy >= a.top && yy <= a.bottom) { ctx.strokeStyle = C.palha; ctx.lineWidth = 1.3; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(a.left, yy); ctx.lineTo(a.right, yy); ctx.stroke(); } }
      if (Number.isFinite(vm)) { const yy = y.getPixelForValue(vm); if (yy >= a.top && yy <= a.bottom) { ctx.strokeStyle = 'rgba(24,48,31,.7)'; ctx.lineWidth = 1.4; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(a.left, yy); ctx.lineTo(a.right, yy); ctx.stroke(); } }
      ctx.restore();
    },
    afterDraw(ch) {
      const { ctx, chartArea: a, scales: { y } } = ch;
      ctx.save(); ctx.font = '700 11px Archivo, sans-serif'; ctx.textAlign = 'left';
      let yMed = null;
      if (Number.isFinite(vm)) {
        const yy = y.getPixelForValue(vm);
        if (yy >= a.top - 2 && yy <= a.bottom + 2) {
          const t = fmtMedia(vm), w = Math.min(MARGEM - 8, ctx.measureText(t).width + 14), x = a.right + 6;
          ctx.fillStyle = C.ink; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, yy - 10, w, 20, 10); else ctx.rect(x, yy - 10, w, 20); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(t, x + w / 2, yy + 4); ctx.textAlign = 'left'; yMed = yy;
        }
      }
      if (Number.isFinite(vt)) {
        let yy = y.getPixelForValue(vt);
        if (yy >= a.top - 2 && yy <= a.bottom + 2) {
          if (yMed != null && Math.abs(yy - yMed) < 20) yy = yy > yMed ? yMed + 22 : yMed - 22;
          ctx.font = '600 10.5px Archivo, sans-serif'; ctx.fillStyle = C.palha; ctx.fillText(`meta ${fmtMeta(vt)}`, a.right + 8, yy + 4);
        }
      }
      ctx.restore();
    },
  });
  // traço da cota de cada dia em cima da barra
  const tracos = (valores, cor = C.ink) => ({
    id: 'tracos', afterDatasetsDraw(ch) {
      const { ctx, scales: { y } } = ch, m = ch.getDatasetMeta(0); if (m.hidden) return;
      ctx.save(); ctx.strokeStyle = cor; ctx.lineWidth = 2; ctx.lineCap = 'round';
      m.data.forEach((b, i) => { const v = valores[i]; if (!Number.isFinite(v)) return; const yy = y.getPixelForValue(v); ctx.beginPath(); ctx.moveTo(b.x - b.width / 2 - 3, yy); ctx.lineTo(b.x + b.width / 2 + 3, yy); ctx.stroke(); });
      ctx.restore();
    },
  });
  // linha vertical que acompanha o mouse nos gráficos de linha
  const mira = { id: 'mira', afterDraw(ch) { const at = ch.tooltip && ch.tooltip.getActiveElements(); if (!at || !at.length) return; const { ctx, chartArea: a } = ch; const x = at[0].element.x; ctx.save(); ctx.strokeStyle = 'rgba(24,48,31,.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke(); ctx.restore(); } };
  const tooltipBase = { backgroundColor: 'rgba(24,48,31,.95)', padding: 11, cornerRadius: 9, titleFont: { weight: '700', size: 12.5 }, bodyFont: { size: 12 }, footerFont: { size: 11, weight: '500' }, footerColor: '#C9D6C3', displayColors: true, boxPadding: 4 };
  const opc = (lista, { y = {}, tooltip = {}, clicavel = true, legenda = false, stacked = false } = {}) => ({
    responsive: true, maintainAspectRatio: false, animation: anim,
    layout: { padding: { top: 22, right: MARGEM } },
    interaction: { mode: 'index', intersect: false },
    onClick: clicavel ? (e, els) => { if (els.length) abrirDia(lista[els[0].index].d); } : undefined,
    onHover: (e, els) => { e.native.target.style.cursor = clicavel && els.length ? 'pointer' : 'default'; },
    scales: { x: { stacked, grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 14, color: C.muted } }, y: { stacked, grid: { color: C.hair }, border: { display: false }, beginAtZero: true, ticks: { color: C.muted, maxTicksLimit: 6 }, ...y } },
    plugins: { legend: legenda ? { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3, padding: 14 } } : { display: false }, tooltip: { ...tooltipBase, ...tooltip } },
  });
  const spark = (vals, cor) => {
    const v = vals.filter(Number.isFinite); if (v.length < 2) return '';
    const w = 70, h = 20, mn = Math.min(...v), mx = Math.max(...v), r = mx - mn || 1;
    const pts = v.map((x, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - 2 - (x - mn) / r * (h - 4)).toFixed(1)}`).join(' ');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${cor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  };
  const k = ({ t, ic, v, un = '', sub = '', st = '' }) => `<div class="k${st ? ' is-' + st : ''}"><div class="k__t"><span>${t}</span><i class="fa-solid ${ic}"></i></div><div class="k__v">${v}${un ? `<small>${un}</small>` : ''}</div><div class="k__s">${sub}</div></div>`;
  const stP = p => (p == null ? '' : p >= 100 ? 'ok' : p >= 90 ? 'warn' : 'bad');
  const corP = p => ST[stP(p)] || C.folha;
  const seg = (id, ops, on) => `<div class="hseg" id="${id}">${ops.map(([v, t]) => `<button type="button" data-v="${v}" class="${v === on ? 'is-on' : ''}">${t}</button>`).join('')}</div>`;

  let PER = { de: null, ate: null }, MODO = { prod: 't', log: 't' };
  let L = [], CTX = {};
  const renderPeriodo = () => {
    const box = $('#histConteudo'); if (!box) return;
    const ds = datas();
    if (!ds.length) {
      box.innerHTML = `<div class="card hist-vazio"><i class="fa-regular fa-folder-open"></i><h3>O histórico ainda está vazio</h3><p>Os relatórios aparecem aqui depois da primeira sincronização da pasta de PDFs.</p></div>`;
      return;
    }
    if (!PER.ate || PER.ate > ds[ds.length - 1]) PER.ate = ds[ds.length - 1];
    if (!PER.de) PER.de = addDias(PER.ate, -29);
    $('#hDe').value = PER.de; $('#hAte').value = PER.ate;
    ['hDe', 'hAte'].forEach(id => { $('#' + id).min = ds[0]; $('#' + id).max = ds[ds.length - 1]; });
    L = ds.filter(d => d >= PER.de && d <= PER.ate).map(d => IDX.dias[d]).filter(r => Number.isFinite(r.prod));
    if (!L.length) { box.innerHTML = `<div class="card hist-vazio"><i class="fa-regular fa-calendar-xmark"></i><h3>Nenhum relatório entre ${br(PER.de)} e ${br(PER.ate)}</h3><p>Escolha outro intervalo.</p></div>`; return; }
    const metas = Painel.metas;
    const n = L.length, mProd = soma(L, r => r.prod) / n, mCota = soma(L, r => r.cota) / n;
    const pct = media(L, r => (r.cota ? r.prod / r.cota * 100 : null));
    const ef = media(L, r => r.ef), ind = media(L, r => r.ind), ader = media(L, r => r.ader);
    const comEc = L.filter(r => r.ec), ecP = media(comEc, r => r.ec.ent / r.ec.meta * 100);
    const melhor = [...L].sort((a, b) => b.prod / b.cota - a.prod / a.cota)[0], pior = [...L].sort((a, b) => a.prod / a.cota - b.prod / b.cota)[0];
    // frentes
    const F = new Map();
    L.forEach(r => (r.fr || []).forEach(([fr, p, c, e, i]) => {
      const x = F.get(fr) || { fr, dias: 0, prod: 0, cota: 0, na: 0, ef: [], ind: [], serie: [] };
      x.dias++; x.prod += p || 0; x.cota += c || 0; if (c && p >= c) x.na++;
      if (Number.isFinite(e)) x.ef.push(e); if (Number.isFinite(i)) x.ind.push(i); x.serie.push(c ? p / c * 100 : null);
      F.set(fr, x);
    }));
    const ordF = s => { const m = String(s).match(/(\d+)/); return m ? +m[1] : 999; };
    const frentes = [...F.values()].filter(f => f.cota > 0).sort((a, b) => ordF(a.fr) - ordF(b.fr));
    // colhedoras
    const CO = new Map();
    L.forEach(r => (r.col || []).forEach(([id, tc, fr]) => { const x = CO.get(id) || { id, fr, dias: 0, tc: 0 }; x.dias++; x.tc += tc || 0; x.fr = fr; CO.set(id, x); }));
    const dois = new Set((metas.colhedoras2Linhas || []).map(String));
    const colh = [...CO.values()].map(c => ({ ...c, med: c.tc / c.dias, meta: dois.has(c.id) ? metas.metaColhedora2Linhas : metas.metaColhedora1Linha })).sort((a, b) => b.med - a.med);
    // transporte
    const logT = soma(L, r => r.log?.tot), rod = soma(L, r => r.log?.rod), tri = soma(L, r => r.log?.tri), via = soma(L, r => r.log?.via);
    CTX = { metas, mProd, mCota, pct, ef, ind, frentes, colh, logT, rod, tri, via, n };

    box.innerHTML = `
      <section class="section section--first" id="hResumo" data-nome="Resumo">
        <div class="g-k g-k5">
          ${k({ t: 'Produção média por dia', ic: 'fa-wheat-awn', v: nf(mProd, 0), un: 't/dia', sub: `cota média de <b>${nf(mCota, 0)} t/dia</b>`, st: stP(pct) })}
          ${k({ t: 'Atingimento médio da cota', ic: 'fa-bullseye', v: nf(pct, 1), un: '%', sub: `melhor ${brC(melhor.d)} · pior ${brC(pior.d)}`, st: stP(pct) })}
          ${k({ t: 'Eficiência operacional média', ic: 'fa-gauge-high', v: nf(ef, 1), un: '%', sub: `meta ${nf(metas.eficiencia, 0)}%`, st: ef == null ? '' : ef >= metas.eficiencia ? 'ok' : ef >= metas.eficiencia * .9 ? 'warn' : 'bad' })}
          ${k({ t: 'Indisponibilidade média', ic: 'fa-screwdriver-wrench', v: nf(ind, 1), un: '%', sub: `meta ≤ ${nf(metas.indisponibilidade, 0)}%`, st: ind == null ? '' : ind <= metas.indisponibilidade ? 'ok' : 'bad' })}
          ${comEc.length ? k({ t: 'Entrega x meta média (Flow)', ic: 'fa-truck-ramp-box', v: nf(ecP, 1), un: '%', sub: `${nf(soma(comEc, r => r.ec.ent) / comEc.length, 0)} t/dia · ${comEc.length} ${comEc.length === 1 ? 'dia' : 'dias'}`, st: stP(ecP) }) : k({ t: 'Aderência de velocidade média', ic: 'fa-gauge', v: Number.isFinite(ader) ? sg(ader, 1) : '—', un: Number.isFinite(ader) ? '%' : '', sub: 'realizada sobre a dimensionada', st: !Number.isFinite(ader) ? '' : ader >= -5 ? 'ok' : ader >= -10 ? 'warn' : 'bad' })}
        </div>
      </section>

      <section class="section" id="hProd" data-nome="Produção">
        <article class="card"><header class="card__head"><div><h3>Produção por dia</h3><p class="hint" id="hpHint"></p></div>${seg('segProd', [['t', 'Toneladas'], ['p', '% da cota']], MODO.prod)}</header>
          <div class="hleg"><span><i class="sw" style="background:${ST.ok}"></i>na cota</span><span><i class="sw" style="background:${ST.warn}"></i>até 10% abaixo</span><span><i class="sw" style="background:${ST.bad}"></i>mais de 10% abaixo</span><span><i class="tr"></i><em id="hpTr">cota do dia</em></span><span><i class="md"></i>média do período</span></div>
          <div class="chart-box hist-cv"><canvas id="hcProd" role="img" aria-label="Produção por dia"></canvas></div></article>
        <div class="grid grid--2" style="margin-top:14px">
          <article class="card"><header class="card__head"><div><h3>Eficiência operacional por dia</h3><p class="hint">Pontilhado = meta de ${nf(metas.eficiencia, 0)}% · tracejado = média</p></div></header><div class="chart-box hist-cv sm"><canvas id="hcEf" role="img" aria-label="Eficiência por dia"></canvas></div></article>
          <article class="card"><header class="card__head"><div><h3>Indisponibilidade por dia</h3><p class="hint">Pontilhado = meta de ${nf(metas.indisponibilidade, 0)}% · tracejado = média</p></div></header><div class="chart-box hist-cv sm"><canvas id="hcInd" role="img" aria-label="Indisponibilidade por dia"></canvas></div></article>
        </div>
      </section>

      <section class="section" id="hFrentes" data-nome="Frentes">
        <div class="grid hgrid-fr">
          <article class="card"><header class="card__head"><div><h3>Produção média por frente</h3><p class="hint">t por dia · traço = cota média · cor = atingimento médio</p></div></header>
            <div class="chart-box" style="height:${Math.max(260, frentes.length * 34 + 40)}px"><canvas id="hcFr" role="img" aria-label="Produção média por frente"></canvas></div></article>
          <article class="card"><header class="card__head"><div><h3>Frentes no período</h3><p class="hint">Médias por dia com relatório e a tendência do atingimento</p></div></header>
            <div class="table-wrap"><table class="simple-table hist-tab">
              <thead><tr><th>Frente</th><th class="num">Média/dia (t)</th><th class="num">Atingimento</th><th>Tendência</th><th class="num">Eficiência</th><th class="num">Indisp.</th></tr></thead>
              <tbody>${frentes.map(f => { const p = media(f.serie, x => x), e = media(f.ef, x => x), i = media(f.ind, x => x); return `<tr>
                <td><b>${esc(f.fr)}</b></td><td class="num"><b>${nf(f.prod / f.dias, 0)}</b></td>
                <td class="num">${p != null ? `<span class="pill ${stP(p)}">${nf(p, 1)}%</span>` : '—'}</td><td>${spark(f.serie, corP(p))}</td>
                <td class="num">${e != null ? `<span class="pill ${e >= metas.eficiencia ? 'ok' : e >= metas.eficiencia * .9 ? 'warn' : 'bad'}">${nf(e, 1)}%</span>` : '—'}</td>
                <td class="num">${i != null ? nf(i, 1) + '%' : '—'}</td></tr>`; }).join('')}</tbody>
              <tfoot><tr><td>Média da usina</td><td class="num">${nf(mProd, 0)}</td><td class="num">${nf(pct, 1)}%</td><td></td><td class="num">${nf(ef, 1)}%</td><td class="num">${nf(ind, 1)}%</td></tr></tfoot>
            </table></div></article>
        </div>
      </section>

      <section class="section" id="hMaq" data-nome="Máquinas">
        <article class="card"><header class="card__head"><div><h3>Colhedoras: média por dia trabalhado</h3><p class="hint">Verde = média acima da meta · traço = meta (1 linha ${nf(metas.metaColhedora1Linha)} t · 2 linhas ${nf(metas.metaColhedora2Linhas)} t)</p></div></header>
          <div class="chart-box hist-cv"><canvas id="hcCol" role="img" aria-label="Média por colhedora"></canvas></div></article>
      </section>

      ${TRANSP && TRANSP.dias && TRANSP.dias.length ? htmlTransporte() : `
      <section class="section" id="hTransp" data-nome="Transporte">
        <div class="g-k g-k4">
          ${k({ t: 'Entregue média por dia', ic: 'fa-route', v: nf(logT / n, 0), un: 'TC/dia', sub: `média de ${n} ${n === 1 ? 'dia' : 'dias'} com relatório` })}
          ${k({ t: 'Rodotrem', ic: 'fa-truck-moving', v: nf(logT ? rod / logT * 100 : null, 1), un: '%', sub: `média de ${nf(rod / n, 0)} TC/dia` })}
          ${k({ t: 'Tritrem', ic: 'fa-trailer', v: nf(logT ? tri / logT * 100 : null, 1), un: '%', sub: `média de ${nf(tri / n, 0)} TC/dia` })}
          ${k({ t: 'Carga média', ic: 'fa-weight-hanging', v: nf(via ? logT / via : null, 1), un: 'TC/viagem', sub: `média de ${nf(via / n, 0)} viagens/dia` })}
        </div>
        <div class="grid hgrid-log" style="margin-top:14px">
          <article class="card"><header class="card__head"><div><h3>Entregue por dia</h3><p class="hint" id="hlHint"></p></div>${seg('segLogH', [['t', 'TC'], ['p', '% do dia']], MODO.log)}</header>
            <div class="chart-box hist-cv"><canvas id="hcLog" role="img" aria-label="Entregue por dia"></canvas></div></article>
          <article class="card"><header class="card__head"><div><h3>Composição no período</h3><p class="hint">Média do Total Entregue Consolidado</p></div></header>
            <div class="chart-box hist-cv"><canvas id="hcComp" role="img" aria-label="Composição Rodotrem e Tritrem"></canvas></div></article>
        </div>
        <article class="card" style="margin-top:14px"><header class="card__head"><div><h3>Carga média por dia</h3><p class="hint">TC por viagem · tracejado = média</p></div></header>
          <div class="chart-box hist-cv sm"><canvas id="hcTcv" role="img" aria-label="Carga média por dia"></canvas></div></article>
      </section>`}`;

    desenharProd(); desenharEf(); desenharInd(); desenharFr(); desenharCol();
    if ($('#hcTp')) {
      desenharTP();
      $('#segTpModo').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; TPV.modo = b.dataset.v; $$('#segTpModo button').forEach(x => x.classList.toggle('is-on', x === b)); desenharTP(); });
      $('#segTpUn').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; TPV.un = b.dataset.v; $$('#segTpUn button').forEach(x => x.classList.toggle('is-on', x === b)); desenharTP(); });
    } else { desenharLog(); desenharComp(); desenharTcv(); }
    $('#segProd').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; MODO.prod = b.dataset.v; $$('#segProd button').forEach(x => x.classList.toggle('is-on', x === b)); desenharProd(); });
    if ($('#segLogH')) $('#segLogH').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; MODO.log = b.dataset.v; $$('#segLogH button').forEach(x => x.classList.toggle('is-on', x === b)); desenharLog(); });
    if (Layout.pagina() === 'historico') { Layout.secoes(); Layout.animar($('.page.is-on')); }
  };

  /* ---------- Transporte pela planilha de viagens ---------- */
  const CP = { 'Próprio': '#3D72B8', Happening: '#C2703F', RGE: '#7C8A95' }; // prestadores (paleta validada)
  const corPrest = p => CP[p] || '#7C8A95';
  const prestOf = k => { const p = k.split(' - ')[0].trim().split(/\s+/)[0]; return /^pr[oó]prio$/i.test(p) ? 'Próprio' : p; };
  const tipoOf = k => (/tritrem/i.test(k) ? 'Tritrem' : 'Rodotrem');
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const aggT = dias => {
    const o = { t: 0, v: 0, n: dias.filter(x => x.moagem > 0).length, prest: {}, tipo: {}, pt: {} };
    const add = (m, k, t, v) => { const x = m[k] || (m[k] = { t: 0, v: 0 }); x.t += t; x.v += v; };
    dias.forEach(x => Object.entries(x.fr).forEach(([k, [t, v]]) => { o.t += t; o.v += v; add(o.prest, prestOf(k), t, v); add(o.tipo, tipoOf(k), t, v); add(o.pt, `${prestOf(k)}|${tipoOf(k)}`, t, v); }));
    return o;
  };
  const ordemPrest = ps => ['Próprio', 'Happening', 'RGE', ...ps.filter(p => !['Próprio', 'Happening', 'RGE'].includes(p))].filter(p => ps.includes(p));
  const barra100 = (partes, total) => `<div class="tp-bar">${partes.filter(p => p.t > 0).map(p => { const w = total ? p.t / total * 100 : 0; return `<span style="--w:${w.toFixed(2)}%;background:${p.cor}" title="${esc(p.nome)}: ${nf(p.t, 0)} t · ${nf(w, 1)}%">${w >= 14 ? `<b>${esc(p.nome)}</b> ${nf(w, 0)}%` : w >= 6 ? `${nf(w, 0)}%` : ''}</span>`; }).join('')}</div>`;
  // % sempre sobre a moagem (t totais) do dia, do mês ou da safra — o mesmo "%Transportada" da planilha
  const resumoTP = (dias, linha) => {
    if (linha && linha.moagem > 0) return { moagem: linha.moagem, fr: linha.fr, n: dias.filter(x => x.moagem > 0).length };
    const o = { moagem: 0, fr: {}, n: dias.filter(x => x.moagem > 0).length };
    dias.forEach(x => { o.moagem += x.moagem || 0; Object.entries(x.fr).forEach(([k, [t, v]]) => { const f = o.fr[k] || (o.fr[k] = [0, 0, null]); f[0] += t; f[1] += v; }); });
    if (dias.length === 1) Object.entries(dias[0].fr).forEach(([k, f]) => { if (Number.isFinite(f[2])) o.fr[k][2] = f[2]; });
    return o;
  };
  // arredonda para inteiros que somam exatamente 100 (maiores restos)
  const arred100 = vals => {
    const tot = vals.reduce((s, v) => s + v, 0); if (!tot) return vals.map(() => 0);
    const ex = vals.map(v => v / tot * 100), base = ex.map(Math.floor);
    let falta = 100 - base.reduce((s, v) => s + v, 0);
    ex.map((v, i) => [v - base[i], i]).sort((x, y) => y[0] - x[0]).forEach(([, i]) => { if (falta > 0) { base[i]++; falta--; } });
    return base;
  };
  const cartaoTP = (rotulo, titulo, R) => {
    // % de cada frota = "%Transportada" da planilha, normalizada para o conjunto fechar 100%
    const pctDe = f => (Number.isFinite(f[2]) ? f[2] : (R.moagem ? f[0] / R.moagem : 0));
    const A = { t: 0, v: 0, prest: {}, tipo: {}, pt: {} };
    const add = (m, k, f) => { const x = m[k] || (m[k] = { t: 0, v: 0, p: 0 }); x.t += f[0]; x.v += f[1]; x.p += pctDe(f); };
    Object.entries(R.fr).forEach(([k, f]) => { A.t += f[0]; A.v += f[1]; add(A.prest, prestOf(k), f); add(A.tipo, tipoOf(k), f); add(A.pt, `${prestOf(k)}|${tipoOf(k)}`, f); });
    if (!A.t) return `<article class="card tp"><div class="tp-h"><span>${rotulo}</span><b>${titulo}</b><small>sem entregas</small></div></article>`;
    const ps = ordemPrest(Object.keys(A.prest));
    const chaves = ps.flatMap(p => ['Rodotrem', 'Tritrem'].map(tp => `${p}|${tp}`));
    const c100 = arred100(chaves.map(k => (A.pt[k] ? A.pt[k].p : 0))), CEL = {}; chaves.forEach((k, i) => { CEL[k] = c100[i]; });
    const pr100 = arred100(ps.map(p => A.prest[p].p));
    const tps = ['Rodotrem', 'Tritrem'], tp100 = arred100(tps.map(tp => (A.tipo[tp] || {}).p || 0));
    const cel = k => { const x = A.pt[k]; return `${CEL[k]}%<small>${nf(x ? x.t : 0, 0)} t</small>`; };
    return `<article class="card tp">
      <div class="tp-h"><span>${rotulo}</span><b>${titulo}</b><small>${nf(A.t, 0)} t transportadas · ${nf(A.v, 0)} viagens${R.n > 1 ? ` · ${R.n} dias` : ''}</small></div>
      <div class="tp-sec">Por prestador</div>
      ${barraPct(ps.map((p, i) => ({ nome: p, t: A.prest[p].t, p: pr100[i], cor: corPrest(p) })))}
      <div class="tp-sec">Rodotrem x Tritrem</div>
      ${barraPct(tps.map((tp, i) => ({ nome: tp, t: (A.tipo[tp] || {}).t || 0, p: tp100[i], cor: tp === 'Rodotrem' ? CR.rod : CR.tri })))}
      <table class="tp-tab"><thead><tr><th></th><th>Rodotrem</th><th>Tritrem</th><th>Carga média</th></tr></thead><tbody>
        ${ps.map(p => { const tp = A.prest[p]; return `<tr><td><i class="sw" style="background:${corPrest(p)}"></i>${esc(p)}</td><td>${cel(`${p}|Rodotrem`)}</td><td>${cel(`${p}|Tritrem`)}</td><td>${tp.v ? nf(tp.t / tp.v, 1) : '—'}<small>t/viagem</small></td></tr>`; }).join('')}
      </tbody></table>
    </article>`;
  };
  const barraPct = partes => `<div class="tp-bar">${partes.filter(x => x.t > 0).map(x => `<span style="--w:${x.p}%;background:${x.cor}" title="${esc(x.nome)}: ${nf(x.t, 0)} t · ${x.p}%">${x.p >= 14 ? `<b>${esc(x.nome)}</b> ${x.p}%` : x.p >= 6 ? `${x.p}%` : ''}</span>`).join('')}</div>`;
  const motivos = (dias, campoPos, campoMot) => {
    const M = new Map();
    dias.forEach(x => { const m = x[campoMot]; if (!m) return; const k = m.trim().toUpperCase(); const y = M.get(k) || { nome: k, dias: 0, abaixo: 0 }; y.dias++; if ((x[campoPos] || 0) < 0) y.abaixo += x[campoPos]; M.set(k, y); });
    return [...M.values()].sort((a, b) => b.dias - a.dias || a.abaixo - b.abaixo);
  };
  const tituloMot = s => s.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(E|De|Da|Do)\b/g, w => w.toLowerCase());
  const blocoJust = (nome, cor, dias, ultimo, campoPos, campoMot) => {
    const ms = motivos(dias, campoPos, campoMot), mx = ms[0] ? ms[0].dias : 1;
    const comMot = dias.filter(x => x[campoMot]).length;
    return `<article class="card tj">
      <header class="tj-h"><i class="sw" style="background:${cor}"></i><b>${nome}</b><span class="tj-dias">${comMot} ${comMot === 1 ? 'dia' : 'dias'} com justificativa</span></header>
      ${ultimo ? `<div class="tj-ult"><span>${brC(ultimo.d)}</span><em>${esc(ultimo[campoMot] ? tituloMot(ultimo[campoMot]) : 'sem justificativa')}</em></div>` : ''}
      <div class="tj-sec">Motivos no período</div>
      <div class="hrank tj-rank">${ms.map((m, i) => `<div><span class="n">${i + 1}</span><span class="nm" title="${esc(m.nome)}">${esc(tituloMot(m.nome))}</span><span class="bar"><i style="width:${m.dias / mx * 100}%;background:${cor}"></i></span><b>${m.dias} ${m.dias === 1 ? 'dia' : 'dias'}</b></div>`).join('') || '<p class="hint">Sem justificativas no período.</p>'}</div>
      <details class="tj-lista"><summary>Ver dia a dia</summary><div class="tj-tab"><table><tbody>${[...dias].reverse().filter(x => x[campoMot]).map(x => `<tr><td>${brC(x.d)}</td><td>${esc(tituloMot(x[campoMot]))}</td></tr>`).join('')}</tbody></table></div></details>
    </article>`;
  };
  let TPV = { modo: 'prest', un: 't' };
  // se o período termina no último relatório, a planilha entra até o último dia dela
  const ateTP = () => { const ds = datas(); return PER.ate >= ds[ds.length - 1] ? '9999-12-31' : PER.ate; };
  const htmlTransporte = () => {
    const todos = TRANSP.dias.filter(x => x.d <= ateTP());
    const comMoagem = todos.filter(x => x.moagem > 0);
    const ancora = (comMoagem[comMoagem.length - 1] || todos[todos.length - 1]);
    if (!ancora) return '';
    const mes = ancora.d.slice(0, 7);
    const doMes = todos.filter(x => x.d.startsWith(mes));
    // linhas Total e Total Safra da aba do mês (valem quando o dia de referência é o último lançado no mês)
    const linhaMes = (TRANSP.meses && TRANSP.meses[mes]) || {};
    const ultimoDoMes = !TRANSP.dias.some(x => x.d.startsWith(mes) && x.d > ancora.d && x.moagem > 0);
    const periodo = TRANSP.dias.filter(x => x.d >= PER.de && x.d <= ateTP());
    const Ap = aggT(periodo), dPer = periodo.filter(x => x.moagem > 0).length || 1;
    const fonte = IDX.transporte ? IDX.transporte.nome : TRANSP.meta.arquivo;
    return `
      <section class="section" id="hTransp" data-nome="Transporte">
        <div class="tp-topo"><h2 class="tp-tit"><i class="fa-solid fa-truck-moving"></i>Divisão do transporte</h2><span class="hint">Planilha ${esc(fonte)} · até ${br(TRANSP.dias[TRANSP.dias.length - 1].d)}</span></div>
        <div class="tp-grid">
          ${cartaoTP('Dia', br(ancora.d), resumoTP([ancora]))}
          ${cartaoTP('Mês', MESES[+mes.slice(5) - 1].replace(/^./, c => c.toUpperCase()) + ' até ' + brC(ancora.d), resumoTP(doMes, ultimoDoMes ? linhaMes.total : null))}
          ${cartaoTP('Safra', `${brC(todos[0].d)} a ${brC(ancora.d)}`, resumoTP(todos, ultimoDoMes ? linhaMes.safra : null))}
        </div>
        <div class="g-k g-k4" style="margin-top:14px">
          ${k({ t: 'Entregue média por dia', ic: 'fa-route', v: nf(Ap.t / dPer, 0), un: 't/dia', sub: `${dPer} ${dPer === 1 ? 'dia' : 'dias'} com entrega no período` })}
          ${k({ t: 'Viagens por dia', ic: 'fa-truck-fast', v: nf(Ap.v / dPer, 0), un: 'viagens', sub: `${nf(Ap.v, 0)} viagens no período` })}
          ${k({ t: 'Carga média', ic: 'fa-weight-hanging', v: nf(Ap.v ? Ap.t / Ap.v : null, 1), un: 't/viagem', sub: `Rodotrem ${nf(Ap.tipo.Rodotrem ? Ap.tipo.Rodotrem.t / Ap.tipo.Rodotrem.v : null, 1)} · Tritrem ${nf(Ap.tipo.Tritrem ? Ap.tipo.Tritrem.t / Ap.tipo.Tritrem.v : null, 1)}` })}
          ${k({ t: 'Próprio x Happening', ic: 'fa-people-arrows', v: `${nf(Ap.t && Ap.prest['Próprio'] ? Ap.prest['Próprio'].t / Ap.t * 100 : 0, 0)}<small>%</small> · ${nf(Ap.t && Ap.prest.Happening ? Ap.prest.Happening.t / Ap.t * 100 : 0, 0)}`, un: '%', sub: 'participação no entregue do período' })}
        </div>
        <article class="card" style="margin-top:14px"><header class="card__head"><div><h3>Entregue por dia</h3><p class="hint" id="tpHint"></p></div>
          <div class="tp-ctl">${seg('segTpModo', [['prest', 'Prestador'], ['tipo', 'Rodotrem x Tritrem']], TPV.modo)}${seg('segTpUn', [['t', 't'], ['p', '%']], TPV.un)}</div></header>
          <div class="chart-box hist-cv"><canvas id="hcTp" role="img" aria-label="Entregue por dia"></canvas></div></article>
        <div class="tp-topo" style="margin-top:22px"><h2 class="tp-tit"><i class="fa-solid fa-clipboard-list"></i>Justificativas da cota</h2><span class="hint">Motivo informado em cada dia do período</span></div>
        <div class="grid grid--2">
          ${blocoJust('Próprio', CP['Próprio'], periodo, [...periodo].reverse().find(x => x.motP), 'posP', 'motP')}
          ${blocoJust('Happening', CP.Happening, periodo, [...periodo].reverse().find(x => x.motH), 'posH', 'motH')}
        </div>
        <article class="card" style="margin-top:14px"><header class="card__head"><div><h3>Carga média por dia</h3><p class="hint">t por viagem de cada prestador</p></div></header>
          <div class="chart-box hist-cv sm"><canvas id="hcTpCarga" role="img" aria-label="Carga média por prestador"></canvas></div></article>
      </section>`;
  };
  const desenharTP = () => {
    const P = TRANSP.dias.filter(x => x.d >= PER.de && x.d <= ateTP() && x.moagem > 0);
    if (!P.length || !$('#hcTp')) return;
    const pct = TPV.un === 'p';
    const tot = P.map(x => Object.values(x.fr).reduce((s, f) => s + f[0], 0));
    const grupos = TPV.modo === 'prest'
      ? ordemPrest([...new Set(P.flatMap(x => Object.keys(x.fr).map(prestOf)))]).map(p => ({ nome: p, cor: corPrest(p), f: k => prestOf(k) === p }))
      : ['Rodotrem', 'Tritrem'].map(t => ({ nome: t, cor: t === 'Rodotrem' ? CR.rod : CR.tri, f: k => tipoOf(k) === t }));
    const serie = g => P.map(x => Object.entries(x.fr).filter(([k2]) => g.f(k2)).reduce((s, [, f]) => s + f[0], 0));
    const brutos = grupos.map(serie);
    $('#tpHint').textContent = `${TPV.modo === 'prest' ? 'Próprio e Happening' : 'Rodotrem e Tritrem'} empilhados · ${pct ? 'participação no entregue do dia' : 'total no topo · tracejado = média'}`;
    const dl = P.map(x => brC(x.d));
    const ds = grupos.map((g, gi) => ({ label: g.nome, data: brutos[gi].map((v, i) => (pct ? (tot[i] ? v / tot[i] * 100 : 0) : v)), backgroundColor: g.cor, hoverBackgroundColor: g.cor + 'D9', borderColor: '#fff', borderWidth: { top: 2 }, borderSkipped: false, borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 34, categoryPercentage: .78, stack: 's' }));
    const lista = P.map(x => ({ d: x.d }));
    const o = opc(lista, { stacked: true, legenda: true, clicavel: false, y: pct ? { max: 100, ticks: { callback: v => v + '%', maxTicksLimit: 6, color: C.muted } } : { ticks: { callback: v => curto(v), maxTicksLimit: 6, color: C.muted } },
      tooltip: { callbacks: { title: it => { const dt = new Date(P[it[0].dataIndex].d + 'T12:00:00'); return `${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][dt.getDay()]}, ${br(P[it[0].dataIndex].d)}`; }, label: c => { const v = brutos[c.datasetIndex][c.dataIndex], t = tot[c.dataIndex]; return ` ${c.dataset.label}: ${nf(v, 0)} t · ${nf(t ? v / t * 100 : 0, 1)}%`; }, footer: it => ` Total: ${nf(tot[it[0].dataIndex], 0)} t` } } });
    o.scales.x.ticks = { ...o.scales.x.ticks, maxTicksLimit: 16 };
    graf('hcTp', { type: 'bar', data: { labels: dl, datasets: ds }, options: o,
      plugins: pct
        ? [{ id: 'pctIn', afterDatasetsDraw(ch) { const { ctx } = ch; ctx.save(); ctx.font = '700 10.5px Archivo, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ch.data.datasets.forEach((d, k2) => { const m = ch.getDatasetMeta(k2); if (m.hidden) return; m.data.forEach((b, i) => { if (b.height > 16 && b.width > 22) ctx.fillText(nf(d.data[i], 0) + '%', b.x, b.y + b.height / 2 + 4); }); }); ctx.restore(); } }]
        : [linhas({ media: soma(tot) / P.length, fmtMedia: v => 'média ' + curtoK(v) }), rotulos({ fmt: curtoK, ds: grupos.map((_, i) => i), total: () => P.map((_, i) => { const ch = G.hcTp; return grupos.reduce((s, g, gi) => s + (!ch || !ch.getDatasetMeta(gi).hidden ? brutos[gi][i] : 0), 0); }) })],
    });
    // carga média por prestador
    const ps = ordemPrest([...new Set(P.flatMap(x => Object.keys(x.fr).map(prestOf)))]);
    graf('hcTpCarga', {
      type: 'line',
      data: { labels: dl, datasets: ps.map(p => ({ label: p, data: P.map(x => { let t = 0, v = 0; Object.entries(x.fr).forEach(([k2, f]) => { if (prestOf(k2) === p) { t += f[0]; v += f[1]; } }); return v ? t / v : null; }), borderColor: corPrest(p), backgroundColor: corPrest(p), borderWidth: 2.2, tension: .35, pointRadius: 3, pointHoverRadius: 6, pointBorderColor: '#fff', pointBorderWidth: 1.5, spanGaps: true })) },
      options: opc(lista, { clicavel: false, legenda: true, y: { beginAtZero: false, ticks: { callback: v => nf(v, 0), maxTicksLimit: 5, color: C.muted } }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${nf(c.raw, 1)} t/viagem` } } }),
      plugins: [mira],
    });
    // barras 100% crescem ao aparecer
    requestAnimationFrame(() => requestAnimationFrame(() => $$('.tp-bar').forEach(b => b.classList.add('on'))));
  };

  const lbl = () => L.map(r => brC(r.d));
  const titDia = it => { const r = L[it[0].dataIndex]; const dt = new Date(r.d + 'T12:00:00'); return `${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][dt.getDay()]}, ${br(r.d)}`; };
  const rodapeDia = () => 'Clique para abrir o relatório do dia';

  const desenharProd = () => {
    const pctMode = MODO.prod === 'p';
    const val = L.map(r => (pctMode ? (r.cota ? r.prod / r.cota * 100 : null) : r.prod));
    const at = L.map(r => (r.cota ? r.prod / r.cota * 100 : null));
    $('#hpHint').textContent = pctMode ? 'Atingimento da cota em cada dia · 100% = cota batida' : 'Toneladas produzidas em cada dia contra a cota do dia';
    $('#hpTr').textContent = pctMode ? 'cota (100%)' : 'cota do dia';
    const fmtV = pctMode ? v => nf(v, 0) + '%' : curto;
    const medio = pctMode ? CTX.pct : CTX.mProd;
    graf('hcProd', {
      type: 'bar',
      data: { labels: lbl(), datasets: [{ label: pctMode ? 'Atingimento' : 'Produção', data: val, backgroundColor: at.map(corP), hoverBackgroundColor: at.map(p => corP(p) + 'CC'), borderRadius: 5, borderSkipped: 'bottom', maxBarThickness: 34, categoryPercentage: .78 }] },
      options: opc(L, { y: pctMode ? { suggestedMax: 110, ticks: { callback: v => v + '%', maxTicksLimit: 6, color: C.muted } } : { ticks: { callback: v => curto(v), maxTicksLimit: 6, color: C.muted } },
        tooltip: { mode: 'nearest', intersect: true, callbacks: { title: titDia, label: c => { const r = L[c.dataIndex]; return [` Produção: ${nf(r.prod, 0)} t`, ` Cota: ${nf(r.cota, 0)} t`, ` Atingimento: ${nf(r.prod / r.cota * 100, 1)}%`]; }, footer: rodapeDia } } }),
      plugins: [tracos(pctMode ? L.map(() => 100) : L.map(r => r.cota)), linhas({ media: medio, fmtMedia: pctMode ? v => 'média ' + nf(v, 1) + '%' : v => 'média ' + curtoK(v) + ' t' }), rotulos({ fmt: pctMode ? v => nf(v, 0) + '%' : curtoK, acima: pctMode ? L.map(() => 100) : L.map(r => r.cota) })],
    });
  };
  const desenharEf = () => {
    const m = CTX.metas.eficiencia;
    graf('hcEf', {
      type: 'line',
      data: { labels: lbl(), datasets: [{ label: 'Eficiência', data: L.map(r => r.ef), borderColor: C.folha, borderWidth: 2.2, tension: .35, fill: true,
        backgroundColor: c => { const { ctx, chartArea: a } = c.chart; if (!a) return 'rgba(60,122,53,.1)'; const g = ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, 'rgba(60,122,53,.22)'); g.addColorStop(1, 'rgba(60,122,53,0)'); return g; },
        pointRadius: 4, pointHoverRadius: 7, pointBackgroundColor: L.map(r => (r.ef >= m ? ST.ok : ST.bad)), pointBorderColor: '#fff', pointBorderWidth: 2 }] },
      options: opc(L, { y: { beginAtZero: false, suggestedMin: 40, suggestedMax: 100, ticks: { callback: v => v + '%', maxTicksLimit: 6, color: C.muted } }, tooltip: { callbacks: { title: titDia, label: c => ` Eficiência: ${nf(c.raw, 1)}%`, footer: rodapeDia } } }),
      plugins: [linhas({ media: CTX.ef, fmtMedia: v => 'média ' + nf(v, 1) + '%', meta: m, fmtMeta: v => nf(v, 0) + '%' }), rotulos({ fmt: v => nf(v, 0) + '%', limite: 12 }), mira],
    });
  };
  const desenharInd = () => {
    const m = CTX.metas.indisponibilidade;
    graf('hcInd', {
      type: 'bar',
      data: { labels: lbl(), datasets: [{ label: 'Indisponibilidade', data: L.map(r => r.ind), backgroundColor: L.map(r => (r.ind <= m ? ST.ok : ST.bad)), borderRadius: 5, borderSkipped: 'bottom', maxBarThickness: 28 }] },
      options: opc(L, { y: { ticks: { callback: v => v + '%', maxTicksLimit: 6, color: C.muted } }, tooltip: { mode: 'nearest', intersect: true, callbacks: { title: titDia, label: c => ` Indisponibilidade: ${nf(c.raw, 1)}%`, footer: rodapeDia } } }),
      plugins: [linhas({ media: CTX.ind, fmtMedia: v => 'média ' + nf(v, 1) + '%', meta: m, fmtMeta: v => nf(v, 0) + '%' }), rotulos({ fmt: v => nf(v, 0) + '%' })],
    });
  };
  const desenharFr = () => {
    const F = CTX.frentes;
    const med = F.map(f => f.prod / f.dias), cot = F.map(f => f.cota / f.dias), at = F.map(f => media(f.serie, x => x));
    graf('hcFr', {
      type: 'bar',
      data: { labels: F.map(f => f.fr), datasets: [{ label: 'Média/dia', data: med, backgroundColor: at.map(corP), borderRadius: 5, borderSkipped: 'start', maxBarThickness: 22 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: anim, layout: { padding: { right: 56, top: 14 } },
        scales: { x: { grid: { color: C.hair }, border: { display: false }, beginAtZero: true, suggestedMax: Math.max(...cot, ...med) * 1.06, ticks: { callback: v => curto(v), color: C.muted, maxTicksLimit: 6 } }, y: { grid: { display: false }, border: { display: false }, ticks: { color: C.ink, font: { weight: '600' } } } },
        plugins: { legend: { display: false }, tooltip: { ...tooltipBase, callbacks: { label: c => [` Média: ${nf(med[c.dataIndex], 0)} t/dia`, ` Cota média: ${nf(cot[c.dataIndex], 0)} t/dia`, ` Atingimento médio: ${nf(at[c.dataIndex], 1)}%`] } } } },
      plugins: [{ id: 'cotaFr', afterDatasetsDraw(ch) { const { ctx, scales: { x } } = ch; ctx.save(); ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ch.getDatasetMeta(0).data.forEach((b, i) => { const xx = x.getPixelForValue(cot[i]); ctx.beginPath(); ctx.moveTo(xx, b.y - b.height / 2 - 3); ctx.lineTo(xx, b.y + b.height / 2 + 3); ctx.stroke(); }); ctx.restore(); } },
        { id: 'rotFr', afterDatasetsDraw(ch) { const { ctx, chartArea: a } = ch; ctx.save(); ctx.font = '700 11px Archivo, sans-serif'; ch.getDatasetMeta(0).data.forEach((b, i) => { const t = `${nf(med[i], 0)} t`, w = ctx.measureText(t).width; if (b.x - a.left > w + 16) { ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.fillText(t, b.x - 8, b.y + 4); } else { ctx.textAlign = 'left'; texto(ctx, t, b.x + 6, b.y + 4, C.ink); } ctx.textAlign = 'left'; ctx.fillStyle = corP(at[i]); ctx.font = '700 11.5px Archivo, sans-serif'; ctx.fillText(`${nf(at[i], 0)}%`, a.right + 12, b.y + 4); ctx.font = '700 11px Archivo, sans-serif'; }); ctx.fillStyle = C.muted; ctx.font = '600 10.5px Archivo, sans-serif'; ctx.fillText('ating.', a.right + 12, a.top - 6); ctx.restore(); } }],
    });
  };
  const desenharCol = () => {
    const c = CTX.colh;
    graf('hcCol', {
      type: 'bar',
      data: { labels: c.map(x => x.id), datasets: [{ label: 'Média t/dia', data: c.map(x => x.med), backgroundColor: c.map(x => (x.med >= x.meta ? ST.ok : ST.bad)), borderRadius: 5, borderSkipped: 'bottom', maxBarThickness: 28 }] },
      options: (() => { const o = opc(L, { clicavel: false, y: { suggestedMax: Math.max(0, ...c.map(x => x.meta)) * 1.08, ticks: { callback: v => nf(v, 0), maxTicksLimit: 6, color: C.muted } }, tooltip: { mode: 'nearest', intersect: true, callbacks: { title: it => `${c[it[0].dataIndex].id} · ${c[it[0].dataIndex].fr}`, label: x => { const m = c[x.dataIndex]; return [` Média: ${nf(m.med, 0)} t/dia`, ` Meta: ${nf(m.meta)} t/dia`, ` ${m.dias} dias com produção`]; } } } }); o.scales.x.ticks = { autoSkip: false, maxRotation: 90, font: { size: 10.5 }, color: C.muted }; return o; })(),
      plugins: [tracos(c.map(x => x.meta)), rotulos({ fmt: v => nf(v, 0), acima: c.map(x => x.meta) })],
    });
  };
  const desenharLog = () => {
    const pctMode = MODO.log === 'p';
    const tot = L.map(r => (r.log?.rod || 0) + (r.log?.tri || 0));
    const rodV = L.map((r, i) => (pctMode ? (tot[i] ? (r.log?.rod || 0) / tot[i] * 100 : 0) : r.log?.rod || 0));
    const triV = L.map((r, i) => (pctMode ? (tot[i] ? (r.log?.tri || 0) / tot[i] * 100 : 0) : r.log?.tri || 0));
    $('#hlHint').textContent = pctMode ? 'Participação de cada tipo no entregue do dia' : 'Rodotrem e Tritrem empilhados · total no topo · tracejado = média';
    const ds = (label, data, cor) => ({ label, data, backgroundColor: cor, hoverBackgroundColor: cor + 'D9', borderColor: '#fff', borderWidth: { top: 2 }, borderSkipped: false, borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 34, categoryPercentage: .78, stack: 's' });
    const g = graf('hcLog', {
      type: 'bar',
      data: { labels: lbl(), datasets: [ds('Rodotrem', rodV, CR.rod), ds('Tritrem', triV, CR.tri)] },
      options: opc(L, { stacked: true, legenda: true, y: pctMode ? { max: 100, ticks: { callback: v => v + '%', maxTicksLimit: 6, color: C.muted } } : { ticks: { callback: v => curto(v), maxTicksLimit: 6, color: C.muted } },
        tooltip: { callbacks: { title: titDia, label: c => { const r = L[c.dataIndex], t = tot[c.dataIndex], v = c.datasetIndex ? r.log?.tri || 0 : r.log?.rod || 0; return ` ${c.dataset.label}: ${nf(v, 0)} TC · ${nf(t ? v / t * 100 : 0, 1)}%`; }, footer: it => [` Total: ${nf(tot[it[0].dataIndex], 0)} TC`, rodapeDia()] } } }),
      plugins: pctMode
        ? [{ id: 'pctIn', afterDatasetsDraw(ch) { const { ctx } = ch; ctx.save(); ctx.font = '700 10.5px Archivo, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; [0, 1].forEach(k2 => { const m = ch.getDatasetMeta(k2); if (m.hidden) return; m.data.forEach((b, i) => { const v = ch.data.datasets[k2].data[i]; if (b.height > 16 && b.width > 22) ctx.fillText(nf(v, 0) + '%', b.x, b.y + b.height / 2 + 4); }); }); ctx.restore(); } }]
        : [linhas({ media: CTX.logT / CTX.n, fmtMedia: v => 'média ' + curtoK(v) }), rotulos({ fmt: curtoK, ds: [0, 1], total: () => L.map((r, i) => { const h = g0(); return (!h || !h.getDatasetMeta(0).hidden ? r.log?.rod || 0 : 0) + (!h || !h.getDatasetMeta(1).hidden ? r.log?.tri || 0 : 0); }) })],
    });
    function g0() { return G.hcLog; }
    return g;
  };
  const desenharComp = () => {
    const { rod, tri, logT, n } = CTX;
    graf('hcComp', {
      type: 'doughnut',
      data: { labels: ['Rodotrem', 'Tritrem'], datasets: [{ data: [rod / n, tri / n], backgroundColor: [CR.rod, CR.tri], borderColor: '#fff', borderWidth: 3, hoverOffset: 10, borderRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '68%', animation: { animateRotate: true, duration: 900, easing: 'easeOutQuart' },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3, padding: 14, generateLabels: ch => ch.data.labels.map((l, i) => ({ text: `${l}  ${nf(ch.data.datasets[0].data[i] / (logT / n) * 100, 1)}%`, fillStyle: ch.data.datasets[0].backgroundColor[i], strokeStyle: 'transparent', index: i, hidden: !ch.getDataVisibility(i) })) } },
          tooltip: { ...tooltipBase, callbacks: { label: c => ` ${c.label}: ${nf(c.raw, 0)} TC/dia · ${nf(c.raw / (logT / n) * 100, 1)}%` } } } },
      plugins: [{ id: 'centro', afterDraw(ch) { const { ctx, chartArea: a } = ch; const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2; ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = C.ink; ctx.font = '700 20px Archivo, sans-serif'; ctx.fillText(nf(logT / n, 0), x, y + 2); ctx.font = '12px Archivo, sans-serif'; ctx.fillStyle = C.muted; ctx.fillText('TC por dia', x, y + 20); ctx.restore(); } }],
    });
  };
  const desenharTcv = () => {
    const v = L.map(r => (r.log?.via ? r.log.tot / r.log.via : null));
    graf('hcTcv', {
      type: 'line',
      data: { labels: lbl(), datasets: [{ label: 'Carga média', data: v, borderColor: CR.rod, borderWidth: 2.2, tension: .35, fill: true,
        backgroundColor: c => { const { ctx, chartArea: a } = c.chart; if (!a) return 'rgba(46,107,58,.1)'; const g = ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, 'rgba(46,107,58,.2)'); g.addColorStop(1, 'rgba(46,107,58,0)'); return g; },
        pointRadius: 4, pointHoverRadius: 7, pointBackgroundColor: CR.rod, pointBorderColor: '#fff', pointBorderWidth: 2 }] },
      options: opc(L, { y: { beginAtZero: false, ticks: { callback: x => nf(x, 0), maxTicksLimit: 5, color: C.muted } }, tooltip: { callbacks: { title: titDia, label: c => ` ${nf(c.raw, 1)} TC por viagem`, footer: rodapeDia } } }),
      plugins: [linhas({ media: CTX.via ? CTX.logT / CTX.via : null, fmtMedia: x => 'média ' + nf(x, 1) }), rotulos({ fmt: x => nf(x, 1), limite: 12 }), mira],
    });
  };

  const atualizarTela = () => { marcarStatus(); renderPeriodo(); };

  /* ---------- início ---------- */
  H.iniciar = async () => {
    montarPop();
    // gráficos do histórico também redesenham ao entrar na página
    const antes = Layout.aoEntrar;
    if (window.Pluvio) Pluvio.iniciar();
    Layout.aoEntrar = pg => { if (antes) antes(pg); Object.values(G).forEach(c => { try { if (pg.contains(c.canvas)) { c.resize(); c.reset(); c.update(); } } catch (e) { /* */ } }); };
    await carregarIndice();
    TRANSP = await lerSite('historico/transporte.json');
    atualizarTela();
    $('#hDe')?.addEventListener('change', () => { PER.de = $('#hDe').value; if (PER.de > PER.ate) [PER.de, PER.ate] = [PER.ate, PER.de]; $$('.hist-pre button').forEach(b => b.classList.remove('is-on')); renderPeriodo(); });
    $('#hAte')?.addEventListener('change', () => { PER.ate = $('#hAte').value; if (PER.de > PER.ate) [PER.de, PER.ate] = [PER.ate, PER.de]; $$('.hist-pre button').forEach(b => b.classList.remove('is-on')); renderPeriodo(); });
    $('.hist-pre')?.addEventListener('click', e => {
      const b = e.target.closest('button[data-pre]'); if (!b) return;
      const ds = datas(), ult = ds[ds.length - 1]; if (!ult) return;
      const p = b.dataset.pre; PER.ate = ult;
      PER.de = p === 'mes' ? ult.slice(0, 8) + '01' : p === 'safra' ? (TRANSP && TRANSP.dias && TRANSP.dias[0] && TRANSP.dias[0].d.slice(0, 4) === ult.slice(0, 4) ? TRANSP.dias[0].d : inicioSafra(ult)) : p === 'tudo' ? ds[0] : addDias(ult, -(+p - 1));
      $$('.hist-pre button').forEach(x => x.classList.toggle('is-on', x === b));
      renderPeriodo();
    });
    // sincronizar: clique; configurar GitHub e trocar a pasta: botão direito (ou segurar) no mesmo ícone
    const bs = $('#btnSync');
    if (bs) {
      bs.addEventListener('click', async () => { if (!Layout.editor()) return; const c = await cfg.get(); if (!c || !c.token) return H.configurar(); H.sincronizar(); });
      bs.addEventListener('contextmenu', e => { e.preventDefault(); if (Layout.editor()) H.configurar(); });
      let t; bs.addEventListener('touchstart', () => { t = setTimeout(() => { if (Layout.editor()) H.configurar(); }, 650); }, { passive: true });
      bs.addEventListener('touchend', () => clearTimeout(t));
    }
    $('#histVolta')?.addEventListener('click', () => Painel.voltarAtual());
    // sincroniza sozinho quando a pasta já está autorizada neste navegador
    if (SUPORTA_PASTA && Layout.editor()) {
      const p = await pastaGuardada();
      if (p && (await permissao(p, false))) H.sincronizar({ silencioso: true });
    }
  };
  window.Hist = H;
})();
