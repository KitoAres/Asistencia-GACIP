(function () {
  'use strict';
  const { $,$$, esc, toast, modal, close, confirm, hora, fechaHora, fechaCorta, fechaLarga, download, downloadText, slug, beep, TZ } = UI;

  const ROL = { sudo: 'Sudo', admin: 'Admin', user: 'Participante' };
  const STAFF_TABS = [['scan', 'Escanear'], ['hoy', 'Hoy'], ['personas', 'Personas'], ['ranking', 'Ranking'], ['cuenta', 'Mi cuenta']];
  const TABS = { user: [['ranking', 'Ranking'], ['cuenta', 'Mi ficha']], admin: STAFF_TABS, sudo: STAFF_TABS };

  const state = { user: null, tab: null, personas: [], q: '', rol: 'todos', scanLog: [], facing: 'environment' };
  const isSudo = () => !!state.user && state.user.rol === 'sudo';
  const isStaff = () => !!state.user && state.user.rol !== 'user';
  const nombreDe = p => (p && (p.nombre_completo || p.nombre)) || '';
  const inicial = p => (nombreDe(p) || '?').trim().charAt(0).toUpperCase();
  const csv = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';

  /* ===================== Generador de QR ===================== */
  const makeQR = async (code) => {
    try {
      if (window.QRCode && typeof window.QRCode.toDataURL === 'function') {
        return await window.QRCode.toDataURL(code, { width: 512, margin: 2, errorCorrectionLevel: 'M' });
      }
      const res = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=512x512&margin=2&data=${encodeURIComponent(code)}`);
      if (!res.ok) throw new Error('Falló la conexión al servidor de QR');
      const blob = await res.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Error procesando imagen QR'));
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      throw new Error('No se pudo generar el QR: ' + e.message);
    }
  };

  /* ===================== Sesión ===================== */
  function showLogin() {
    Scanner.stop();
    $('#app').classList.add('hidden');
    $('#vista-login').classList.remove('hidden');
    $('#login-pass').value = '';
    $('#login-error').textContent = '';
  }

  function enter() {
    $('#vista-login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#user-name').textContent = nombreDe(state.user);
    const b = $('#user-rol');
    b.textContent = ROL[state.user.rol];
    b.className = 'badge ' + state.user.rol;
    $('#nav').innerHTML = TABS[state.user.rol].map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('');
    go(isStaff() ? 'scan' : 'ranking');
  }

  async function boot() {
    Api.init();
    Api.onExpire = () => {
      Api.clear(); state.user = null; showLogin();
      toast('Tu sesión expiró. Ingresa de nuevo.', 'error');
    };
    bind();
    if (Api.token) {
      try { state.user = await Api.yo(); enter(); return; } catch (_) { Api.clear(); }
    }
    showLogin();
  }

  /* ===================== Navegación ===================== */
  const views = {};
  async function go(tab) {
    if (Scanner.active) await Scanner.stop();
    state.tab = tab;
    $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const el = $('#contenido');
    el.innerHTML = '<p class="muted center">Cargando…</p>';
    try { await views[tab](el); }
    catch (e) { el.innerHTML = `<div class="card"><p class="error">${esc(e.message)}</p></div>`; }
  }

  /* ===================== Escanear ===================== */
  let busy = false, lastCode = '', lastAt = 0;

  views.scan = async el => {
    const hoy = new Date().toLocaleDateString('es-BO', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
    el.innerHTML = `
      <section class="card center-content">
        <h2 style="color: var(--brand); font-size: 1.5rem;">Escanear Asistencia</h2>
        <p class="muted">${esc(hoy)} · Registra la asistencia diaria.</p>
        <div id="reader" class="reader"></div>
        <div class="row" style="justify-content:center; margin-top:1rem;">
          <button id="btn-cam" class="primary">Activar cámara</button>
          <button id="btn-switch" class="ghost hidden">Cambiar cámara</button>
        </div>
        <div id="scan-result" class="scan-result" role="status"></div>
      </section>
      <section class="card"><h3>Últimos escaneos de esta sesión</h3><ul id="scan-log" class="log"></ul></section>`;
    renderLog();
    $('#btn-cam').onclick = toggleCam;
    $('#btn-switch').onclick = async () => {
      state.facing = state.facing === 'environment' ? 'user' : 'environment';
      await startCam();
    };
  };

  async function startCam() {
    try {
      await Scanner.start('reader', onCode, state.facing);
      const b = $('#btn-cam'); if (b) b.textContent = 'Detener cámara';
      const s = $('#btn-switch'); if (s) s.classList.remove('hidden');
    } catch (e) {
      await Scanner.stop();
      showResult('bad', 'No se pudo abrir la cámara', Scanner.explain(e));
    }
  }
  async function toggleCam() {
    if (Scanner.active) {
      await Scanner.stop();
      $('#btn-cam').textContent = 'Activar cámara';
      $('#btn-switch').classList.add('hidden');
    } else { await startCam(); }
  }

  function showResult(kind, title, sub) {
    const r = $('#scan-result');
    if (!r) return;
    r.className = 'scan-result show ' + kind;
    r.innerHTML = `${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
  }
  function pushLog(estado, nombre, ts) {
    state.scanLog.unshift({ estado, nombre, ts });
    state.scanLog = state.scanLog.slice(0, 10);
    renderLog();
  }
  function renderLog() {
    const ul = $('#scan-log');
    if (!ul) return;
    const lbl = { ok: 'Asistencia', ya: 'Ya marcó', bad: 'Inválido' };
    ul.innerHTML = state.scanLog.length
      ? state.scanLog.map(l => `<li><span><strong>${esc(l.nombre)}</strong> <span class="muted sm-text">${esc(hora(l.ts))}</span></span><span class="tag ${l.estado}">${lbl[l.estado]}</span></li>`).join('')
      : '<li class="muted center">Esperando el primer escaneo...</li>';
  }

  async function onCode(text) {
    const now = Date.now();
    if (busy || (text === lastCode && now - lastAt < 4000)) return;
    busy = true; lastCode = text; lastAt = now;
    try {
      const r = await Api.registrar(text);
      if (r.estado === 'ok') {
        beep(true);
        showResult('ok', '✔ Asistencia Registrada', `${nombreDe(r)} · ${hora(r.hora)}`);
        pushLog('ok', nombreDe(r), r.hora);
      } else if (r.estado === 'ya_registrado') {
        beep(false);
        showResult('ya', 'Asistencia ya registrada hoy', `${nombreDe(r)} marcó a las ${hora(r.hora)}`);
        pushLog('ya', nombreDe(r), r.hora);
      } else {
        beep(false);
        showResult('bad', 'QR No Válido', 'Este código no pertenece a ninguna persona registrada.');
        pushLog('bad', 'QR desconocido', new Date().toISOString());
      }
    } catch (e) {
      beep(false);
      showResult('bad', 'Error', e.message);
    } finally { setTimeout(() => { busy = false; }, 1200); }
  }

  /* ===================== Hoy ===================== */
  views.hoy = async el => {
    const d = await Api.hoy();
    const fila = (p, extra) => `<li><span><strong>${esc(nombreDe(p))}</strong> <span class="muted sm-text">@${esc(p.nombre)}</span></span><span class="muted sm-text">${extra}</span></li>`;
    
    // Opcional: Filtrar admins de la vista de "Faltan" si el backend los trae
    const ausentesReales = d.ausentes.filter(a => a.rol === 'user');

    el.innerHTML = `
      <section class="card">
        <div class="row between"><h2 style="margin:0">Asistencia de Hoy</h2><button id="csv" class="ghost sm">Descargar CSV</button></div>
        <p class="muted">${esc(fechaLarga(d.fecha))}</p>
        <div class="stats" style="grid-template-columns:repeat(2,1fr)">
          <div class="stat"><b>${d.presentes.length}</b><span>Presentes</span></div>
          <div class="stat"><b>${ausentesReales.length}</b><span>Faltan</span></div>
        </div>
        <h3 style="color:var(--ok)">Presentes</h3>
        <ul class="log">${d.presentes.length ? d.presentes.map(p => fila(p, esc(hora(p.hora)))).join('') : '<li class="muted">Nadie ha marcado todavía.</li>'}</ul>
        <h3 style="margin-top:1.5rem; color:var(--bad)">Faltan por marcar</h3>
        <ul class="log">${ausentesReales.length ? ausentesReales.map(p => fila(p, '')).join('') : '<li class="muted">Todos están presentes 🎉</li>'}</ul>
      </section>`;
      
    $('#csv').onclick = () => {
      const rows = [['Estado', 'Usuario', 'Nombre completo', 'Hora']]
        .concat(d.presentes.map(p => ['Presente', p.nombre, p.nombre_completo || '', hora(p.hora)]))
        .concat(ausentesReales.map(p => ['Falta', p.nombre, p.nombre_completo || '', '']));
      downloadText(`asistencia-${d.fecha}.csv`, rows.map(r => r.map(csv).join(',')).join('\n'));
    };
  };

  /* ===================== Personas ===================== */
  views.personas = async el => {
    state.personas = await Api.listarUsuarios();
    el.innerHTML = `
      <div class="toolbar">
        <input id="q" type="search" placeholder="Buscar persona..." value="${esc(state.q)}">
        ${isSudo() ? `<select id="rolf"><option value="todos">Todos</option><option value="user">Participantes</option><option value="admin">Admins</option></select>
        <button id="nuevo" class="primary">+ Nuevo Registro</button>` : ''}
      </div>
      <div id="lista"></div>`;
    $('#q').oninput = e => { state.q = e.target.value; renderLista(); };
    if (isSudo()) {
      $('#rolf').value = state.rol;
      $('#rolf').onchange = e => { state.rol = e.target.value; renderLista(); };
      $('#nuevo').onclick = openNuevo;
    }
    $('#lista').onclick = onListaClick;
    renderLista();
  };

  function renderLista() {
    const box = $('#lista');
    if (!box) return;
    const q = state.q.trim().toLowerCase();
    const rows = state.personas.filter(p =>
      (state.rol === 'todos' || p.rol === state.rol) &&
      `${p.nombre} ${p.nombre_completo || ''}`.toLowerCase().includes(q));
    
    box.innerHTML = rows.length ? rows.map(p => `
      <div class="persona" data-id="${p.id}">
        <div class="avatar">${esc(inicial(p))}</div>
        <div class="info">
          <strong>${esc(nombreDe(p))}<span class="badge ${p.rol}">${ROL[p.rol]}</span></strong>
          <span class="muted sm-text">@${esc(p.nombre)}</span>
        </div>
        <div class="acts">
          <button class="primary sm" data-act="ficha">${p.rol === 'user' ? 'Ver QR / Ficha' : 'Ver Perfil'}</button>
          ${p.rol === 'user' ? `<button class="ghost sm" data-act="asist">Marcar hoy</button>` : ''}
          ${isSudo() ? '<button class="ghost sm danger-text" data-act="borrar" style="color:var(--bad)">Eliminar</button>' : ''}
        </div>
      </div>`).join('') : '<p class="muted center">No hay personas para mostrar.</p>';
  }

  async function onListaClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.persona').dataset.id;
    const p = state.personas.find(x => x.id === id);
    try {
      if (btn.dataset.act === 'ficha') await openFicha(id);
      else if (btn.dataset.act === 'asist') {
        const r = await Api.registrar(p.qr_codigo || p.id);
        if (r.estado === 'ok') toast(`Asistencia de ${nombreDe(p)} registrada`, 'ok');
        else if (r.estado === 'ya_registrado') toast(`${nombreDe(p)} ya registró su asistencia hoy`);
        else toast('QR no válido', 'error');
      } else if (btn.dataset.act === 'borrar') {
        if (await confirm(`¿Eliminar definitivamente a ${nombreDe(p)}?`, 'Eliminar')) {
          await Api.eliminarUsuario(id);
          state.personas = state.personas.filter(x => x.id !== id);
          renderLista();
          toast('Persona eliminada del sistema', 'ok');
        }
      }
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ---------- Nueva persona ---------- */
  function openNuevo() {
    modal(`
      <h3 style="color: var(--brand); text-align: center;">Registrar Nuevo Usuario</h3>
      <form id="f-nuevo">
        <div class="grid2">
          <label>Nombre de usuario (Login)<input name="nombre" required minlength="2" autocapitalize="none" autocomplete="off"></label>
          <label>Contraseña temporal<input name="password" required minlength="4" autocomplete="off"></label>
        </div>
        <label>Nombre completo<input name="nombre_completo" required></label>
        <label>Rol en el sistema<select name="rol"><option value="user">Participante</option><option value="admin">Admin</option></select></label>
        <p id="f-err" class="error"></p>
        <div class="row end" style="margin-top: 1rem;">
          <button type="button" class="ghost" data-close>Cancelar</button>
          <button class="primary" type="submit">Guardar</button>
        </div>
      </form>`);
      
    $('#f-nuevo').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true; $('#f-err').textContent = 'Guardando usuario...';
      let u;
      try {
        u = await Api.crearUsuario({
          nombre: f.get('nombre'), password: f.get('password'), rol: f.get('rol'),
          ficha: { nombre_completo: f.get('nombre_completo') }
        });
      } catch (err) { $('#f-err').textContent = err.message; btn.disabled = false; return; }

      let img = null;
      // SOLO generamos el QR si es un Participante ('user')
      if (u.rol === 'user') {
        try { 
          const codeText = u.qr_codigo || u.id; 
          img = await makeQR(codeText); 
          await Api.guardarQr(u.id, img); 
          u.qr_imagen = img; 
        }
        catch (error) { 
          toast('Persona creada. Revisa tu conexión a internet para cargar su imagen QR.', 'error'); 
        }
      }

      state.personas.push(u);
      state.personas.sort((a, b) => a.nombre.toLowerCase().localeCompare(b.nombre.toLowerCase()));
      renderLista();
      showSuccess(u, img, f.get('password'));
    };
  }

  function showSuccess(u, img, pass) {
    const isUser = u.rol === 'user';
    modal(`
      <h3 style="text-align:center; color: var(--ok);">¡Registro Exitoso!</h3>
      <div class="qr-box">
        ${isUser && img ? `<img src="${img}" alt="Código QR de ${esc(nombreDe(u))}"><p style="font-size: 1.1rem;"><strong>${esc(nombreDe(u))}</strong></p>` : `<p style="font-size: 1.2rem; margin-top: 1rem;"><strong>${esc(nombreDe(u))} <span class="badge ${u.rol}">${ROL[u.rol]}</span></strong></p>`}
        <p class="muted">Usuario: <strong>${esc(u.nombre)}</strong> <br> Contraseña: <strong>${esc(pass)}</strong></p>
        <div class="row" style="justify-content:center; margin-top: 1rem;">
          ${isUser && img ? `<button class="primary" id="dl-qr">Descargar QR</button>` : ''}
          <button class="ghost" data-close>Cerrar</button>
        </div>
      </div>`);
    if (isUser && img) $('#dl-qr').onclick = () => download(`qr-${slug(u.nombre)}.png`, img);
  }

  /* ---------- Ficha (ver/editar) ---------- */
  function perfilHTML(p) {
    const asis = p.asistencias.length
      ? `<div class="stats" style="grid-template-columns:1fr; margin-bottom: 1rem;">
           <div class="stat">
             <b style="color:var(--brand); font-size: 2rem;">${p.asistencias.length}</b>
             <span>Asistencias Totales</span>
           </div>
         </div>
         <div class="chips">${p.asistencias.map(f => `<span class="chip">${esc(fechaCorta(f))}</span>`).join('')}</div>`
      : '<p class="muted center" style="padding: 1rem; border: 1px dashed var(--line); border-radius: 12px;">Aún no tiene asistencias registradas.</p>';
    return `<h4 style="margin-top:1.5rem; text-align:center;">Historial de Asistencia</h4>${asis}`;
  }

  async function openFicha(id) {
    const base = state.personas.find(x => x.id === id);
    modal('<p class="muted center">Cargando información...</p>');
    const [u, perfil] = await Promise.all([
      Api.verUsuario(id),
      base && base.rol === 'user' ? Api.perfil(id) : Promise.resolve(null)
    ]);
    
    const isUser = u.rol === 'user';
    let img = u.qr_imagen;
    
    // Solo generamos QR de emergencia si es participante
    if (isUser && !img) { 
      try {
        const codeText = u.qr_codigo || u.id;
        img = await makeQR(codeText); 
        Api.guardarQr(id, img).catch(() => {}); 
      } catch (err) {
        img = null; 
      }
    }

    const qrBoxHTML = isUser ? `
      <div class="qr-box">
        ${img ? `<img src="${img}" alt="QR de ${esc(nombreDe(u))}"><p><button class="primary sm" id="dl-qr" style="width:100%">Descargar QR</button></p>` 
              : `<p class="muted" style="padding: 2rem; border: 1px dashed var(--line); border-radius:12px;">⚠️ No se pudo generar el QR por problemas de red.</p>`}
      </div>` : '';

    modal(`
      <h3 style="text-align:center;">${esc(nombreDe(u))} <span class="badge ${u.rol}">${ROL[u.rol]}</span></h3>
      <p class="muted sm-text center" style="margin-top:-10px;">@${esc(u.nombre)}</p>
      
      <div class="ficha" ${!isUser ? 'style="grid-template-columns: 1fr;"' : ''}>
        ${qrBoxHTML}
        <div class="ficha-datos">
          <form id="f-ficha">
            <label>Nombre completo<input name="nombre_completo" value="${esc(u.nombre_completo)}"></label>
            <button class="ghost" style="width:100%; margin-top:0.5rem;" type="submit">Actualizar Datos</button>
          </form>
          ${isSudo() ? `
          <hr style="border:0; border-top:1px solid var(--line); margin: 1rem 0;">
          <label class="muted sm-text">Restablecer Contraseña</label>
          <div class="row" style="flex-wrap: nowrap;">
            <input id="new-pass" placeholder="Nueva clave" style="flex:1; margin:0;" autocomplete="off">
            <button class="danger sm" id="btn-reset">Cambiar</button>
          </div>` : ''}
        </div>
      </div>
      ${isUser && perfil ? perfilHTML(perfil) : ''}`);

    if (isUser && img) {
      $('#dl-qr').onclick = () => download(`qr-${slug(u.nombre)}.png`, img);
    }
    
    $('#f-ficha').onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try {
        const nu = await Api.actualizarFicha(id, f);
        const i = state.personas.findIndex(x => x.id === id);
        if (i >= 0) state.personas[i] = { ...state.personas[i], ...nu };
        renderLista();
        toast('Datos actualizados', 'ok');
      } catch (err) { toast(err.message, 'error'); }
    };
    
    if (isSudo()) {
      $('#btn-reset').onclick = async () => {
        if(!$('#new-pass').value) return toast('Ingresa una contraseña válida', 'error');
        try { await Api.cambiarPassword(id, $('#new-pass').value); $('#new-pass').value = ''; toast('Contraseña actualizada', 'ok'); }
        catch (err) { toast(err.message, 'error'); }
      };
    }
  }

 /* ===================== Ranking (Solo asistencias, Solo PARTICIPANTES) ===================== */
  views.ranking = async el => {
    el.innerHTML = '<p class="muted center">Calculando posiciones...</p>';
    
    // Obtenemos TODOS los usuarios y los datos del ranking al mismo tiempo
    const [usuarios, rankingData] = await Promise.all([
      Api.listarUsuarios(),
      Api.ranking().catch(() => []) // Si falla el ranking del backend, usamos arreglo vacío
    ]);
    
    // 1. Filtramos estrictamente a los participantes (rol: user)
    // 2. Cruzamos sus datos con la cantidad de asistencias que dice el ranking
    const validos = usuarios.filter(u => u.rol === 'user').map(u => {
      const stats = rankingData.find(r => r.id === u.id);
      return {
        ...u,
        asistencias: stats ? Number(stats.asistencias || 0) : 0
      };
    });
    
    // Ordenamos de mayor a menor asistencia
    validos.sort((a, b) => b.asistencias - a.asistencias);

    // Calculamos las posiciones reales (los empates comparten posición)
    let pos = 0, prev = null, i = 0;
    validos.forEach(r => { 
        i++; 
        if (r.asistencias !== prev) { pos = i; prev = r.asistencias; } 
        r.pos = pos; 
    });

    const fila = r => {
      const yo = state.user && r.id === state.user.id;
      let medalla = r.pos;
      
      // Solo damos medallas a los primeros 3 lugares SI tienen al menos 1 asistencia
      if(r.pos === 1 && r.asistencias > 0) medalla = '🥇';
      else if(r.pos === 2 && r.asistencias > 0) medalla = '🥈';
      else if(r.pos === 3 && r.asistencias > 0) medalla = '🥉';

      const isTop = r.pos <= 3 && r.asistencias > 0;

      return `<div class="rank ${isTop ? 'top' + r.pos : ''} ${yo ? 'yo' : ''}">
        <div class="pos">${medalla}</div>
        <div class="body">
          <div class="name"><span>${esc(nombreDe(r))}${yo ? ' <span class="muted sm-text">(Tú)</span>' : ''}</span></div>
          <span class="muted sm-text">@${esc(r.nombre)}</span>
        </div>
        <div class="rank-stats">
          ${r.asistencias}
          <span class="muted sm-text" style="display:block; font-size:0.7rem; font-weight:normal; text-transform:uppercase;">Asist.</span>
        </div>
      </div>`;
    };

    el.innerHTML = `
      <section class="card banner-ranking" style="background: linear-gradient(135deg, var(--brand), var(--accent)); text-align:center; padding: 1.5rem; color: #fff; border: none;">
        <h2 style="margin:0; font-size: 1.6rem; color: #fff;">🏆 Ranking GACIP</h2>
        <p style="opacity:0.9; margin:0; font-size: 0.9rem;">Voluntarios con más asistencias marcadas.</p>
      </section>
      <div style="margin-top: 1rem;">
        ${validos.length ? validos.map(fila).join('') : '<p class="muted center">Aún no hay participantes registrados.</p>'}
      </div>`;
  };

  /* ===================== Mi cuenta / Mi ficha ===================== */
  views.cuenta = async el => {
    const me = await Api.yo();
    state.user = me;
    $('#user-name').textContent = nombreDe(me);
    let bloque = '';
    
    if (me.rol === 'user') {
      const perfil = await Api.perfil(me.id);
      
      let img = me.qr_imagen;
      if(!img) {
        try { img = await makeQR(me.qr_codigo || me.id); } catch(e) { img = ''; }
      }

      bloque = `
        <section class="card">
          <div class="ficha">
            <div class="qr-box">
              ${img ? `<img src="${img}" alt="Tu código QR">
                       <p><button class="primary sm" id="dl-qr" style="width:100%">Descargar mi QR</button></p>` 
                    : `<p class="muted">Sin conexión para generar QR</p>`}
              <p class="muted sm-text">Muéstralo al encargado para marcar tu asistencia.</p>
            </div>
            <div class="ficha-datos">
              <h2 style="color:var(--brand); margin-bottom: 0;">${esc(nombreDe(me))}</h2>
              <p class="muted">@${esc(me.nombre)}</p>
              ${perfilHTML(perfil)}
            </div>
          </div>
        </section>`;
    } else {
      bloque = `<section class="card center"><h2 style="color:var(--brand);">${esc(nombreDe(me))}</h2><p class="muted">@${esc(me.nombre)} · ${ROL[me.rol]}</p></section>`;
    }
    
    el.innerHTML = `${bloque}
      <section class="card">
        <h3>Cambiar contraseña</h3>
        <form id="f-pass">
          <label>Contraseña actual<input type="password" name="actual" autocomplete="current-password" required></label>
          <div class="grid2">
            <label>Nueva contraseña<input type="password" name="nueva" autocomplete="new-password" minlength="4" required></label>
            <label>Repetir nueva contraseña<input type="password" name="rep" autocomplete="new-password" minlength="4" required></label>
          </div>
          <p id="f-err" class="error"></p>
          <button class="primary" style="width:100%; margin-top: 0.5rem;" type="submit">Actualizar contraseña</button>
        </form>
      </section>
      <div class="center" style="margin-top: 1rem;"><button class="ghost danger-text" id="btn-logout-inside" style="color: var(--bad); border-color: var(--bad);">Cerrar Sesión</button></div>`;
      
    const dl = $('#dl-qr');
    if (dl) dl.onclick = () => download(`qr-${slug(me.nombre)}.png`, me.qr_imagen || img);
    
    $('#btn-logout-inside').onclick = $('#btn-logout').onclick; // Vincula al boton principal de cierre

    $('#f-pass').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      if (f.get('nueva') !== f.get('rep')) { $('#f-err').textContent = 'Las contraseñas nuevas no coinciden.'; return; }
      try {
        await Api.cambiarMiPassword(f.get('actual'), f.get('nueva'));
        e.target.reset(); $('#f-err').textContent = '';
        toast('Contraseña actualizada', 'ok');
      } catch (err) { $('#f-err').textContent = err.message; }
    };
  };

  /* ===================== Eventos globales ===================== */
  function bind() {
    $('#form-login').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true; $('#login-error').textContent = '';
      try {
        await Api.login($('#login-nombre').value, $('#login-pass').value);
        state.user = await Api.yo();
        enter();
      } catch (err) { $('#login-error').textContent = err.message; }
      finally { btn.disabled = false; }
    });
    $('#toggle-pass').onclick = () => {
      const i = $('#login-pass');
      const ver = i.type === 'password';
      i.type = ver ? 'text' : 'password';
      $('#toggle-pass').textContent = ver ? 'Ocultar' : 'Ver';
    };
    $('#btn-logout').onclick = async () => {
      if(Scanner.active) await Scanner.stop();
      await Api.logout();
      state.user = null; state.scanLog = [];
      showLogin();
    };
    $('#nav').addEventListener('click', e => {
      const b = e.target.closest('[data-tab]');
      if (b) go(b.dataset.tab);
    });
    $('#modal').addEventListener('click', e => {
      if (e.target.closest('[data-close]') || e.target === $('#modal')) close();
    });
    $('#modal').addEventListener('close', () => { if (state.tab === 'personas') renderLista(); });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
