-- =====================================================================
--  Asistencia por QR + Ranking de Liderazgo Transformacional
--  (Influencia idealizada · atributos)
--
--  Cómo usar: Supabase > SQL Editor > New query > pegar TODO > Run.
--  Es re-ejecutable (usa "if not exists" / "create or replace").
--
--  Modelo de seguridad:
--   * Ninguna tabla es accesible directamente con la clave pública (anon).
--     RLS está activo y sin políticas => acceso directo denegado.
--   * Todo pasa por funciones RPC (security definer) que validan un token
--     de sesión y el rol (sudo / admin / user) en cada llamada.
--   * Las contraseñas se guardan con bcrypt (pgcrypto), nunca en claro.
--   * Login solo con nombre + contraseña (sin correo). 5 fallos = bloqueo 5 min.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- TABLAS
-- ---------------------------------------------------------------------
create table if not exists public.usuarios (
  id               uuid primary key default gen_random_uuid(),
  nombre           text not null,                       -- nombre de usuario para ingresar
  password_hash    text not null,
  rol              text not null check (rol in ('sudo','admin','user')),
  qr_codigo        text not null unique default replace(gen_random_uuid()::text, '-', ''),
  qr_imagen        text,                                -- PNG en data URL, guardado en la ficha
  nombre_completo  text,
  carrera          text,
  semestre         text,
  telefono         text,
  observaciones    text,
  intentos_fallidos int not null default 0,
  bloqueado_hasta  timestamptz,
  creado_en        timestamptz not null default now()
);
create unique index if not exists usuarios_nombre_uq on public.usuarios (lower(nombre));

create table if not exists public.sesiones (
  token      uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  expira_en  timestamptz not null default (now() + interval '7 days')
);

create table if not exists public.asistencias (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null references public.usuarios(id) on delete cascade,
  fecha          date not null,                          -- día en hora de Bolivia
  hora           timestamptz not null default now(),
  registrado_por uuid references public.usuarios(id) on delete set null,
  unique (usuario_id, fecha)                             -- 1 vez por día
);

create table if not exists public.criterios (
  id          serial primary key,
  nombre      text not null,
  descripcion text,
  orden       int not null default 0,
  activo      boolean not null default true
);

create table if not exists public.evaluaciones (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references public.usuarios(id) on delete cascade,
  evaluador_id uuid references public.usuarios(id) on delete set null,
  actividad    text not null,
  creado_en    timestamptz not null default now()
);

create table if not exists public.puntajes (
  evaluacion_id uuid not null references public.evaluaciones(id) on delete cascade,
  criterio_id   int  not null references public.criterios(id) on delete cascade,
  valor         smallint not null check (valor between 0 and 4),
  primary key (evaluacion_id, criterio_id)
);

alter table public.usuarios     enable row level security;
alter table public.sesiones     enable row level security;
alter table public.asistencias  enable row level security;
alter table public.criterios    enable row level security;
alter table public.evaluaciones enable row level security;
alter table public.puntajes     enable row level security;

-- ---------------------------------------------------------------------
-- DATOS INICIALES
-- ---------------------------------------------------------------------
-- Criterios: las 4 conductas de Influencia idealizada (atributos) del MLQ
-- de Bass y Avolio, con escala 0-4. Verifica la redacción exacta contra la
-- fuente que cites en tu trabajo y ajústala aquí si hace falta.
insert into public.criterios (nombre, descripcion, orden)
select * from (values
  ('Orgullo por la asociación', 'Inspira orgullo en los demás por estar asociados con él/ella', 1),
  ('Más allá del interés propio', 'Va más allá de su interés personal por el bien del grupo', 2),
  ('Respeto', 'Actúa de modo que se gana el respeto de los demás', 3),
  ('Poder y confianza', 'Demuestra sentido de poder y confianza', 4)
) v(nombre, descripcion, orden)
where not exists (select 1 from public.criterios);

