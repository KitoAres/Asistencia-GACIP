window.Api = (function () {
  'use strict';
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const KEY = 'liderazgo.token';

  const ERR = {
    CREDENCIALES: 'Nombre o contraseña incorrectos.',
    BLOQUEADO: 'Demasiados intentos fallidos. Espera 5 minutos.',
    SESION_INVALIDA: 'Tu sesión expiró. Ingresa de nuevo.',
    SIN_PERMISO: 'No tienes permiso para hacer eso.',
    NO_ENCONTRADO: 'No se encontró el registro.',
    NOMBRE_EXISTE: 'Ya existe una persona con ese nombre.',
    NOMBRE_INVALIDO: 'El nombre es demasiado corto.',
    PASSWORD_CORTA: 'La contraseña debe tener al menos 4 caracteres.',
    PASSWORD_ACTUAL: 'La contraseña actual no es correcta.',
    ROL_INVALIDO: 'Rol no válido.',
    NO_AUTOELIMINAR: 'No puedes eliminar tu propia cuenta.',
    ACTIVIDAD_VACIA: 'Escribe el nombre de la actividad.',
    EVAL_VACIA: 'Marca un puntaje en cada criterio.',
    QR_INVALIDO: 'La imagen del QR no es válida.'
  };

  const A = {
    token: null,
    onExpire: null,
    init() { try { this.token = localStorage.getItem(KEY); } catch (_) { this.token = null; } },
    setToken(t) { this.token = t; try { localStorage.setItem(KEY, t); } catch (_) { } },
    clear() { this.token = null; try { localStorage.removeItem(KEY); } catch (_) { } }
  };

  async function rpc(fn, args = {}, auth = true) {
    const params = auth ? { p_token: A.token, ...args } : args;
    const { data, error } = await sb.rpc(fn, params);
    if (error) {
      const msg = error.message || '';
      const code = Object.keys(ERR).find(k => msg.includes(k));
      if (code === 'SESION_INVALIDA' && A.onExpire) A.onExpire();
      throw new Error(ERR[code] || 'Error de conexión. Intenta de nuevo.');
    }
    return data;
  }

  Object.assign(A, {
    async login(nombre, password) {
      const r = await rpc('login', { p_nombre: nombre, p_password: password }, false);
      if (!r || !r.ok) throw new Error(ERR[r && r.error] || ERR.CREDENCIALES);
      this.setToken(r.token);
      return r;
    },
    async logout() { try { await rpc('logout'); } catch (_) { } this.clear(); },
    yo: () => rpc('yo'),
    cambiarMiPassword: (actual, nueva) => rpc('cambiar_mi_password', { p_actual: actual, p_nueva: nueva }),

    listarUsuarios: () => rpc('listar_usuarios'),
    verUsuario: id => rpc('ver_usuario', { p_id: id }),
    crearUsuario: ({ nombre, password, rol, ficha }) => rpc('crear_usuario', { p_nombre: nombre, p_password: password, p_rol: rol, p_ficha: ficha || {} }),
    guardarQr: (id, imagen) => rpc('guardar_qr', { p_id: id, p_imagen: imagen }),
    eliminarUsuario: id => rpc('eliminar_usuario', { p_id: id }),
    actualizarFicha: (id, ficha) => rpc('actualizar_ficha', { p_id: id, p_ficha: ficha }),
    cambiarPassword: (id, nueva) => rpc('cambiar_password', { p_id: id, p_nueva: nueva }),

    registrar: qr => rpc('registrar_asistencia', { p_qr: qr }),
    hoy: () => rpc('asistencias_hoy'),

    criterios: () => rpc('listar_criterios'),
    guardarEvaluacion: (id, actividad, puntajes) => rpc('guardar_evaluacion', { p_id: id, p_actividad: actividad, p_puntajes: puntajes }),
    eliminarEvaluacion: id => rpc('eliminar_evaluacion', { p_id: id }),
    ranking: () => rpc('ranking'),
    perfil: id => rpc('perfil_liderazgo', { p_id: id })
  });

  return A;
})();
