# Mister Inventario

POS e inventario para un comercio, construido con React, TypeScript, Vite, Tailwind CSS y Supabase.

## Desarrollo

Requiere Node.js 20 o superior.

```sh
npm install
npm run dev
```

La URL y la clave anon del proyecto se configuran en `src/lib/supabase.ts`; se pueden sustituir con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. La clave anon es pública y nunca debe confundirse con una `service_role`.

## Datos y seguridad

En el SQL Editor del proyecto ejecuta, en este orden, `supabase/schema.sql` y `supabase/tenant_migration.sql`. Habilita el registro por correo y la confirmación de correo en Supabase Auth. El alta crea una solicitud pendiente; no crea la empresa ni concede membresía hasta la aprobación de `debbie.sepulveda2026@soymas.cl`. Al aprobar, la cuenta recibe un almacén vacío y el rol `owner`. Los datos quedan aislados por empresa.

La administradora inicia sesión con ese correo en la misma app para ver la bandeja y aprobar o rechazar solicitudes. Las cuentas existentes antes de esta migración conservan su membresía anterior; las altas nuevas quedan pendientes.

`owner` y `admin` pueden consultar ventas y costos. `cashier` puede usar POS, cerrar cajas abiertas y crear, modificar o eliminar productos, pero las políticas RLS le impiden leer ventas o costos. `product_financials` guarda el costo separado del catálogo. El margen se calcula sobre el precio final: `precio = costo / (1 - margen / 100)`.

Para dar acceso de cajera a una cuenta Supabase existente, agrega su UUID a `company_members` con el `company_id` del almacén y `role = 'cashier'`. Los PIN del módulo de personal por sí solos no crean una sesión Supabase.

### Aviso por correo

Los secretos de envío deben configurarse en Supabase, nunca en React. Verifica un dominio remitente en Resend; instala y enlaza Supabase CLI, y configura los valores:

```sh
npx supabase login
npx supabase link --project-ref fmcdqarhrjvdbkakacxj
npx supabase secrets set RESEND_API_KEY=re_xxx RESEND_FROM="Mister Inventario <avisos@tu-dominio-verificado.cl>" APPROVER_EMAIL=debbie.sepulveda2026@soymas.cl APP_URL=https://tu-app.example
npx supabase functions deploy notify-store-signup --no-verify-jwt
```

Reemplaza `re_xxx`, el remitente y `APP_URL` con tus valores reales. La Edge Function valida que exista una solicitud pendiente antes de enviar el aviso a la administradora. Sin el secreto de Resend y un remitente verificado, el registro queda guardado, pero el correo no se enviará.

Las ventas y el catálogo se guardan en IndexedDB con respaldo en LocalStorage y nombres de caché separados por empresa. Las ventas pendientes se reintentan al recuperar la conexión. La cámara usa `BarcodeDetector` cuando el navegador lo soporta; requiere HTTPS y permiso de cámara. También se genera un SKU interno aleatorio para cada producto.

## DTE y credenciales de personal

La interfaz de empresa muestra el encabezado DTE en los comprobantes, pero una boleta visual no es un documento tributario emitido. La emisión del SII requiere un proveedor DTE certificado y un backend que gestione folios, firma, envío y respuesta. No ingreses claves privadas en el cliente. Configura un endpoint servidor propio antes de enviar credenciales.

Los PIN se guardan con PBKDF2 y sal, nunca en texto plano; los permisos por columna impiden leer los hashes desde la aplicación. La autenticación de personal con PIN y los intentos limitados deben implementarse en una función de servidor antes de usar los PIN como mecanismo independiente de inicio de sesión.