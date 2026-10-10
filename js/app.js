(function () {
  'use strict';
  const { $, $$, esc, toast, modal, close, confirm, hora, fechaHora, fechaCorta, fechaLarga, download, downloadText, slug, beep, TZ } = UI;

  // Escala de frecuencia 0-4 (formato MLQ). Los criterios salen de la tabla "criterios".
  const ESCALA = ['Nunca', 'Rara vez', 'A veces', 'A menudo', 'Frecuentemente, si no siempre'];
  const ROL = { sudo: 'Sudo', admin: 'Admin', user: 'Participante' };
  const STAFF_TABS = [['scan', 'Escanear'], ['hoy', 'Hoy'], ['personas', 'Personas'], ['ranking', 'Ranking'], ['cuenta', 'Mi cuenta']];
  const TABS = { user: [['ranking', 'Ranking'], ['cuenta', 'Mi ficha']], admin: STAFF_TABS, sudo: STAFF_TABS };

  const state = { user: null, tab: null, personas: [], q: '', rol: 'todos', scanLog: [], facing: 'environment' };
  const isSudo = () => !!state.user && state.user.rol === 'sudo';
  const isStaff = () => !!state.user && state.user.rol !== 'user';
  const nombreDe = p => (p && (p.nombre_completo || p.nombre)) || '';
  const inicial = p => (nombreDe(p) || '?').trim().charAt(0).toUpperCase();
  const makeQR = code => QRCode.toDataURL(code, { width: 512, margin: 2, errorCorrectionLevel: 'M' });
  const num = v => (v === null || v === undefined ? null : Number(v));
  const fmt = v => (v === null || v === undefined ? '—' : Number(v).toFixed(2));
  const csv = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';

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
      <section class="card">
        <h2>Pasar lista</h2>
        <p class="muted">${esc(hoy)} · cada persona se registra una sola vez por día.</p>
        <div id="reader" class="reader"></div>
        <div class="row" style="justify-content:center">
          <button id="btn-cam" class="primary">Activar cámara</button>
          <button id="btn-switch" class="ghost hidden">Cambiar cámara</button>
        </div>
        <div id="scan-result" class="scan-result" role="status"></div>
      </section>
      <section class="card"><h3>Registros de esta sesión</h3><ul id="scan-log" class="log"></ul></section>`;
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
    state.scanLog = state.scanLog.slice(0, 30);
    renderLog();
  }
  function renderLog() {
    const ul = $('#scan-log');
    if (!ul) return;
    const lbl = { ok: 'Registrado', ya: 'Ya estaba', bad: 'No válido' };
    ul.innerHTML = state.scanLog.length
      ? state.scanLog.map(l => `<li><span>${esc(l.nombre)} <span class="muted sm-text">${esc(hora(l.ts))}</span></span><span class="tag ${l.estado}">${lbl[l.estado]}</span></li>`).join('')
      : '<li class="muted">Todavía no has escaneado a nadie.</li>';
  }

  async function onCode(text) {
    const now = Date.now();
    if (busy || (text === lastCode && now - lastAt < 4000)) return;
    busy = true; lastCode = text; lastAt = now;
    try {
      const r = await Api.registrar(text);
      if (r.estado === 'ok') {
        beep(true);
        showResult('ok', '✔ Asistencia registrada', `${nombreDe(r)} · ${hora(r.hora)}`);
        pushLog('ok', nombreDe(r), r.hora);
      } else if (r.estado === 'ya_registrado') {
        beep(false);
        showResult('ya', 'Ya registrado hoy', `${nombreDe(r)} marcó a las ${hora(r.hora)}`);
        pushLog('ya', nombreDe(r), r.hora);
      } else {
        beep(false);
        showResult('bad', 'QR no válido', 'Este código no pertenece a ninguna persona registrada.');
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
    const fila = (p, extra) => `<li><span>${esc(nombreDe(p))} <span class="muted sm-text">@${esc(p.nombre)}</span></span><span class="muted sm-text">${extra}</span></li>`;
    el.innerHTML = `
      <section class="card">
        <div class="row between"><h2 style="margin:0">Asistencia de hoy</h2><button id="csv" class="ghost sm">Descargar CSV</button></div>
        <p class="muted">${esc(fechaLarga(d.fecha))}</p>
        <div class="stats" style="grid-template-columns:repeat(2,1fr)">
          <div class="stat"><b>${d.presentes.length}</b><span>Presentes</span></div>
          <div class="stat"><b>${d.ausentes.length}</b><span>Faltan</span></div>
        </div>
        <h3>Presentes</h3>
        <ul class="log">${d.presentes.length ? d.presentes.map(p => fila(p, esc(hora(p.hora)))).join('') : '<li class="muted">Nadie ha marcado todavía.</li>'}</ul>
        <h3 style="margin-top:1rem">Faltan por marcar</h3>
        <ul class="log">${d.ausentes.length ? d.ausentes.map(p => fila(p, '')).join('') : '<li class="muted">Todos presentes 🎉</li>'}</ul>
      </section>`;
    $('#csv').onclick = () => {
      const rows = [['Estado', 'Usuario', 'Nombre completo', 'Hora']]
        .concat(d.presentes.map(p => ['Presente', p.nombre, p.nombre_completo || '', hora(p.hora)]))
        .concat(d.ausentes.map(p => ['Falta', p.nombre, p.nombre_completo || '', '']));
      downloadText(`asistencia-${d.fecha}.csv`, rows.map(r => r.map(csv).join(',')).join('\n'));
    };
  };

  /* ===================== Personas ===================== */
  views.personas = async el => {
    state.personas = await Api.listarUsuarios();
    el.innerHTML = `
      <div class="toolbar">
        <input id="q" type="search" placeholder="Buscar por nombre…" value="${esc(state.q)}">
        ${isSudo() ? `<select id="rolf"><option value="todos">Todos</option><option value="user">Participantes</option><option value="admin">Admins</option></select>
        <button id="nuevo" class="primary">+ Nueva persona</button>` : ''}
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
          <button class="ghost sm" data-act="ficha">Ficha</button>
          ${p.rol === 'user' ? '<button class="ghost sm" data-act="evaluar">Evaluar</button>' : ''}
          <button class="ghost sm" data-act="asist">Marcar hoy</button>
          ${isSudo() ? '<button class="ghost sm" data-act="borrar" style="color:var(--bad)">Eliminar</button>' : ''}
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
      else if (btn.dataset.act === 'evaluar') await openEvaluar(id);
      else if (btn.dataset.act === 'asist') {
        const r = await Api.registrar(p.qr_codigo);
        if (r.estado === 'ok') toast(`Asistencia de ${nombreDe(p)} registrada`, 'ok');
        else if (r.estado === 'ya_registrado') toast(`${nombreDe(p)} ya estaba registrado hoy`);
        else toast('QR no válido', 'error');
      } else if (btn.dataset.act === 'borrar') {
        if (await confirm(`¿Eliminar a ${nombreDe(p)}? Se borran también su asistencia y evaluaciones.`, 'Eliminar')) {
          await Api.eliminarUsuario(id);
          state.personas = state.personas.filter(x => x.id !== id);
          renderLista();
          toast('Persona eliminada', 'ok');
        }
      }
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ---------- Nueva persona (genera y guarda el QR) ---------- */
  function openNuevo() {
    modal(`
      <h3>Nueva persona</h3>
      <form id="f-nuevo">
        <div class="grid2">
          <label>Nombre de usuario<input name="nombre" required minlength="2" autocapitalize="none" autocomplete="off"></label>
          <label>Contraseña<input name="password" required minlength="4" autocomplete="off"></label>
        </div>
        <label>Rol<select name="rol"><option value="user">Participante</option><option value="admin">Admin</option></select></label>
        <label>Nombre completo<input name="nombre_completo"></label>
        <label>Observaciones<textarea name="observaciones"></textarea></label>
        <p id="f-err" class="error"></p>
        <div class="row end"><button type="button" class="ghost" data-close>Cancelar</button><button class="primary" type="submit">Crear y generar QR</button></div>
      </form>`);
    $('#f-nuevo').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true; $('#f-err').textContent = '';
      let u;
      try {
        u = await Api.crearUsuario({
          nombre: f.get('nombre'), password: f.get('password'), rol: f.get('rol'),
          ficha: { nombre_completo: f.get('nombre_completo'), observaciones: f.get('observaciones') }
        });
      } catch (err) { $('#f-err').textContent = err.message; btn.disabled = false; return; }

      let img = null;
      try { img = await makeQR(u.qr_codigo); await Api.guardarQr(u.id, img); u.qr_imagen = img; }
      catch (_) { toast('Persona creada, pero el QR no se pudo guardar. Ábrelo desde su ficha.', 'error'); }

      state.personas.push(u);
      state.personas.sort((a, b) => a.nombre.toLowerCase().localeCompare(b.nombre.toLowerCase()));
      renderLista();
      if (img) showQR(u, img, f.get('password'));
      else close();
    };
  }

  function showQR(u, img, pass) {
    modal(`
      <h3>Persona creada ✔</h3>
      <div class="qr-box">
        <img src="${img}" alt="Código QR de ${esc(nombreDe(u))}">
        <p><strong>${esc(nombreDe(u))}</strong><br><span class="muted sm-text">Usuario: ${esc(u.nombre)} · Contraseña: ${esc(pass)}</span></p>
        <p class="muted sm-text">El QR ya quedó guardado en su ficha.</p>
        <div class="row" style="justify-content:center">
          <button class="primary" id="dl-qr">Descargar QR</button>
          <button class="ghost" data-close>Cerrar</button>
        </div>
      </div>`);
    $('#dl-qr').onclick = () => download(`qr-${slug(u.nombre)}.png`, img);
  }

  /* ---------- Ficha (ver/editar) ---------- */
  function perfilHTML(p, canDel) {
    const bars = p.criterios.map(c => {
      const v = num(c.promedio);
      return `<div class="ev" style="display:block"><div class="row between"><span>${esc(c.nombre)}</span><b>${fmt(v)}</b></div><div class="bar"><i style="width:${v === null ? 0 : (v / 4) * 100}%"></i></div></div>`;
    }).join('');
    const evs = p.evaluaciones.length
      ? p.evaluaciones.map(e => `<div class="ev"><span>${esc(e.actividad)} <span class="muted sm-text">· ${esc(fechaHora(e.creado_en))}</span></span><span class="row"><b>${fmt(e.promedio)}</b>${canDel ? `<button class="ghost sm" data-ev="${e.id}">Quitar</button>` : ''}</span></div>`).join('')
      : '<p class="muted">Aún sin evaluaciones.</p>';
    const asis = `<p class="muted sm-text">${p.asistencias.length} asistencia(s) registradas</p><div class="chips">${p.asistencias.slice(0, 12).map(f => `<span class="chip">${esc(fechaCorta(f))}</span>`).join('')}</div>`;
    return `<h4>Influencia idealizada (atributos) · promedio 0–4</h4>${bars}<h4>Evaluaciones</h4>${evs}<h4>Asistencia</h4>${asis}`;
  }

  async function openFicha(id) {
    const base = state.personas.find(x => x.id === id);
    modal('<p class="muted center">Cargando…</p>');
    const [u, perfil] = await Promise.all([
      Api.verUsuario(id),
      base && base.rol === 'user' ? Api.perfil(id) : Promise.resolve(null)
    ]);
    let img = u.qr_imagen;
    if (!img && isSudo()) { img = await makeQR(u.qr_codigo); Api.guardarQr(id, img).catch(() => { }); }

    modal(`
      <h3>${esc(nombreDe(u))}<span class="badge ${u.rol}">${ROL[u.rol]}</span></h3>
      <p class="muted sm-text">Usuario: @${esc(u.nombre)}</p>
      <div class="ficha">
        <div class="qr-box">
          ${img ? `<img src="${img}" alt="QR de ${esc(nombreDe(u))}"><p><button class="ghost sm" id="dl-qr">Descargar QR</button></p>` : '<p class="muted">Sin QR</p>'}
        </div>
        <form id="f-ficha">
          <label>Nombre completo<input name="nombre_completo" value="${esc(u.nombre_completo)}"></label>
          <label>Observaciones<textarea name="observaciones">${esc(u.observaciones)}</textarea></label>
          <div class="row end"><button class="primary" type="submit">Guardar cambios</button></div>
        </form>
      </div>
      ${isSudo() ? `<h4>Restablecer contraseña</h4>
        <div class="row"><input id="new-pass" placeholder="Nueva contraseña" style="flex:1;margin:0" autocomplete="off"><button class="ghost" id="btn-reset">Cambiar</button></div>` : ''}
      ${perfil ? perfilHTML(perfil, true) : ''}`);

    if (img) $('#dl-qr').onclick = () => download(`qr-${slug(u.nombre)}.png`, img);
    $('#f-ficha').onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try {
        const nu = await Api.actualizarFicha(id, f);
        const i = state.personas.findIndex(x => x.id === id);
        if (i >= 0) state.personas[i] = { ...state.personas[i], ...nu };
        renderLista();
        toast('Ficha actualizada', 'ok');
      } catch (err) { toast(err.message, 'error'); }
    };
    if (isSudo()) {
      $('#btn-reset').onclick = async () => {
        try { await Api.cambiarPassword(id, $('#new-pass').value); $('#new-pass').value = ''; toast('Contraseña actualizada', 'ok'); }
        catch (err) { toast(err.message, 'error'); }
      };
    }
    $$('[data-ev]').forEach(b => b.onclick = async () => {
      try {
        if (await confirm('¿Quitar esta evaluación?', 'Quitar')) {
          await Api.eliminarEvaluacion(b.dataset.ev);
          toast('Evaluación eliminada', 'ok');
          await openFicha(id);
        }
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* ---------- Evaluar ---------- */
  async function openEvaluar(id) {
    const p = state.personas.find(x => x.id === id);
    const crit = await Api.criterios();
    modal(`
      <h3>Evaluar a ${esc(nombreDe(p))}</h3>
      <p class="muted sm-text">¿Con qué frecuencia mostró esta conducta durante la actividad?</p>
      <form id="f-eval">
        <label>Actividad<input name="actividad" required placeholder="Ej.: Actividad 3 · Dinámica de grupo"></label>
        ${crit.map(c => `
          <fieldset class="crit">
            <legend>${esc(c.nombre)}</legend>
            <div class="muted sm-text">${esc(c.descripcion || '')}</div>
            <div class="pills">${[0, 1, 2, 3, 4].map(n => `<label class="pill"><input type="radio" name="c${c.id}" value="${n}" required><span>${n}</span></label>`).join('')}</div>
          </fieldset>`).join('')}
        <p class="muted sm-text">${ESCALA.map((t, i) => `${i} = ${t}`).join(' · ')}</p>
        <p id="f-err" class="error"></p>
        <div class="row end"><button type="button" class="ghost" data-close>Cancelar</button><button class="primary" type="submit">Guardar evaluación</button></div>
      </form>`);
    $('#f-eval').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const puntajes = {};
      crit.forEach(c => { puntajes[c.id] = Number(f.get('c' + c.id)); });
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await Api.guardarEvaluacion(id, f.get('actividad'), puntajes);
        close();
        toast('Evaluación guardada', 'ok');
      } catch (err) { $('#f-err').textContent = err.message; btn.disabled = false; }
    };
  }

  /* ===================== Ranking ===================== */
  views.ranking = async el => {
    const rows = await Api.ranking();
    const evald = rows.filter(r => r.promedio !== null && r.promedio !== undefined);
    const sin = rows.filter(r => r.promedio === null || r.promedio === undefined);
    let pos = 0, prev = null, i = 0;
    evald.forEach(r => { i++; if (num(r.promedio) !== prev) { pos = i; prev = num(r.promedio); } r.pos = pos; });

    const fila = r => {
      const v = num(r.promedio);
      const yo = r.id === state.user.id;
      return `<div class="rank ${r.pos ? 'top' + (r.pos <= 3 ? r.pos : '') : ''} ${yo ? 'yo' : ''}">
        <div class="pos">${r.pos || '–'}</div>
        <div class="body">
          <div class="name"><span>${esc(nombreDe(r))}${yo ? ' <span class="muted sm-text">(tú)</span>' : ''}</span><span>${fmt(v)}</span></div>
          <div class="bar"><i style="width:${v === null ? 0 : (v / 4) * 100}%"></i></div>
          <span class="muted sm-text">${r.evaluaciones} evaluación(es) · ${r.asistencias} asistencia(s)</span>
        </div>
      </div>`;
    };

    el.innerHTML = `
      <section class="card">
        <h2>Tabla de líderes</h2>
        <p class="muted">Promedio (0–4) de las conductas de influencia idealizada (atributos) mostradas en las actividades.</p>
      </section>
      ${evald.map(fila).join('')}
      ${sin.length ? `<h4 class="muted">Sin evaluar todavía</h4>${sin.map(fila).join('')}` : ''}
      ${!rows.length ? '<p class="muted center">Aún no hay participantes.</p>' : ''}`;
  };

  /* ===================== Mi cuenta / Mi ficha ===================== */
  views.cuenta = async el => {
    const me = await Api.yo();
    state.user = me;
    $('#user-name').textContent = nombreDe(me);
    let bloque = '';
    if (me.rol === 'user') {
      const perfil = await Api.perfil(me.id);
      const img = me.qr_imagen || await makeQR(me.qr_codigo);
      bloque = `
        <section class="card">
          <div class="ficha">
            <div class="qr-box">
              <img src="${img}" alt="Tu código QR">
              <p><button class="ghost sm" id="dl-qr">Descargar mi QR</button></p>
              <p class="muted sm-text">Muéstralo al admin para registrar tu asistencia.</p>
            </div>
            <div>
              <h2>${esc(nombreDe(me))}</h2>
              <p class="muted">@${esc(me.nombre)}</p>
              ${perfilHTML(perfil, false)}
            </div>
          </div>
        </section>`;
    } else {
      bloque = `<section class="card"><h2>${esc(nombreDe(me))}</h2><p class="muted">@${esc(me.nombre)} · ${ROL[me.rol]}</p></section>`;
    }
    el.innerHTML = `${bloque}
      <section class="card">
        <h3>Cambiar contraseña</h3>
        <form id="f-pass">
          <label>Contraseña actual<input type="password" name="actual" autocomplete="current-password" required></label>
          <div class="grid2">
            <label>Nueva contraseña<input type="password" name="nueva" autocomplete="new-password" minlength="4" required></label>
            <label>Repetir nueva<input type="password" name="rep" autocomplete="new-password" minlength="4" required></label>
          </div>
          <p id="f-err" class="error"></p>
          <button class="primary" type="submit">Actualizar contraseña</button>
        </form>
      </section>`;
    const dl = $('#dl-qr');
    if (dl) dl.onclick = () => download(`qr-${slug(me.nombre)}.png`, me.qr_imagen || '');
    if (dl && !me.qr_imagen) dl.onclick = async () => download(`qr-${slug(me.nombre)}.png`, await makeQR(me.qr_codigo));
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
      await Scanner.stop();
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
