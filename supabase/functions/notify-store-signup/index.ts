import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character] ?? character))

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const { user_id: userId } = await request.json()
    if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) {
      return jsonResponse({ error: 'Invalid user id' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const approverEmail = Deno.env.get('APPROVER_EMAIL') ?? 'debbie.sepulveda2026@soymas.cl'
    const sender = Deno.env.get('RESEND_FROM')
    const appUrl = Deno.env.get('APP_URL') ?? 'http://127.0.0.1:5173/'
    if (!supabaseUrl || !serviceRoleKey || !resendApiKey || !sender) {
      return jsonResponse({ error: 'Email notification is not configured' }, 503)
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
    const { data: authResult, error: userError } = await admin.auth.admin.getUserById(userId)
    if (userError || !authResult.user?.email) return jsonResponse({ error: 'Signup user not found' }, 404)

    const { data: signup, error: requestError } = await admin
      .from('company_signup_requests')
      .select('id,email,rut,legal_name,business,address,status,notification_sent_at')
      .eq('user_id', userId)
      .maybeSingle()
    if (requestError || !signup) return jsonResponse({ error: 'Signup request not found' }, 404)
    if (signup.email.toLowerCase() !== authResult.user.email.toLowerCase()) return jsonResponse({ error: 'Email mismatch' }, 403)
    if (signup.status !== 'pending') return jsonResponse({ error: 'Signup request is not pending' }, 409)
    if (signup.notification_sent_at) return jsonResponse({ email_sent: true, already_sent: true })

    const safeName = escapeHtml(signup.legal_name)
    const safeRut = escapeHtml(signup.rut)
    const safeBusiness = escapeHtml(signup.business)
    const safeAddress = escapeHtml(signup.address)
    const safeEmail = escapeHtml(signup.email)
    const dashboardLink = escapeHtml(appUrl)
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: sender,
        to: [approverEmail],
        subject: `Solicitud de almacén pendiente: ${signup.legal_name}`,
        html: `<h2>Nueva solicitud de almacén</h2><p><strong>Razón social:</strong> ${safeName}</p><p><strong>RUT:</strong> ${safeRut}</p><p><strong>Giro:</strong> ${safeBusiness}</p><p><strong>Dirección:</strong> ${safeAddress}</p><p><strong>Correo:</strong> ${safeEmail}</p><p>Inicia sesión con tu cuenta administradora para aprobar o rechazar esta solicitud.</p><p><a href="${dashboardLink}">Revisar solicitud en Mister Inventario</a></p>`,
      }),
    })
    if (!emailResponse.ok) return jsonResponse({ error: 'Email provider rejected the notification' }, 502)

    await admin.from('company_signup_requests').update({ notification_sent_at: new Date().toISOString() }).eq('id', signup.id)
    return jsonResponse({ email_sent: true })
  } catch {
    return jsonResponse({ error: 'Unable to send signup notification' }, 500)
  }
})