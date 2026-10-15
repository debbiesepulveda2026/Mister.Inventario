import { createClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

// Cliente de la página del dueño (index.html). La sesión se guarda con la clave por defecto.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
