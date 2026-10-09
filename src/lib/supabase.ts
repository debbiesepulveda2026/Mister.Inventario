import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://fmcdqarhrjvdbkakacxj.supabase.co'
const supabaseAnonKey = 'sb_publishable_pmMXd5Qy_G7B9jYJsRofcA_4hreNNGf'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)