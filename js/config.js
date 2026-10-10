// Pega aquí los datos de tu proyecto: Supabase > Project Settings > API
// La "anon key" es pública por diseño: las tablas están bloqueadas con RLS
// y todo pasa por funciones que validan sesión y rol (ver supabase/schema.sql).
window.APP_CONFIG = {
  SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
  SUPABASE_ANON_KEY: 'TU_ANON_KEY',
  ZONA_HORARIA: 'America/La_Paz'
};