-- Sudo inicial. CAMBIA LA CONTRASEÑA al primer ingreso (Mi cuenta).
insert into public.usuarios (nombre, password_hash, rol, nombre_completo)
select 'sudo', extensions.crypt('CAMBIAME-123', extensions.gen_salt('bf')), 'sudo', 'Super Administrador'
where not exists (select 1 from public.usuarios where rol = 'sudo');

-- ---------------------------------------------------------------------
-- FUNCIONES INTERNAS (no expuestas)
-- ---------------------------------------------------------------------
create or replace function public._auth(p_token uuid, p_roles text[] default null)
returns public.usuarios
language plpgsql security definer set search_path = public, extensions as $$
declare u public.usuarios;
begin
  select us.* into u
    from public.sesiones s join public.usuarios us on us.id = s.usuario_id
   where s.token = p_token and s.expira_en > now();
  if not found then raise exception 'SESION_INVALIDA'; end if;
  if p_roles is not null and not (u.rol = any (p_roles)) then raise exception 'SIN_PERMISO'; end if;
  return u;
end $$;

create or replace function public._ficha_json(u public.usuarios, p_con_qr boolean)
returns jsonb language sql immutable as $$
  select case when p_con_qr
    then to_jsonb(u) - 'password_hash' - 'intentos_fallidos' - 'bloqueado_hasta'
    else to_jsonb(u) - 'password_hash' - 'intentos_fallidos' - 'bloqueado_hasta' - 'qr_imagen'
  end
$$;

