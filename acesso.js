/* =========================================================================
   Controle de acesso do painel (login + dados criptografados)
   -------------------------------------------------------------------------
   - acesso.json (público) guarda, para cada usuário, a CHAVE DO PAINEL
     criptografada com a senha dele (PBKDF2-SHA256 + AES-GCM 256).
   - dados.json e analise.json são publicados criptografados com essa chave.
     Sem um usuário/senha válidos ninguém lê os números, nem pelo link direto.
   - A sessão fica só nesta aba (ou neste aparelho, se marcar "Manter conectado").
   ========================================================================= */
(function () {
  'use strict';
  const ITER = 310000;
  const SES_KEY = 'painel-acesso';
  const te = new TextEncoder(), td = new TextDecoder();
  const subtle = (window.crypto && window.crypto.subtle) || null;

  const b64 = buf => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const rnd = n => crypto.getRandomValues(new Uint8Array(n));
  const normUser = u => String(u || '').trim().toLowerCase();
  /** O nome do usuário não fica legível no acesso.json: guarda-se só um código (SHA-256). */
  const userId = async u => [...new Uint8Array(await subtle.digest('SHA-256', te.encode('painel|' + normUser(u))))].map(b => b.toString(16).padStart(2, '0')).join('');

  const wrapKeyFor = async (user, pass, salt, iter) => {
    const base = await subtle.importKey('raw', te.encode(normUser(user) + '\u0000' + pass), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  };
  const importK = raw => subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const aesEnc = async (key, bytes) => { const iv = rnd(12); const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes); return { iv: b64(iv), ct: b64(ct) }; };
  const aesDec = async (key, o) => new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.ct)));

  let K = null, KRAW = null, USER = null, CFG = null;

  /* ---------- Arquivo de acessos ---------- */
  const loadConfig = async () => {
    try { const r = await fetch('acesso.json', { cache: 'no-store' }); if (!r.ok) return null; const c = await r.json(); return c && Array.isArray(c.usuarios) ? c : null; }
    catch (e) { return null; }
  };
  const makeEntry = async (user, pass, kraw) => {
    const salt = rnd(16);
    const wk = await wrapKeyFor(user, pass, salt, ITER);
    const w = await aesEnc(wk, kraw);
    return { id: await userId(user), salt: b64(salt), iter: ITER, iv: w.iv, chave: w.ct, criadoEm: new Date().toISOString() };
  };
  const checkPass = p => (p || '').length >= 8;

  /** Cria o acesso.json do zero com o primeiro usuário (gera uma nova chave do painel). */
  const createConfig = async (user, pass) => {
    const kraw = rnd(32);
    const key = await importK(kraw);
    const check = await aesEnc(key, te.encode('painel-ok'));
    K = key; KRAW = kraw; USER = normUser(user);
    const ent = await makeEntry(user, pass, kraw);
    const cfg = { _comentario: 'Usuários liberados do painel. Gerado em acessos.html — não edite à mão.', versao: 2, verificacao: check, usuarios: [ent], nomes: await encryptJson({ [ent.id]: USER }) };
    CFG = cfg;
    return cfg;
  };
  /** Lista { id, nome, criadoEm } (os nomes ficam criptografados no acesso.json). */
  const listUsers = async cfg => {
    let nomes = {};
    try { nomes = cfg.nomes ? await decryptJson(cfg.nomes) : {}; } catch (e) { /* */ }
    return cfg.usuarios.map(x => ({ id: x.id, nome: nomes[x.id] || '(sem nome)', criadoEm: x.criadoEm }));
  };
  const addUser = async (cfg, user, pass) => {
    if (!KRAW) throw new Error('Entre primeiro com um usuário liberado.');
    const u = normUser(user);
    if (!u) throw new Error('Informe o usuário.');
    if (!checkPass(pass)) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
    const ent = await makeEntry(u, pass, KRAW);
    const nomes = cfg.nomes ? await decryptJson(cfg.nomes) : {};
    nomes[ent.id] = u;
    const list = cfg.usuarios.filter(x => x.id !== ent.id); list.push(ent);
    return { ...cfg, usuarios: list, nomes: await encryptJson(nomes) };
  };
  const removeUser = async (cfg, id) => {
    const nomes = cfg.nomes ? await decryptJson(cfg.nomes) : {};
    delete nomes[id];
    return { ...cfg, usuarios: cfg.usuarios.filter(x => x.id !== id), nomes: await encryptJson(nomes) };
  };

  /* ---------- Login / sessão ---------- */
  const verify = async key => { try { return td.decode(await aesDec(key, CFG.verificacao)) === 'painel-ok'; } catch (e) { return false; } };
  const login = async (user, pass, keep) => {
    const u = normUser(user), id = await userId(u);
    const ent = CFG.usuarios.find(x => x.id === id);
    if (!ent) throw new Error('Usuário ou senha inválidos.');
    let kraw;
    try { kraw = await aesDec(await wrapKeyFor(user, pass, unb64(ent.salt), ent.iter || ITER), { iv: ent.iv, ct: ent.chave }); }
    catch (e) { throw new Error('Usuário ou senha inválidos.'); }
    const key = await importK(kraw);
    if (!(await verify(key))) throw new Error('Acesso desatualizado. Peça um novo usuário ao administrador.');
    K = key; KRAW = kraw; USER = u;
    const ses = JSON.stringify({ id, n: USER, k: b64(kraw) });
    try { sessionStorage.setItem(SES_KEY, ses); if (keep) localStorage.setItem(SES_KEY, ses); else localStorage.removeItem(SES_KEY); } catch (e) { /* sem storage */ }
    return USER;
  };
  const restore = async () => {
    let s = null;
    try { s = sessionStorage.getItem(SES_KEY) || localStorage.getItem(SES_KEY); } catch (e) { return false; }
    if (!s) return false;
    try {
      const o = JSON.parse(s);
      if (!CFG.usuarios.some(x => x.id === o.id)) throw new Error('usuário removido');
      const kraw = unb64(o.k), key = await importK(kraw);
      if (!(await verify(key))) throw new Error('chave trocada');
      K = key; KRAW = kraw; USER = o.n;
      try { sessionStorage.setItem(SES_KEY, s); } catch (e) { /* */ }
      return true;
    } catch (e) { clearSession(); return false; }
  };
  const clearSession = () => { try { sessionStorage.removeItem(SES_KEY); localStorage.removeItem(SES_KEY); } catch (e) { /* */ } };
  const logout = () => { clearSession(); K = KRAW = USER = null; };

  /* ---------- Criptografia dos arquivos de dados ---------- */
  const isProtected = o => !!(o && o.protegido === 'aes-gcm-v1' && o.iv && o.ct);
  const encryptJson = async obj => {
    if (!K) throw new Error('Sessão expirada. Entre novamente.');
    const e = await aesEnc(K, te.encode(JSON.stringify(obj)));
    return { protegido: 'aes-gcm-v1', aviso: 'Conteúdo protegido — abra pelo painel com um usuário liberado.', iv: e.iv, ct: e.ct };
  };
  const decryptJson = async env => {
    if (!K) throw new Error('Sessão expirada. Entre novamente.');
    try { return JSON.parse(td.decode(await aesDec(K, env))); }
    catch (e) { throw new Error('Arquivo protegido com outra chave (acesso.json diferente).'); }
  };
  /** Lê um JSON que pode estar protegido ou não. */
  const readJson = async obj => (isProtected(obj) ? { data: await decryptJson(obj), protegido: true } : { data: obj, protegido: false });

  /* ---------- Tela de login (mesmo padrão visual do painel) ---------- */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const screen = inner => {
    let el = document.getElementById('auth');
    if (!el) { el = document.createElement('div'); el.id = 'auth'; el.className = 'auth'; document.body.appendChild(el); }
    const ano = new Date().getFullYear();
    el.innerHTML = `
      <header class="topbar"><div class="topbar__inner">
        <span class="brand"><span class="brand__logo"><img src="assets/logo-icon.png" alt="" onerror="this.remove()"></span>
          <span class="brand__text"><strong>Gerenciamento Diário</strong><small>Centro de Operações Agrícolas</small></span></span>
        <span class="report-chip"><i class="fa-solid fa-lock"></i><span>Acesso restrito</span></span>
      </div></header>
      <main class="auth__main">
        <section class="auth__card">
          <div class="auth__hero">
            <span class="auth__kicker"><i class="fa-solid fa-seedling"></i> Operação Agrícola</span>
            <h1>Gerenciamento Diário</h1>
            <p>Relatório gerencial diário da operação agrícola.</p>
            <ul class="auth__tags">
              <li><i class="fa-solid fa-bullseye"></i>Produção x Cota</li>
              <li><i class="fa-solid fa-screwdriver-wrench"></i>Manutenção</li>
              <li><i class="fa-solid fa-tractor"></i>Colhedoras x Transbordos</li>
              <li><i class="fa-solid fa-truck-moving"></i>Logística</li>
              <li><i class="fa-solid fa-droplet"></i>Vinhaça</li>
              <li><i class="fa-solid fa-table"></i>Tabela gerencial</li>
            </ul>
          </div>
          <div class="auth__panel">
            <img class="auth__logo" src="assets/logo.png" alt="Bioenergética Aroeira" onerror="this.remove()">
            ${inner}
          </div>
        </section>
      </main>
      <footer class="footer"><div class="footer__inner">
        <div class="footer__brand"><span class="brand__logo brand__logo--lg"><img src="assets/logo.png" alt="Bioenergética Aroeira" onerror="this.remove()"></span>
          <div><strong>Gerenciamento Diário · Operação Agrícola</strong><small>Bioenergética Aroeira</small></div></div>
        <p class="copyright">© ${ano} Talamante. Todos os direitos reservados.</p>
      </div></footer>`;
    return el;
  };
  const unlockPage = () => { document.body.classList.remove('auth-locked'); const el = document.getElementById('auth'); if (el) el.remove(); };

  const gate = () => new Promise(async resolve => {
    if (!subtle) { screen('<p class="auth__msg auth__msg--bad">Este navegador não permite o login seguro. Abra o painel pelo endereço https:// do GitHub Pages.</p>'); return; }
    CFG = await loadConfig();
    if (!CFG) {
      screen(`<h2 class="auth__title">Acesso não configurado</h2><p class="auth__msg">Ainda não existe o arquivo <b>acesso.json</b> no site. Abra <a href="acessos.html">acessos.html</a> para criar o primeiro usuário.</p>`);
      return;
    }
    if (await restore()) { unlockPage(); resolve(USER); return; }
    const el = screen(`<h2 class="auth__title">Entrar</h2><p class="auth__sub">Use o usuário e a senha liberados para você.</p>
      <form class="auth__form" autocomplete="on">
        <label class="auth__field"><span>Usuário</span><span class="field"><i class="fa-solid fa-user"></i><input name="u" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus></span></label>
        <label class="auth__field"><span>Senha</span><span class="field"><i class="fa-solid fa-key"></i><input name="p" type="password" autocomplete="current-password" required><button type="button" class="auth__eye" aria-label="Mostrar senha" title="Mostrar senha"><i class="fa-regular fa-eye"></i></button></span></label>
        <label class="auth__keep"><input type="checkbox" name="k"> Manter conectado neste aparelho</label>
        <p class="auth__msg auth__msg--bad" role="alert" hidden></p>
        <button class="btn btn--primary auth__go" type="submit"><i class="fa-solid fa-right-to-bracket"></i><span>Entrar</span></button>
      </form>`);
    const f = el.querySelector('form'), msg = el.querySelector('.auth__msg'), go = el.querySelector('.auth__go'), eye = el.querySelector('.auth__eye');
    eye.addEventListener('click', () => { const show = f.p.type === 'password'; f.p.type = show ? 'text' : 'password'; eye.innerHTML = `<i class="fa-regular ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`; });
    f.addEventListener('submit', async e => {
      e.preventDefault(); msg.hidden = true; go.disabled = true; go.querySelector('span').textContent = 'Verificando…';
      try { await login(f.u.value, f.p.value, f.k.checked); unlockPage(); resolve(USER); }
      catch (err) { msg.textContent = err.message; msg.hidden = false; f.p.value = ''; f.p.focus(); }
      finally { go.disabled = false; go.querySelector('span').textContent = 'Entrar'; }
    });
  });

  window.Acesso = {
    gate, login, logout, loadConfig, createConfig, addUser, removeUser, listUsers, checkPass, userId,
    encryptJson, decryptJson, readJson, isProtected, esc,
    get user() { return USER; }, get config() { return CFG; }, set config(c) { CFG = c; },
    get unlocked() { return !!K; },
  };
})();
