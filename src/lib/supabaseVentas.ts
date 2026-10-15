import { createClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

// Cliente de la página de ventas (ventas.html). Usa otra clave de almacenamiento para que la
// sesión de la caja nunca se mezcle con la sesión del dueño en el mismo navegador.
export const ventasSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: 'mister-ventas-auth', persistSession: true, autoRefreshToken: true },
})

// Cliente temporal, sin guardar sesión, para que el dueño autorice la caja con su clave
// sin dejar su sesión abierta en el equipo de ventas.
export function createTemporaryOwnerClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { storageKey: 'mister-ventas-owner-temp', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