-- sudo: todo | admin: solo participantes | cualquiera: su propia ficha
create or replace function public._check_objetivo(me public.usuarios, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare t public.usuarios;
begin
  select * into t from public.usuarios where id = p_id;
  if not found then raise exception 'NO_ENCONTRADO'; end if;
  if me.rol = 'sudo' then return; end if;
  if me.rol = 'admin' and t.rol = 'user' then return; end if;
  if me.id = p_id then return; end if;
  raise exception 'SIN_PERMISO';
end $$;

-- ---------------------------------------------------------------------
-- SESIÓN
-- ---------------------------------------------------------------------
-- No lanza excepción en fallo (para que el contador de intentos se guarde).
create or replace function public.login(p_nombre text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.usuarios; t uuid;
begin
  select * into u from public.usuarios where lower(nombre) = lower(trim(p_nombre));
  if not found then return jsonb_build_object('ok', false, 'error', 'CREDENCIALES'); end if;

  if u.bloqueado_hasta is not null and u.bloqueado_hasta > now() then
    return jsonb_build_object('ok', false, 'error', 'BLOQUEADO');
  end if;

  if u.password_hash <> extensions.crypt(p_password, u.password_hash) then
    update public.usuarios set
      intentos_fallidos = case when intentos_fallidos + 1 >= 5 then 0 else intentos_fallidos + 1 end,
      bloqueado_hasta   = case when intentos_fallidos + 1 >= 5 then now() + interval '5 minutes' else bloqueado_hasta end
    where id = u.id;
    return jsonb_build_object('ok', false, 'error', 'CREDENCIALES');
  end if;

  update public.usuarios set intentos_fallidos = 0, bloqueado_hasta = null where id = u.id;
  delete from public.sesiones where expira_en < now();
  insert into public.sesiones (usuario_id) values (u.id) returning token into t;

  return jsonb_build_object('ok', true, 'token', t);
end $$;

create or replace function public.logout(p_token uuid)
returns void language sql security definer set search_path = public, extensions as $$
  delete from public.sesiones where token = p_token;
$$;

create or replace function public.yo(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.usuarios;
begin
  v_me := public._auth(p_token);
  return public._ficha_json(v_me, true);
end $$;

create or replace function public.cambiar_mi_password(p_token uuid, p_actual text, p_nueva text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.usuarios;
begin
  v_me := public._auth(p_token);
  if v_me.password_hash <> extensions.crypt(p_actual, v_me.password_hash) then raise exception 'PASSWORD_ACTUAL'; end if;
  if length(coalesce(p_nueva, '')) < 4 then raise exception 'PASSWORD_CORTA'; end if;
  update public.usuarios set password_hash = extensions.crypt(p_nueva, extensions.gen_salt('bf')) where id = v_me.id;
end $$;

-- ---------------------------------------------------------------------
-- GESTIÓN DE PERSONAS
-- ---------------------------------------------------------------------
create or replace function public.listar_usuarios(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.usuarios;
begin
  v_me := public._auth(p_token, array['sudo','admin']);
  return (
    select coalesce(jsonb_agg(public._ficha_json(u, false) order by lower(u.nombre)), '[]'::jsonb)
      from public.usuarios u
     where u.rol <> 'sudo' and (v_me.rol = 'sudo' or u.rol = 'user')
  );
end $$;

create or replace function public.ver_usuario(p_token uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.usuarios; t public.usuarios;
begin
  v_me := public._auth(p_token);
  perform public._check_objetivo(v_me, p_id);
  select * into t from public.usuarios where id = p_id;
  return public._ficha_json(t, true);
end $$;

-- Solo SUDO. Devuelve la ficha con su qr_codigo (generado aquí en el servidor).
create or replace function public.crear_usuario(
  p_token uuid, p_nombre text, p_password text, p_rol text, p_ficha jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.usuarios; nuevo public.usuarios;
begin
  v_me := public._auth(p_token, array['sudo']);
  if p_rol not in ('admin','user') then raise exception 'ROL_INVALIDO'; end if;
  if length(trim(coalesce(p_nombre, ''))) < 2 then raise exception 'NOMBRE_INVALIDO'; end if;
  if length(coalesce(p_password, '')) < 4 then raise exception 'PASSWORD_CORTA'; end if;

  insert into public.usuarios (nombre, password_hash, rol, nombre_completo, carrera, semestre, telefono, observaciones)
  values (
    trim(p_nombre), extensions.crypt(p_password, extensions.gen_salt('bf')), p_rol,
    nullif(trim(p_ficha->>'nombre_completo'), ''), nullif(trim(p_ficha->>'carrera'), ''),
    nullif(trim(p_ficha->>'semestre'), ''), nullif(trim(p_ficha->>'telefono'), ''),
    nullif(trim(p_ficha->>'observaciones'), '')
  ) returning * into nuevo;

  return public._ficha_json(nuevo, false);
exception when unique_violation then
  raise exception 'NOMBRE_EXISTE';
end $$;

-- Guarda en la ficha la imagen del QR (la genera el navegador al crear el usuario).
create or replace function public.guardar_qr(p_token uuid, p_id uuid, p_imagen text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.usuarios;
begin
  v_me := public._auth(p_token, array['sudo']);
  if p_imagen is null or length(p_imagen) > 300000 or p_imagen not like 'data:image/%' then raise exception 'QR_INVALIDO'; end if;
  update public.usuarios set qr_imagen = p_imagen where id = p_id;
end $$;

create or replace function public.eliminar_usuario(p_token uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.usuarios; t public.usuarios;
begin
  v_me := public._auth(p_token, array['sudo']);
  if p_id = v_me.id then raise exception 'NO_AUTOELIMINAR'; end if;
  select * into t from public.usuarios where id = p_id;
  if not found then raise exception 'NO_ENCONTRADO'; end if;
  if t.rol = 'sudo' then raise exception 'SIN_PERMISO'; end if;
  delete from public.usuarios where id = p_id;
end $$;

-- sudo y admin. El admin solo puede editar fichas de participantes.
create or replace function public.actualizar_ficha(p_token uuid, p_id uuid, p_ficha jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.usuarios; t public.usuarios;
begin
  v_me := public._auth(p_token, array['sudo','admin']);
  select * into t from public.usuarios where id = p_id;
  if not found then raise exception 'NO_ENCONTRADO'; end if;
  if v_me.rol = 'admin' and t.rol <> 'user' then raise exception 'SIN_PERMISO'; end if;

  update public.usuarios set
    nombre_completo = case when p_ficha ? 'nombre_completo' then nullif(trim(p_ficha->>'nombre_completo'), '') else nombre_completo end,
    carrera         = case when p_ficha ? 'carrera'         then nullif(trim(p_ficha->>'carrera'), '')         else carrera end,
    semestre        = case when p_ficha ? 'semestre'        then nullif(trim(p_ficha->>'semestre'), '')        else semestre end,
    telefono        = case when p_ficha ? 'telefono'        then nullif(trim(p_ficha->>'telefono'), '')        else telefono end,
    observaciones   = case when p_ficha ? 'observaciones'   then nullif(trim(p_ficha->>'observaciones'), '')   else observaciones end
  where id = p_id returning * into t;

  return public._ficha_json(t, false);
end $$;

create or replace function public.cambiar_password(p_token uuid, p_id uuid, p_nueva text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.usuarios;
begin
  v_me := public._auth(p_token, array['sudo']);
  if length(coalesce(p_nueva, '')) < 4 then raise exception 'PASSWORD_CORTA'; end if;
  update public.usuarios set password_hash = extensions.crypt(p_nueva, extensions.gen_salt('bf')),
         intentos_fallidos = 0, bloqueado_hasta = null where id = p_id;
  delete from public.sesiones where usuario_id = p_id and p_id <> v_me.id;
end $$;

-- ---------------------------------------------------------------------
-- ASISTENCIA (una vez por día, día calculado en hora de Bolivia)
-- ---------------------------------------------------------------------
create or replace function public.registrar_asistencia(p_token uuid, p_qr text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_me public.usuarios; v_u public.usuarios; v_id uuid;
  v_hoy date := (now() at time zone 'America/La_Paz')::date;
  v_hora timestamptz;
begin
  v_me := public._auth(p_token, array['sudo','admin']);
  select * into v_u from public.usuarios where qr_codigo = trim(coalesce(p_qr, ''));
  if not found then return jsonb_build_object('estado', 'qr_invalido'); end if;

  insert into public.asistencias (usuario_id, fecha, registrado_por)
  values (v_u.id, v_hoy, v_me.id)
  on conflict (usuario_id, fecha) do nothing
  returning id, hora into v_id, v_hora;

  if v_id is null then
    select hora into v_hora from public.asistencias where usuario_id = v_u.id and fecha = v_hoy;
    return jsonb_build_object('estado', 'ya_registrado', 'nombre', v_u.nombre,
                              'nombre_completo', v_u.nombre_completo, 'hora', v_hora);
  end if;

  return jsonb_build_object('estado', 'ok', 'nombre', v_u.nombre,
                            'nombre_completo', v_u.nombre_completo, 'hora', v_hora);
end $$;

create or replace function public.asistencias_hoy(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.usuarios; v_hoy date := (now() at time zone 'America/La_Paz')::date;
begin
  v_me := public._auth(p_token, array['sudo','admin']);
  return jsonb_build_object(
    'fecha', v_hoy,
    'presentes', (
      select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre,
               'nombre_completo', u.nombre_completo, 'hora', a.hora) order by a.hora), '[]'::jsonb)
        from public.asistencias a join public.usuarios u on u.id = a.usuario_id
       where a.fecha = v_hoy),
    'ausentes', (
      select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre,
               'nombre_completo', u.nombre_completo) order by lower(u.nombre)), '[]'::jsonb)
        from public.usuarios u
       where u.rol = 'user'
         and not exists (select 1 from public.asistencias a where a.usuario_id = u.id and a.fecha = v_hoy))
  );
end $$;

-- ---------------------------------------------------------------------
-- EVALUACIÓN Y RANKING
-- ---------------------------------------------------------------------
create or replace function public.listar_criterios(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.usuarios;
begin
  v_me := public._auth(p_token);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'descripcion', descripcion) order by orden, id), '[]'::jsonb)
            from public.criterios where activo);
end $$;

-- p_puntajes: {"<criterio_id>": 0..4, ...}
create or replace function public.guardar_evaluacion(p_token uuid, p_id uuid, p_actividad text, p_puntajes jsonb)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.usuarios; v_ev uuid; k text; v text;
begin
  v_me := public._auth(p_token, array['sudo','admin']);
  if length(trim(coalesce(p_actividad, ''))) < 2 then raise exception 'ACTIVIDAD_VACIA'; end if;
  if p_puntajes is null or jsonb_typeof(p_puntajes) <> 'object' or p_puntajes = '{}'::jsonb then raise exception 'EVAL_VACIA'; end if;
  if not exists (select 1 from public.usuarios where id = p_id and rol = 'user') then raise exception 'NO_ENCONTRADO'; end if;

  insert into public.evaluaciones (usuario_id, evaluador_id, actividad)
  values (p_id, v_me.id, trim(p_actividad)) returning id into v_ev;

  for k, v in select key, value from jsonb_each_text(p_puntajes) loop
    insert into public.puntajes (evaluacion_id, criterio_id, valor) values (v_ev, k::int, v::smallint);
  end loop;
  return v_ev;
end $$;

create or replace function public.eliminar_evaluacion(p_token uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.usuarios;
begin
  v_me := public._auth(p_token, array['sudo','admin']);
  delete from public.evaluaciones where id = p_id;
end $$;

-- Visible para todos los roles. Solo participantes (rol user).
create or replace function public.ranking(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.usuarios;
begin
  v_me := public._auth(p_token);
  return (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.promedio desc nulls last, lower(r.nombre)), '[]'::jsonb)
      from (
        select u.id, u.nombre, u.nombre_completo,
               (select round(avg(p.valor)::numeric, 2)
                  from public.evaluaciones e join public.puntajes p on p.evaluacion_id = e.id
                 where e.usuario_id = u.id) as promedio,
               (select count(*) from public.evaluaciones e where e.usuario_id = u.id) as evaluaciones,
               (select count(*) from public.asistencias a where a.usuario_id = u.id) as asistencias
          from public.usuarios u where u.rol = 'user'
      ) r
  );
end $$;

create or replace function public.perfil_liderazgo(p_token uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.usuarios;
begin
  v_me := public._auth(p_token);
  perform public._check_objetivo(v_me, p_id);
  return jsonb_build_object(
    'criterios', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre,
               'promedio', (select round(avg(p.valor)::numeric, 2)
                              from public.puntajes p join public.evaluaciones e on e.id = p.evaluacion_id
                             where e.usuario_id = p_id and p.criterio_id = c.id)) order by c.orden, c.id), '[]'::jsonb)
        from public.criterios c where c.activo),
    'evaluaciones', (
      select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'actividad', e.actividad, 'creado_en', e.creado_en,
               'promedio', (select round(avg(p.valor)::numeric, 2) from public.puntajes p where p.evaluacion_id = e.id))
               order by e.creado_en desc), '[]'::jsonb)
        from public.evaluaciones e where e.usuario_id = p_id),
    'asistencias', (
      select coalesce(jsonb_agg(a.fecha order by a.fecha desc), '[]'::jsonb)
        from public.asistencias a where a.usuario_id = p_id)
  );
end $$;

-- ---------------------------------------------------------------------
-- PERMISOS: la clave pública solo puede llamar a las funciones de la app
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.login(text, text),
  public.logout(uuid),
  public.yo(uuid),
  public.cambiar_mi_password(uuid, text, text),
  public.listar_usuarios(uuid),
  public.ver_usuario(uuid, uuid),
  public.crear_usuario(uuid, text, text, text, jsonb),
  public.guardar_qr(uuid, uuid, text),
  public.eliminar_usuario(uuid, uuid),
  public.actualizar_ficha(uuid, uuid, jsonb),
  public.cambiar_password(uuid, uuid, text),
  public.registrar_asistencia(uuid, text),
  public.asistencias_hoy(uuid),
  public.listar_criterios(uuid),
  public.guardar_evaluacion(uuid, uuid, text, jsonb),
  public.eliminar_evaluacion(uuid, uuid),
  public.ranking(uuid),
  public.perfil_liderazgo(uuid, uuid)
to anon, authenticated;
