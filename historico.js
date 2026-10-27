/* =========================================================================
   Histórico do painel (Operação diária)

   Como os dados ficam no GitHub (todos protegidos com a chave do login):
     historico/indice-operacao.json   resumo leve de cada dia (para períodos)
     historico/dias/AAAA-MM-DD.json   relatório completo do dia (dados + análise)

   Sincronização: a página lê a pasta de PDFs do computador (vinculada uma vez),
   encontra os relatórios novos ou alterados, lê cada PDF no próprio navegador e
   publica tudo no GitHub num único commit (com o token salvo neste navegador).
   Sem token, gera um .zip com as pastas prontas para subir manualmente.
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
  const lerDia = async d => lerSite(`historico/dias/${d}.json`);

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
  const progresso = txt => { const el = $('#syncMsg'); if (el) el.textContent = txt; const st = $('#histSyncTxt'); if (st) st.textContent = txt; };

  H.sincronizar = async ({ silencioso = false, trocarPasta = false } = {}) => {
    if (SYNC) return; SYNC = true;
    try {
      if (!SUPORTA_PASTA) { if (!silencioso) Painel.modal('Navegador sem suporte', '<p>Para ler a pasta do computador, abra o painel no <b>Google Chrome</b> ou no <b>Microsoft Edge</b> (no computador).</p>', [{ html: 'Fechar', onClick: Painel.fecharModal }]); return; }
      let dir = trocarPasta ? null : await pastaGuardada();
      if (!dir) { if (silencioso) return; dir = await pedirPasta(); }
      if (!(await permissao(dir, !silencioso))) { if (!silencioso) toast('<i class="fa-solid fa-folder-closed"></i> Sem permissão para ler a pasta', 4000); marcarStatus(); return; }
      const c = await cfg.get();
      if (!silencioso) Painel.modal('Sincronizando histórico', `<div class="spinner"></div><p style="text-align:center" id="syncMsg">Lendo a pasta ${esc(dir.name)}…</p>`);
      await carregarIndice(c && c.token ? c : null);
      // arquivos da pasta
      const pdfs = [], analises = [];
      for await (const [nome, h] of dir.entries()) {
        if (h.kind !== 'file') continue;
        if (/\.pdf$/i.test(nome)) pdfs.push({ nome, h });
        else if (/analise.*\.json$/i.test(nome)) analises.push({ nome, h });
      }
      const novos = [];
      for (const p of pdfs) {
        const d = dataDoNome(p.nome);
        const f = await p.h.getFile();
        const ja = d && IDX.dias[d];
        if (!ja || !ja.src || ja.src.mtime < f.lastModified || ja.src.nome !== p.nome) novos.push({ ...p, f, d });
      }
      // análises (entrega x cota do Flow) por data: da pasta e a publicada hoje
      const anMap = new Map();
      for (const a of analises) { try { const x = (await Acesso.readJson(JSON.parse(await (await a.h.getFile()).text()))).data; if (x && x.data) anMap.set(x.data, x); } catch (e) { /* ignora */ } }
      if (Painel.analise && Painel.analise.data && !anMap.has(Painel.analise.data)) anMap.set(Painel.analise.data, Painel.analise);
      const anNovas = [...anMap.keys()].filter(d => IDX.dias[d] && !IDX.dias[d].ec && !novos.some(n => n.d === d));
      if (!novos.length && !anNovas.length) {
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
      if (!resumos.length) { Painel.modal('Nada foi publicado', `<p>Não consegui ler os arquivos novos:</p><ul class="check-list">${erros.map(x => `<li><i class="fa-solid fa-circle-exclamation"></i>${esc(x)}</li>`).join('')}</ul>`, [{ html: 'Fechar', onClick: Painel.fecharModal }]); return; }
      resumos.forEach(r => { IDX.dias[r.d] = r; });
      const ordenado = {}; datas().forEach(d => { ordenado[d] = IDX.dias[d]; });
      IDX = { versao: 1, atualizado: new Date().toISOString(), pasta: dir.name, dias: ordenado };
      arquivos.push({ path: 'historico/indice-operacao.json', content: JSON.stringify(await Acesso.encryptJson(IDX)) });
      // o relatório mais novo também vira o dados.json da página
      const ultimo = lidos.sort((a, b) => a.d.localeCompare(b.d)).pop();
      const atualD = Painel.atual?.raw?.meta?.dataRelatorio || '';
      const virouAtual = ultimo && ultimo.d >= atualD;
      if (virouAtual) {
        arquivos.push({ path: 'dados.json', content: JSON.stringify(await Acesso.encryptJson(ultimo.raw)) });
        if (ultimo.an) arquivos.push({ path: 'analise.json', content: JSON.stringify(await Acesso.encryptJson(ultimo.an)) });
      }
      const dias = resumos.map(r => r.d).sort();
      const titulo = dias.length === 1 ? `Histórico: relatório de ${br(dias[0])}` : `Histórico: ${dias.length} relatórios (${brC(dias[0])} a ${brC(dias[dias.length - 1])})`;
      if (c && c.token) {
        progresso('Publicando no GitHub…');
        await commit(c, arquivos, titulo);
        if (!silencioso) Painel.modal('Histórico publicado', `<p><b>${dias.length} ${dias.length === 1 ? 'relatório publicado' : 'relatórios publicados'}</b> no GitHub num único envio${virouAtual ? `, e o painel passou a abrir em <b>${br(ultimo.d)}</b>` : ''}.</p><p class="hint">O site atualiza para todos em cerca de 1 minuto.</p>${erros.length ? `<p>Não li:</p><ul class="check-list">${erros.map(x => `<li><i class="fa-solid fa-circle-exclamation"></i>${esc(x)}</li>`).join('')}</ul>` : ''}`, [{ html: 'Fechar', primary: true, onClick: Painel.fecharModal }]);
        else toast(`<i class="fa-solid fa-cloud-arrow-up"></i> Histórico: ${titulo.replace('Histórico: ', '')} publicado`, 5000);
      } else {
        baixar(zip(arquivos), `historico-${dias[dias.length - 1]}.zip`);
        Painel.modal('Pacote do histórico baixado', `<p>Sem o GitHub configurado, juntei <b>${dias.length} ${dias.length === 1 ? 'relatório' : 'relatórios'}</b> num .zip.</p>
          <ol class="hist-passos"><li>Extraia o .zip.</li><li>No GitHub: <b>Add file → Upload files</b>.</li><li>Arraste tudo o que foi extraído (a pasta <b>historico</b>${virouAtual ? ' e o dados.json' : ''}) e clique em <b>Commit changes</b>.</li></ol>
          <p class="hint">Para não precisar mais disso, use <b>Configurar GitHub</b> na página Histórico.</p>`, [{ html: 'Fechar', primary: true, onClick: Painel.fecharModal }]);
      }
      if (virouAtual) Painel.definirAtual(ultimo.raw, ultimo.an || (Painel.analise && Painel.analise.data === ultimo.d ? Painel.analise : null));
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
    const el = $('#histStatus'); if (!el) return;
    const c = await cfg.get(), p = SUPORTA_PASTA ? await pastaGuardada() : null;
    let ult = null; try { ult = localStorage.getItem(ULT); } catch (e) { /* */ }
    const ds = datas();
    el.innerHTML = `
      <div class="hs-it"><i class="fa-solid fa-folder-open"></i><span>Pasta</span><b>${p ? esc(p.name) : 'não vinculada'}</b></div>
      <div class="hs-it"><i class="fa-brands fa-github"></i><span>GitHub</span><b>${c && c.token ? `${esc(c.owner)}/${esc(c.repo)}` : 'não configurado'}</b></div>
      <div class="hs-it"><i class="fa-regular fa-calendar"></i><span>No histórico</span><b>${ds.length ? `${ds.length} dias · ${brC(ds[0])} a ${brC(ds[ds.length - 1])}` : 'vazio'}</b></div>
      <div class="hs-it"><i class="fa-solid fa-rotate"></i><span>Última sincronização</span><b id="histSyncTxt">${SYNC ? 'sincronizando…' : ult ? new Date(ult).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca'}</b></div>`;
    const sel = $('#seloHist'); if (sel) sel.textContent = '';
  };

  // seletor "ver outro dia" no chip da data
  const abrirDia = async d => {
    if (!d) return;
    if (Painel.atual && Painel.atual.raw.meta?.dataRelatorio === d) { Painel.voltarAtual(); fecharPop(); return; }
    const x = await lerDia(d);
    if (!x || !x.dados) { toast(`<i class="fa-solid fa-circle-info"></i> O relatório de ${br(d)} ainda não está no GitHub`, 4000); return; }
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
  const graf = (id, cfgG) => { if (G[id]) G[id].destroy(); const el = document.getElementById(id); if (!el || !window.Chart) return; G[id] = new Chart(el, cfgG); };
  // linha da média (tracejada) com o valor escrito no fim
  const linhaMedia = (valor, fmt, cor = C.ink, txt = 'média') => ({
    id: 'media', afterDatasetsDraw(ch) {
      if (!Number.isFinite(valor)) return;
      const { ctx, chartArea: a, scales: { y } } = ch; const yy = y.getPixelForValue(valor);
      ctx.save(); ctx.strokeStyle = cor; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(a.left, yy); ctx.lineTo(a.right, yy); ctx.stroke();
      ctx.setLineDash([]); ctx.font = '700 11px Archivo, sans-serif'; const t = `${txt} ${fmt(valor)}`; const w = ctx.measureText(t).width + 10;
      ctx.fillStyle = '#fff'; ctx.fillRect(a.right - w, yy - 9, w, 18); ctx.fillStyle = cor; ctx.textAlign = 'right'; ctx.fillText(t, a.right - 5, yy + 4); ctx.restore();
    },
  });
  const linhaMeta = (valor, fmt) => ({
    id: 'meta', afterDatasetsDraw(ch) {
      if (!Number.isFinite(valor)) return;
      const { ctx, chartArea: a, scales: { y } } = ch; const yy = y.getPixelForValue(valor);
      ctx.save(); ctx.strokeStyle = C.palha; ctx.lineWidth = 1.2; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(a.left, yy); ctx.lineTo(a.right, yy); ctx.stroke();
      ctx.font = '600 10.5px Archivo, sans-serif'; ctx.fillStyle = C.palha; ctx.textAlign = 'left'; ctx.fillText(`meta ${fmt(valor)}`, a.left + 4, yy - 5); ctx.restore();
    },
  });
  const opcDias = (lista, extra = {}) => ({
    responsive: true, maintainAspectRatio: false, animation: { duration: 700 },
    onClick: (e, els) => { if (els.length) abrirDia(lista[els[0].index].d); },
    onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
    scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }, y: { grid: { color: C.hair }, beginAtZero: true, ...(extra.y || {}) } },
    plugins: { legend: { display: false }, tooltip: extra.tooltip || {} },
  });
  const spark = (vals, cor) => {
    const v = vals.filter(Number.isFinite); if (v.length < 2) return '';
    const w = 70, h = 20, mn = Math.min(...v), mx = Math.max(...v), r = mx - mn || 1;
    const pts = v.map((x, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - 2 - (x - mn) / r * (h - 4)).toFixed(1)}`).join(' ');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${cor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  };
  const k = ({ t, ic, v, un = '', sub = '', st = '' }) => `<div class="k${st ? ' is-' + st : ''}"><div class="k__t"><span>${t}</span><i class="fa-solid ${ic}"></i></div><div class="k__v">${v}${un ? `<small>${un}</small>` : ''}</div><div class="k__s">${sub}</div></div>`;
  const stP = p => (p == null ? '' : p >= 100 ? 'ok' : p >= 90 ? 'warn' : 'bad');

  let PER = { de: null, ate: null };
  const renderPeriodo = () => {
    const box = $('#histConteudo'); if (!box) return;
    const ds = datas();
    if (!ds.length) {
      box.innerHTML = `<div class="card hist-vazio"><i class="fa-regular fa-folder-open"></i><h3>O histórico ainda está vazio</h3><p>Clique em <b>Sincronizar pasta</b>, escolha a pasta com os PDFs dos relatórios e o painel lê todos de uma vez.</p></div>`;
      return;
    }
    if (!PER.ate || !ds.includes(PER.ate) && PER.ate > ds[ds.length - 1]) PER.ate = ds[ds.length - 1];
    if (!PER.de) PER.de = addDias(PER.ate, -29);
    $('#hDe').value = PER.de; $('#hAte').value = PER.ate;
    ['hDe', 'hAte'].forEach(id => { $('#' + id).min = ds[0]; $('#' + id).max = ds[ds.length - 1]; });
    const L = ds.filter(d => d >= PER.de && d <= PER.ate).map(d => IDX.dias[d]).filter(r => Number.isFinite(r.prod));
    if (!L.length) { box.innerHTML = `<div class="card hist-vazio"><i class="fa-regular fa-calendar-xmark"></i><h3>Nenhum relatório entre ${br(PER.de)} e ${br(PER.ate)}</h3><p>Escolha outro intervalo.</p></div>`; return; }
    const metas = Painel.metas;
    const n = L.length, prod = soma(L, r => r.prod), cota = soma(L, r => r.cota);
    const pct = media(L, r => (r.cota ? r.prod / r.cota * 100 : null)); // média dos atingimentos diários
    const mProd = prod / n, mCota = cota / n, naCota = L.filter(r => r.cota && r.prod >= r.cota).length;
    const ef = media(L, r => r.ef), ind = media(L, r => r.ind), ader = media(L, r => r.ader);
    const comEc = L.filter(r => r.ec), ecE = soma(comEc, r => r.ec.ent), ecM = soma(comEc, r => r.ec.meta);
    const melhor = [...L].sort((a, b) => b.prod / b.cota - a.prod / a.cota)[0], pior = [...L].sort((a, b) => a.prod / a.cota - b.prod / b.cota)[0];
    const lbl = L.map(r => brC(r.d));
    // frentes
    const F = new Map();
    L.forEach(r => (r.fr || []).forEach(([fr, p, c, e, i]) => {
      const x = F.get(fr) || { fr, dias: 0, prod: 0, cota: 0, na: 0, ef: [], ind: [], serie: [] };
      x.dias++; x.prod += p || 0; x.cota += c || 0; if (c && p >= c) x.na++;
      if (Number.isFinite(e)) x.ef.push(e); if (Number.isFinite(i)) x.ind.push(i); x.serie.push(c ? p / c * 100 : null);
      F.set(fr, x);
    }));
    const ordF = s => { const m = String(s).match(/(\d+)/); return m ? +m[1] : 999; };
    const frentes = [...F.values()].sort((a, b) => ordF(a.fr) - ordF(b.fr));
    // colhedoras
    const CO = new Map();
    L.forEach(r => (r.col || []).forEach(([id, tc, fr]) => { const x = CO.get(id) || { id, fr, dias: 0, tc: 0 }; x.dias++; x.tc += tc || 0; x.fr = fr; CO.set(id, x); }));
    const dois = new Set((metas.colhedoras2Linhas || []).map(String));
    const colh = [...CO.values()].map(c => ({ ...c, med: c.tc / c.dias, meta: dois.has(c.id) ? metas.metaColhedora2Linhas : metas.metaColhedora1Linha })).sort((a, b) => b.med - a.med);
    // ofensores
    const OF = new Map(); L.forEach(r => (r.of || []).forEach(([nm, t]) => OF.set(nm, (OF.get(nm) || 0) + t)));
    const ofens = [...OF.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10), totOf = soma([...OF.values()]);
    // transporte e vinhaça
    const logT = soma(L, r => r.log?.tot), rod = soma(L, r => r.log?.rod), tri = soma(L, r => r.log?.tri), via = soma(L, r => r.log?.via);
    const LV = L.filter(r => r.vin && r.vin.dim), vinA = LV.length ? soma(LV, r => r.vin.real) / soma(LV, r => r.vin.dim) * 100 : null;

    $('#histTitulo').textContent = PER.de === PER.ate ? br(PER.de) : `${br(PER.de)} a ${br(PER.ate)}`;
    $('#histSub').textContent = `${n} ${n === 1 ? 'dia com relatório' : 'dias com relatório'} · clique num dia do gráfico para abrir o relatório completo`;
    box.innerHTML = `
      <section class="section section--first" id="hResumo" data-nome="Resumo">
        <div class="g-k">
          ${k({ t: 'Produção média por dia', ic: 'fa-wheat-awn', v: nf(mProd, 0), un: 't/dia', sub: `cota média de <b>${nf(mCota, 0)} t/dia</b>`, st: stP(pct) })}
          ${k({ t: 'Atingimento médio da cota', ic: 'fa-bullseye', v: nf(pct, 1), un: '%', sub: `${sg(mProd - mCota, 0)} t/dia vs. a cota`, st: stP(pct) })}
          ${k({ t: 'Dias na cota', ic: 'fa-flag-checkered', v: nf(naCota / n * 100, 0), un: '% dos dias', sub: `melhor ${brC(melhor.d)} · pior ${brC(pior.d)}`, st: naCota / n >= .8 ? 'ok' : naCota / n >= .5 ? 'warn' : 'bad' })}
          ${k({ t: 'Eficiência operacional média', ic: 'fa-gauge-high', v: nf(ef, 1), un: '%', sub: `meta ${nf(metas.eficiencia, 0)}%`, st: ef == null ? '' : ef >= metas.eficiencia ? 'ok' : ef >= metas.eficiencia * .9 ? 'warn' : 'bad' })}
          ${k({ t: 'Indisponibilidade média', ic: 'fa-screwdriver-wrench', v: nf(ind, 1), un: '%', sub: `meta ≤ ${nf(metas.indisponibilidade, 0)}%`, st: ind == null ? '' : ind <= metas.indisponibilidade ? 'ok' : 'bad' })}
          ${comEc.length ? k({ t: 'Entrega x meta média (Flow)', ic: 'fa-truck-ramp-box', v: nf(media(comEc, r => r.ec.ent / r.ec.meta * 100), 1), un: '%', sub: `${nf(ecE / comEc.length, 0)} t/dia · ${comEc.length} ${comEc.length === 1 ? 'dia' : 'dias'}`, st: stP(media(comEc, r => r.ec.ent / r.ec.meta * 100)) }) : k({ t: 'Aderência de velocidade média', ic: 'fa-gauge', v: Number.isFinite(ader) ? sg(ader, 1) : '—', un: Number.isFinite(ader) ? '%' : '', sub: 'realizada sobre a dimensionada', st: !Number.isFinite(ader) ? '' : ader >= -5 ? 'ok' : ader >= -10 ? 'warn' : 'bad' })}
        </div>
      </section>

      <section class="section" id="hProd" data-nome="Produção">
        <article class="card"><header class="card__head"><div><h3>Produção por dia</h3><p class="hint">Barra = dia (verde na cota · amarela até 10% abaixo · vermelha abaixo disso) · tracejado = média do período</p></div></header>
          <div class="chart-box hist-cv"><canvas id="hcProd"></canvas></div></article>
        <div class="grid grid--2" style="margin-top:14px">
          <article class="card"><header class="card__head"><div><h3>Eficiência operacional por dia</h3><p class="hint">Tracejado = média · pontilhado = meta</p></div></header><div class="chart-box hist-cv sm"><canvas id="hcEf"></canvas></div></article>
          <article class="card"><header class="card__head"><div><h3>Indisponibilidade por dia</h3><p class="hint">Tracejado = média · pontilhado = meta</p></div></header><div class="chart-box hist-cv sm"><canvas id="hcInd"></canvas></div></article>
        </div>
      </section>

      <section class="section" id="hFrentes" data-nome="Frentes">
        <article class="card"><header class="card__head"><div><h3>Frentes no período</h3><p class="hint">Médias por dia com relatório e a tendência do atingimento dia a dia</p></div></header>
          <div class="table-wrap"><table class="simple-table hist-tab">
            <thead><tr><th>Frente</th><th class="num">Dias</th><th class="num">Produção média/dia (t)</th><th class="num">Cota média/dia (t)</th><th class="num">Atingimento médio</th><th>Tendência</th><th class="num">Eficiência média</th><th class="num">Indisp. média</th><th class="num">Dias na cota</th></tr></thead>
            <tbody>${frentes.map(f => { const p = media(f.serie, x => x), e = media(f.ef, x => x), i = media(f.ind, x => x); return `<tr>
              <td><b>${esc(f.fr)}</b></td><td class="num">${f.dias}</td><td class="num"><b>${nf(f.prod / f.dias, 0)}</b></td><td class="num">${nf(f.cota / f.dias, 0)}</td>
              <td class="num">${p != null ? `<span class="pill ${stP(p)}">${nf(p, 1)}%</span>` : '—'}</td><td>${spark(f.serie, p >= 100 ? C.ok : p >= 90 ? C.warn : C.bad)}</td>
              <td class="num">${e != null ? `<span class="pill ${e >= metas.eficiencia ? 'ok' : e >= metas.eficiencia * .9 ? 'warn' : 'bad'}">${nf(e, 1)}%</span>` : '—'}</td>
              <td class="num">${i != null ? nf(i, 1) + '%' : '—'}</td><td class="num">${nf(f.na / f.dias * 100, 0)}%</td></tr>`; }).join('')}</tbody>
            <tfoot><tr><td>Média da usina</td><td class="num">${n}</td><td class="num">${nf(mProd, 0)}</td><td class="num">${nf(mCota, 0)}</td><td class="num">${nf(pct, 1)}%</td><td></td><td class="num">${nf(ef, 1)}%</td><td class="num">${nf(ind, 1)}%</td><td class="num">${nf(naCota / n * 100, 0)}%</td></tr></tfoot>
          </table></div></article>
      </section>

      <section class="section" id="hMaq" data-nome="Máquinas">
        <article class="card"><header class="card__head"><div><h3>Colhedoras: média por dia trabalhado</h3><p class="hint">Verde = média acima da meta · traço = meta (1 linha ${nf(metas.metaColhedora1Linha)} t · 2 linhas ${nf(metas.metaColhedora2Linhas)} t)</p></div></header>
          <div class="chart-box hist-cv"><canvas id="hcCol"></canvas></div></article>
      </section>

      <section class="section" id="hTransp" data-nome="Transporte">
        <div class="g-k g-k4">
          ${k({ t: 'Entregue média por dia', ic: 'fa-route', v: nf(logT / n, 0), un: 'TC/dia', sub: `média de ${n} ${n === 1 ? 'dia' : 'dias'} com relatório` })}
          ${k({ t: 'Rodotrem', ic: 'fa-truck-moving', v: nf(logT ? rod / logT * 100 : null, 1), un: '%', sub: `média de ${nf(rod / n, 0)} TC/dia` })}
          ${k({ t: 'Tritrem', ic: 'fa-trailer', v: nf(logT ? tri / logT * 100 : null, 1), un: '%', sub: `média de ${nf(tri / n, 0)} TC/dia` })}
          ${k({ t: 'Carga média', ic: 'fa-weight-hanging', v: nf(via ? logT / via : null, 1), un: 'TC/viagem', sub: `média de ${nf(via / n, 0)} viagens/dia` })}
        </div>
        <article class="card" style="margin-top:14px"><header class="card__head"><div><h3>Entregue por dia</h3><p class="hint">Rodotrem e Tritrem empilhados · tracejado = média</p></div></header>
          <div class="chart-box hist-cv sm"><canvas id="hcLog"></canvas></div></article>
      </section>

      <section class="section" id="hVin" data-nome="Vinhaça e ofensores">
        <div class="grid grid--2">
          <article class="card"><header class="card__head"><div><h3>Aderência da vinhaça por dia</h3><p class="hint">Realizado ÷ dimensionado · média do período ${nf(vinA, 1)}%</p></div></header><div class="chart-box hist-cv sm"><canvas id="hcVin"></canvas></div></article>
          <article class="card"><header class="card__head"><div><h3>Ofensores acumulados</h3><p class="hint">Participação nas citações do período</p></div></header>
            <div class="hrank">${ofens.map(([nm, t], i) => `<div><span class="n">${i + 1}</span><span class="nm">${esc(nm)}</span><span class="bar"><i style="width:${t / ofens[0][1] * 100}%;background:${i < 3 ? C.bad : C.palha}"></i></span><b>${nf(t / totOf * 100, 1)}%</b></div>`).join('')}</div></article>
        </div>
      </section>`;

    const corDia = r => (r.cota && r.prod >= r.cota ? C.ok : r.cota && r.prod / r.cota >= .9 ? C.warn : C.bad);
    graf('hcProd', { type: 'bar', data: { labels: lbl, datasets: [{ data: L.map(r => r.prod), backgroundColor: L.map(corDia), borderRadius: 4, maxBarThickness: 30 }] },
      options: opcDias(L, { y: { ticks: { callback: v => nf(v, 0) } }, tooltip: { callbacks: { title: it => br(L[it[0].dataIndex].d), label: c => { const r = L[c.dataIndex]; return [` Produção: ${nf(r.prod, 0)} t`, ` Cota: ${nf(r.cota, 0)} t`, ` Atingimento: ${nf(r.prod / r.cota * 100, 1)}%`]; }, footer: () => 'Clique para abrir o dia' } } }),
      plugins: [linhaMedia(mProd, v => nf(v, 0) + ' t')] });
    graf('hcEf', { type: 'line', data: { labels: lbl, datasets: [{ data: L.map(r => r.ef), borderColor: C.folha, backgroundColor: 'rgba(60,122,53,.08)', fill: true, tension: .3, borderWidth: 2.2, pointRadius: 3, pointBackgroundColor: L.map(r => (r.ef >= metas.eficiencia ? C.ok : C.bad)), pointBorderColor: '#fff' }] },
      options: opcDias(L, { y: { beginAtZero: false, suggestedMin: 40, suggestedMax: 100, ticks: { callback: v => v + '%' } }, tooltip: { callbacks: { title: it => br(L[it[0].dataIndex].d), label: c => ` Eficiência: ${nf(c.raw, 1)}%` } } }),
      plugins: [linhaMedia(ef, v => nf(v, 1) + '%'), linhaMeta(metas.eficiencia, v => nf(v, 0) + '%')] });
    graf('hcInd', { type: 'bar', data: { labels: lbl, datasets: [{ data: L.map(r => r.ind), backgroundColor: L.map(r => (r.ind <= metas.indisponibilidade ? 'rgba(60,122,53,.75)' : 'rgba(198,40,40,.8)')), borderRadius: 4, maxBarThickness: 26 }] },
      options: opcDias(L, { y: { ticks: { callback: v => v + '%' } }, tooltip: { callbacks: { title: it => br(L[it[0].dataIndex].d), label: c => ` Indisponibilidade: ${nf(c.raw, 1)}%` } } }),
      plugins: [linhaMedia(ind, v => nf(v, 1) + '%'), linhaMeta(metas.indisponibilidade, v => nf(v, 0) + '%')] });
    graf('hcCol', { type: 'bar', data: { labels: colh.map(c => c.id), datasets: [{ data: colh.map(c => c.med), backgroundColor: colh.map(c => (c.med >= c.meta ? C.ok : C.bad)), borderRadius: 4, maxBarThickness: 26 }] },
      options: { responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 90, font: { size: 10.5 } } }, y: { grid: { color: C.hair }, beginAtZero: true, suggestedMax: Math.max(0, ...colh.map(c => c.meta)) * 1.05, ticks: { callback: v => nf(v, 0) } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: it => `${colh[it[0].dataIndex].id} · ${colh[it[0].dataIndex].fr}`, label: c => { const x = colh[c.dataIndex]; return [` Média: ${nf(x.med, 0)} t/dia`, ` Meta: ${nf(x.meta)} t/dia`, ` ${x.dias} dias com produção`]; } } } } },
      plugins: [{ id: 'traco', afterDatasetsDraw(ch) { const { ctx, scales: { y } } = ch; ch.getDatasetMeta(0).data.forEach((b, i) => { const yy = y.getPixelForValue(colh[i].meta); ctx.save(); ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(b.x - b.width / 2 - 2, yy); ctx.lineTo(b.x + b.width / 2 + 2, yy); ctx.stroke(); ctx.restore(); }); } }] });
    graf('hcLog', { type: 'bar', data: { labels: lbl, datasets: [
      { label: 'Rodotrem', data: L.map(r => r.log?.rod || 0), backgroundColor: C.can, borderRadius: 3, maxBarThickness: 30, stack: 's' },
      { label: 'Tritrem', data: L.map(r => r.log?.tri || 0), backgroundColor: C.palha, borderRadius: 3, maxBarThickness: 30, stack: 's' }] },
      options: (() => { const o = opcDias(L, { y: { stacked: true, ticks: { callback: v => nf(v, 0) } }, tooltip: { mode: 'index', intersect: false, callbacks: { title: it => br(L[it[0].dataIndex].d), label: c => ` ${c.dataset.label}: ${nf(c.raw, 0)} TC`, footer: it => ` Total: ${nf(soma(it, x => x.raw), 0)} TC` } } }); o.scales.x.stacked = true; o.plugins.legend = { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10 } }; return o; })(),
      plugins: [linhaMedia(logT / n, v => nf(v, 0) + ' TC')] });
    graf('hcVin', { type: 'bar', data: { labels: LV.map(r => brC(r.d)), datasets: [{ data: LV.map(r => r.vin.real / r.vin.dim * 100), backgroundColor: LV.map(r => (r.vin.real / r.vin.dim >= 1 ? C.ok : r.vin.real / r.vin.dim >= .9 ? C.warn : C.bad)), borderRadius: 4, maxBarThickness: 26 }] },
      options: opcDias(LV, { y: { suggestedMax: 110, ticks: { callback: v => v + '%' } }, tooltip: { callbacks: { title: it => br(LV[it[0].dataIndex].d), label: c => { const r = LV[c.dataIndex]; return [` Aderência: ${nf(c.raw, 1)}%`, ` ${nf(r.vin.real, 1)} de ${nf(r.vin.dim, 1)} ha`]; } } } }),
      plugins: [linhaMedia(vinA, v => nf(v, 1) + '%')] });
    if (Layout.pagina() === 'historico') { Layout.secoes(); Layout.animar($('.page.is-on')); }
  };

  const atualizarTela = () => { marcarStatus(); renderPeriodo(); };

  /* ---------- início ---------- */
  H.iniciar = async () => {
    montarPop();
    // gráficos do histórico também redesenham ao entrar na página
    const antes = Layout.aoEntrar;
    Layout.aoEntrar = pg => { if (antes) antes(pg); Object.values(G).forEach(c => { try { if (pg.contains(c.canvas)) { c.resize(); c.reset(); c.update(); } } catch (e) { /* */ } }); };
    await carregarIndice();
    atualizarTela();
    $('#hDe')?.addEventListener('change', () => { PER.de = $('#hDe').value; if (PER.de > PER.ate) [PER.de, PER.ate] = [PER.ate, PER.de]; $$('.hist-pre button').forEach(b => b.classList.remove('is-on')); renderPeriodo(); });
    $('#hAte')?.addEventListener('change', () => { PER.ate = $('#hAte').value; if (PER.de > PER.ate) [PER.de, PER.ate] = [PER.ate, PER.de]; $$('.hist-pre button').forEach(b => b.classList.remove('is-on')); renderPeriodo(); });
    $('.hist-pre')?.addEventListener('click', e => {
      const b = e.target.closest('button[data-pre]'); if (!b) return;
      const ds = datas(), ult = ds[ds.length - 1]; if (!ult) return;
      const p = b.dataset.pre; PER.ate = ult;
      PER.de = p === 'mes' ? ult.slice(0, 8) + '01' : p === 'safra' ? inicioSafra(ult) : p === 'tudo' ? ds[0] : addDias(ult, -(+p - 1));
      $$('.hist-pre button').forEach(x => x.classList.toggle('is-on', x === b));
      renderPeriodo();
    });
    $('#btnSync')?.addEventListener('click', () => H.sincronizar());
    $('#btnPasta')?.addEventListener('click', () => H.sincronizar({ trocarPasta: true }));
    $('#btnGithub')?.addEventListener('click', () => H.configurar());
    $('#histVolta')?.addEventListener('click', () => Painel.voltarAtual());
    // sincroniza sozinho quando a pasta já está autorizada neste navegador
    if (SUPORTA_PASTA) {
      const p = await pastaGuardada();
      if (p && (await permissao(p, false))) H.sincronizar({ silencioso: true });
    }
  };
  window.Hist = H;
})();
