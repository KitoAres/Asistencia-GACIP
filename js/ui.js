window.UI = (function () {
  'use strict';
  const TZ = (window.APP_CONFIG && window.APP_CONFIG.ZONA_HORARIA) || 'America/La_Paz';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let tt;
  function toast(msg, type = 'info') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'show ' + type;
    clearTimeout(tt);
    tt = setTimeout(() => { t.className = ''; }, 3200);
  }

  const dlg = () => $('#modal');
  function modal(html) {
    const body = $('#modal-body');
    body.onclick = null;
    body.innerHTML = html;
    const d = dlg();
    if (!d.open) d.showModal();
    return $('#modal-body');
  }
  function close() { const d = dlg(); if (d.open) d.close(); }

  function confirm(msg, okText = 'Confirmar') {
    return new Promise(res => {
      const b = modal(`<h3>${esc(msg)}</h3>
        <div class="row end"><button class="ghost" data-r="0">Cancelar</button><button class="danger" data-r="1">${esc(okText)}</button></div>`);
      b.onclick = e => {
        const r = e.target.closest('[data-r]');
        if (!r) return;
        res(r.dataset.r === '1');
        close();
      };
      dlg().addEventListener('close', () => res(false), { once: true });
    });
  }

  const hora = ts => new Date(ts).toLocaleTimeString('es-BO', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const fechaHora = ts => new Date(ts).toLocaleDateString('es-BO', { timeZone: TZ, day: '2-digit', month: 'short' });
  // 'YYYY-MM-DD' -> '05 oct' sin desfase de zona horaria
  function fechaCorta(d) {
    const [y, m, dd] = String(d).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('es-BO', { timeZone: 'UTC', day: '2-digit', month: 'short' });
  }
  function fechaLarga(d) {
    const [y, m, dd] = String(d).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('es-BO', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
  }

  function download(name, href) {
    const a = document.createElement('a');
    a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function downloadText(name, text, mime = 'text/csv;charset=utf-8') {
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: mime }));
    download(name, url);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const slug = s => String(s || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

  // Pitido corto como confirmación del escaneo
  let ac;
  function beep(ok = true) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = ok ? 880 : 300; o.type = 'sine';
      g.gain.value = 0.08;
      o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + (ok ? 0.12 : 0.28));
    } catch (_) { /* sin audio */ }
    if (navigator.vibrate) navigator.vibrate(ok ? 60 : [80, 60, 80]);
  }

  return { $, $$, esc, toast, modal, close, confirm, hora, fechaHora, fechaCorta, fechaLarga, download, downloadText, slug, beep, TZ };
})();
