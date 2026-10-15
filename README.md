# Mister Inventario

Sistema de punto de venta (POS) e inventario para almacenes. Usa React, TypeScript, Vite, Tailwind CSS y Supabase.

Tiene **dos páginas** que trabajan sobre el mismo proyecto de Supabase:

| Página | Para quién | Qué hace |
|---|---|---|
| `index.html` | Dueño del almacén (y la administradora) | Login con correo y clave, recuperación de clave, inscripción del almacén, panel, productos, fiados, personal, proveedores, cajas, contabilidad y datos de la empresa. |
| `ventas.html` | Cajeras | Vender (efectivo, tarjeta y fiado), crear productos con calculadora de margen, crear clientes de fiado, y abrir y cerrar la caja. **No muestra el panel del dueño.** |

## Desarrollo

Requiere Node.js 20 o superior.

```sh
npm install
npm run dev        # http://localhost:5173/ (dueño) y http://localhost:5173/ventas.html (caja)
npm run build      # genera dist/index.html y dist/ventas.html
```

La URL y la clave pública de Supabase están fijas en `src/lib/config.ts`. Si cambias de proyecto o de clave, edítalas ahí. Esa clave es pública; nunca pongas ahí una `service_role`.

## Configuración en Supabase (una sola vez)

1. **SQL Editor**: ejecuta en este orden `supabase/schema.sql`, `supabase/tenant_migration.sql`, `supabase/ventas_migration.sql` y `supabase/fiados_migration.sql`. Todos se pueden volver a ejecutar sin perder datos. Si alguna vez vuelves a ejecutar uno de los primeros, ejecuta después los que le siguen.
2. **Authentication → Sign In / Providers**:
   - Email: habilitado, con confirmación de correo.
   - **Allow anonymous sign-ins: activado**. Las cajas inician sesión así. Sin esto no se puede vincular ninguna caja.
3. **Authentication → URL Configuration**:
   - *Site URL*: la dirección pública de la app, por ejemplo `https://mister-inventario.cl/`.
   - *Redirect URLs*: agrega esa misma dirección. Ahí llega el enlace de **“¿Olvidaste tu clave?”**.
4. (Opcional) Aviso por correo a la administradora: ver la sección *Aviso por correo*.

## Cómo funciona

### Alta de un almacén

El dueño entra a `index.html`, elige *Inscribe tu almacén* y completa RUT, razón social, giro, dirección, correo y clave. La solicitud queda pendiente. La administradora (`debbie.sepulveda2026@soymas.cl`) inicia sesión en la misma página, ve la bandeja de solicitudes y aprueba o rechaza. Al aprobar se crea el almacén vacío y la cuenta queda como `owner`.

### Recuperar la clave

En el login, *¿Olvidaste tu clave?* pide el correo y Supabase envía un enlace. Al abrirlo, la página muestra el formulario *Crea tu clave nueva*. Solo se necesita acceso al correo.

### Vincular una caja

Se hace una vez en cada computador o tablet de venta. Abre `ventas.html` en ese equipo y elige una de estas formas:

- **Clave del dueño**: el dueño escribe su correo y clave ahí mismo. La clave se usa una vez para autorizar y **no queda guardada** en el equipo.
- **Código de caja**: en su panel, *Centro de cajas → Vincular caja*, el dueño genera un código de 8 caracteres que dura 15 minutos y sirve una sola vez.

La caja queda con el rol `cashier`. Si se pierde un equipo, el dueño lo desvincula en *Centro de cajas*.

### Turnos con PIN

En *Personal*, el dueño agrega a cada cajera con un PIN de 4 a 8 dígitos. En la caja, la cajera toca su nombre y escribe su PIN. El PIN se verifica en Supabase (bcrypt) y se bloquea 5 minutos después de 5 intentos fallidos. Nadie puede leer los PIN, solo cambiarlos.

