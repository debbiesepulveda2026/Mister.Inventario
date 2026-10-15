# Mister Inventario: separación en dos páginas

**Resumen.** La app quedó dividida en dos páginas conectadas al mismo Supabase:

- **Panel del dueño (`index.html`)**: tiene login, recuperación de clave por correo, inscripción del almacén con tu aprobación y toda la administración.
- **Página de ventas (`ventas.html`)**: la cajera vende (también fiado), crea productos con calculadora de margen y clientes de fiado, y abre y cierra la caja, sin acceso al panel.

Cada equipo de venta se vincula una vez con un código o con la clave del dueño, y cada cajera inicia turno con su nombre y PIN. Antes de usarla hay que ejecutar un SQL nuevo y activar una opción en Supabase.

## Lo que tienes que hacer en Supabase

1. En **SQL Editor**, ejecuta `supabase/ventas_migration.sql`. Se puede volver a ejecutar sin problema.
2. En **Authentication → Sign In / Providers**, activa **Allow anonymous sign-ins**.
3. En **Authentication → URL Configuration**, pon la dirección de la app en *Site URL* y en *Redirect URLs*. Sin esto, el enlace para recuperar la clave no vuelve a la app.
4. Pide a cada dueño que **reasigne los PIN** de su personal. Los antiguos se invalidan.
5. Ejecuta `npm run build` y publica la carpeta `dist/`, que ahora trae `index.html` y `ventas.html`.

## Cómo queda el flujo

| Paso | Quién | Dónde |
|---|---|---|
| Inscribe el almacén | Dueño | `index.html` → *Inscribe tu almacén* |
| Aprueba o rechaza | Debbie | `index.html` con tu correo → bandeja de solicitudes |
| Agrega personal con PIN | Dueño | Panel → *Personal* |
| Vincula el equipo de venta | Dueño | `ventas.html` en ese equipo (clave o código) |
| Inicia turno y vende | Cajera | `ventas.html` → nombre + PIN |
| Revisa ventas y arqueos | Dueño | Panel → *Panel dueño*, *Centro de cajas*, *Contabilidad* |

## Puntos ciegos

- **Varias cajas a la vez.** Si hay dos cajas abiertas al mismo tiempo, el efectivo esperado de cada una incluye las ventas en efectivo de la otra. Con una caja por almacén no pasa. Si van a usar varias, conviene agregar el ID de caja a cada venta.
- **Abonos de fiado.** Hoy solo el dueño los registra. Si en la práctica la cajera recibe la plata, el dueño tiene que anotarlo después o los abonos quedarán fuera del arqueo.
- **Equipo de caja sin dueño presente.** Cualquiera con acceso físico al equipo vinculado puede ver los productos y costos, porque la cajera ve costos y así lo pediste. Para vender sí necesita un PIN válido.
- **Fiado sin conexión.** Si se vende a fiado sin internet y el cliente supera su límite por ventas hechas en otra caja, la venta queda pendiente al sincronizar. La caja avisa, pero alguien tiene que resolverlo.
- **Correo de recuperación.** Supabase envía pocos correos por hora con su servidor por defecto. Con muchos almacenes conviene configurar un SMTP propio (Resend sirve).
- **Boleta electrónica.** El comprobante sigue siendo interno. La emisión ante el SII queda pendiente.
