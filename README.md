# Asistencia por QR + Ranking de Liderazgo

Página web (HTML + CSS + JS puro) con base de datos en Supabase.

## Puesta en marcha

1. **Supabase**: crea un proyecto en supabase.com. Ve a *SQL Editor*, pega todo `supabase/schema.sql` y ejecuta.
2. **Claves**: en *Project Settings > API* copia la *Project URL* y la *anon public key* y pégalas en `js/config.js`.
3. **Publicar**: la cámara solo funciona en **HTTPS** o en `localhost`.
   - Local: dentro de la carpeta, `python3 -m http.server 8000` y abre `http://localhost:8000`.
   - En línea: sube la carpeta a Netlify, Vercel o GitHub Pages (todos dan HTTPS).
4. **Primer ingreso**: usuario `sudo`, contraseña `CAMBIAME-123`. Cámbiala de inmediato en *Mi cuenta*.

## Roles

| Rol | Puede |
|---|---|
| **sudo** | Crear y eliminar admins y participantes, restablecer contraseñas, y todo lo del admin |
| **admin** | Escanear QR, ver asistencia del día, editar fichas de participantes, evaluar |
| **user** | Ver el ranking, su ficha, su QR y su perfil de liderazgo |

## Cómo funciona

- **Login**: solo nombre y contraseña (sin correo). Contraseñas con bcrypt; 5 fallos = bloqueo de 5 minutos.
- **QR**: al crear un participante, el servidor genera un código único; el navegador dibuja el QR y lo guarda en su ficha (`usuarios.qr_imagen`). Se puede descargar desde la ficha.
- **Asistencia**: restricción `unique (usuario_id, fecha)`, así que solo se registra una vez por día (día calculado en hora de Bolivia). Si el escaneo falla, hay un botón «Marcar hoy» en *Personas*.
- **Ranking**: el admin evalúa a cada participante por actividad con una escala 0–4; el ranking ordena por promedio.
- **Seguridad**: las tablas tienen RLS sin políticas, así que la clave pública no puede leerlas directamente. Todo pasa por funciones (`security definer`) que validan el token de sesión y el rol en cada llamada.

## Criterios del ranking (revisar antes de entregar)

Los 4 criterios iniciales siguen las conductas de *influencia idealizada (atributos)* del MLQ de Bass y Avolio, con escala de frecuencia 0–4. Están redactados de memoria: **verifica la redacción exacta contra la fuente indexada que cites** y corrígela en la tabla `criterios` si hace falta (Table Editor > criterios).

## Estructura

```
index.html
css/styles.css
js/config.js    claves de Supabase
js/api.js       llamadas al servidor
js/ui.js        utilidades de interfaz
js/scanner.js   cámara y lectura de QR
js/app.js       vistas y lógica por rol
supabase/schema.sql
```
