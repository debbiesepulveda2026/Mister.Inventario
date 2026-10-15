# MEMORIA · Mister Inventario

Última actualización: 2026-10-15

## Contexto clave

- POS e inventario para almacenes en Chile. Usa React + Vite + Supabase (proyecto `fmcdqarhrjvdbkakacxj`).
- La administradora de la plataforma es `debbie.sepulveda2026@soymas.cl` y aprueba cada almacén nuevo.
- Hay dos páginas en el mismo proyecto: `index.html` (dueño) y `ventas.html` (cajeras).

## Avances (2026-10-15)

- La venta se separó en `ventas.html` y la cajera ya no ve el panel del dueño.
- Las cajas se vinculan como usuario anónimo de Supabase con rol `cashier`, usando un código de 8 caracteres o la clave del dueño (que no queda guardada).
- Los turnos se abren con nombre y PIN, verificado en el servidor con bcrypt y bloqueo tras 5 intentos.
- La cajera puede vender a fiado, crear clientes de fiado (con el límite por defecto del almacén), crear y editar productos y usar la calculadora de margen.
- El dueño puede recuperar su clave por correo desde "¿Olvidaste tu clave?".
- Se agregó un Centro de cajas con las cajas vinculadas (y opción de desvincular) y los arqueos de los últimos 30 turnos.
- Se corrigieron varios errores:
  - La lista de personal nunca cargaba, porque pedía `pin_hash` y esa columna no tenía permiso.
  - La app mostraba el hash del PIN y lo dejaba en la consola.
  - Había errores de TypeScript por la pantalla "accounting" y por campos inexistentes en clientes.
  - El bloque de Proveedores se dibujaba dos veces.
  - `order_whatsapp` no se cargaba.
  - En `tenant_migration.sql` las políticas de storage iban antes de las funciones que usan, así que fallaba en un proyecto nuevo.
- El código se probó así:
  - El SQL se ejecutó en un Postgres local que imita a Supabase: aprobación, PIN, vínculo de caja, permisos de la cajera, fiado sobre el límite y desvinculación.
  - Ambas páginas se probaron en el navegador con datos simulados.
  - `tsc` y `vite build` pasan sin errores.

## Decisiones y por qué

- **Cajera con nombre + PIN** (no con correo propio): es lo más práctico en un almacén. El equipo queda vinculado una vez y las cajeras rotan.
- **Sesión de la caja separada** (`storageKey: mister-ventas-auth`): así la sesión del dueño nunca queda abierta en el equipo de venta.
- **La cajera ve todos los costos y márgenes**: lo pidió Debbie.
- **El límite de fiado de los clientes que crea la cajera lo fija el dueño** (`companies.default_credit_limit`, por defecto 30.000), para que la cajera no se autoasigne crédito.
- **La cajera no elimina productos ni registra abonos**: eso queda para el dueño.

## Pendiente / próximos pasos

1. En Supabase:
   - Ejecutar `supabase/ventas_migration.sql`.
   - Activar *Allow anonymous sign-ins*.
   - Configurar *Site URL* y *Redirect URLs*.
2. Reasignar los PIN de todo el personal, porque los antiguos se invalidan con la migración.
3. Ejecutar `npm run build` y publicar `dist/`. La carpeta `dist/` del equipo todavía tiene la versión anterior.
4. Configurar los secretos de Resend si se quiere el aviso por correo de nuevas solicitudes.
5. Por decidir:
   - Si la cajera debe poder registrar abonos de fiado. Afecta el arqueo de efectivo.
   - Si el cálculo del efectivo esperado debe separar por caja cuando haya más de una. Hoy suma todas las ventas en efectivo del almacén desde la apertura.

## Problemas abiertos

- La emisión de boleta electrónica (DTE/SII) no está implementada. El comprobante es interno.
- Con más de una caja abierta al mismo tiempo, el efectivo esperado se mezcla entre cajas.
