// Envoltorio sobre html5-qrcode: abre la cámara y entrega el texto de cada QR leído.
window.Scanner = (function () {
  'use strict';
  const S = { qr: null, active: false };

  S.start = async function (elId, onCode, facing = 'environment') {
    if (S.active) await S.stop();
    S.qr = new Html5Qrcode(elId, { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
    await S.qr.start(
      { facingMode: facing },
      {
        fps: 10,
        aspectRatio: 1,
        qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.7); return { width: s, height: s }; }
      },
      text => onCode(text),
      () => { /* frames sin QR: se ignoran */ }
    );
    S.active = true;
  };

  S.stop = async function () {
    const q = S.qr;
    S.active = false;
    S.qr = null;
    if (!q) return;
    try { await q.stop(); } catch (_) { }
    try { q.clear(); } catch (_) { }
  };

  S.explain = function (e) {
    const m = String((e && (e.message || e.name)) || e);
    if (!window.isSecureContext) return 'La cámara solo funciona en HTTPS (o en localhost). Abre la página desde una dirección segura.';
    if (/Permission|NotAllowed|denied/i.test(m)) return 'Permiso de cámara denegado. Actívalo en los ajustes del navegador y vuelve a intentar.';
    if (/NotFound|no camera|Requested device not found/i.test(m)) return 'No se encontró ninguna cámara en este dispositivo.';
    if (/NotReadable|in use/i.test(m)) return 'La cámara está siendo usada por otra aplicación.';
    return 'No se pudo iniciar la cámara: ' + m;
  };

  return S;
})();