> Los PIN creados con la versión anterior se borran al ejecutar `ventas_migration.sql`, porque estaban cifrados en el navegador y no se pueden verificar en el servidor. **El dueño debe volver a asignarlos.**

### Qué puede hacer cada rol

| Acción | Dueño (`owner`/`admin`) | Caja (`cashier`) |
|---|---|---|
| Vender en efectivo, tarjeta y fiado | Desde `ventas.html` | ✔ |
| Crear y editar productos | ✔ | ✔ |
| Ver y guardar costos, y usar la calculadora de margen | ✔ | ✔ |
| Eliminar productos | ✔ | — |
| Crear clientes de fiado | ✔ | ✔ (con el límite por defecto del almacén) |
| Registrar abonos y editar el WhatsApp del cliente | ✔ | ✔ |
| Cambiar el límite de fiado | ✔ | — |
| Ver ventas, reportes y arqueos | ✔ | Solo las ventas de su turno en ese equipo |
| Personal, proveedores, empresa y cajas | ✔ | — |

### Cuenta de fiado

En *Clientes fiado* (caja y panel), **Ver cuenta** muestra lo que debe el cliente, su límite y cada movimiento: los fiados con fecha y productos, y los abonos con fecha, forma de pago y quién los recibió. Ahí mismo se registra un abono (efectivo o transferencia, con fecha), se **anota un fiado a mano** para deudas que no pasaron por la caja, como las del cuaderno (monto, fecha y qué llevó; la cajera respeta el límite, el dueño puede pasarlo), se agrega o corrige el WhatsApp del cliente y el botón **Cobrar por WhatsApp** abre WhatsApp con un mensaje listo con el saldo. Los abonos en efectivo se suman al efectivo esperado al cerrar la caja.

El **límite de fiado por defecto** para los clientes que crea la cajera se define en *Empresa y SII*. Parte en $30.000.

El margen se calcula sobre el precio final: `precio = costo / (1 − margen / 100)`.

### Sin conexión

Las ventas se guardan en el equipo (IndexedDB, con respaldo en LocalStorage) y se suben solas cuando vuelve internet. Para iniciar un turno, crear un cliente o cerrar la caja se necesita conexión. Si una venta a fiado supera el límite al sincronizarse, queda pendiente y la caja muestra un aviso.

La cámara usa `BarcodeDetector` cuando el navegador lo soporta, y necesita HTTPS y permiso. Un lector USB funciona escribiendo el código en el buscador y presionando Enter.

## Aviso por correo

Los secretos de envío se configuran en Supabase, nunca en React. Verifica un dominio remitente en Resend y luego:

```sh
npx supabase login
npx supabase link --project-ref fmcdqarhrjvdbkakacxj
npx supabase secrets set RESEND_API_KEY=re_xxx RESEND_FROM="Mister Inventario <avisos@tu-dominio-verificado.cl>" APPROVER_EMAIL=debbie.sepulveda2026@soymas.cl APP_URL=https://tu-app.example
npx supabase functions deploy notify-store-signup --no-verify-jwt
```

Sin el secreto de Resend y un remitente verificado, la solicitud se guarda igual, pero el correo no sale.

## DTE

El comprobante que imprime la caja es interno y no es una boleta electrónica. La emisión ante el SII requiere un proveedor DTE certificado y un backend propio que maneje folios, firma y envío. No ingreses claves privadas en el navegador.

## Estructura

```
index.html            → src/main.tsx → src/App.tsx            (panel del dueño)
ventas.html           → src/ventas-main.tsx → src/Ventas.tsx  (caja)
src/components/       pantallas y formularios compartidos
src/lib/config.ts     URL y clave pública de Supabase
src/lib/supabase.ts   cliente del dueño
src/lib/supabaseVentas.ts  cliente de la caja (sesión separada)
src/lib/shared.ts     tipos y utilidades
src/lib/offline.ts    cola de ventas sin conexión
supabase/*.sql        base de datos, seguridad (RLS) y funciones
```
