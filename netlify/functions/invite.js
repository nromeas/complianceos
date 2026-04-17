// netlify/functions/invite.js
// ═══════════════════════════════════════════════════════════════════════════
// ComplianceOS — Envoi d'invitation via Supabase Auth Admin
// Requiert : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY dans les env vars Netlify
// ═══════════════════════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

exports.handler = async (event) => {
  // CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Parse body
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { email, company_id, role, kind, invited_by, fallback_token } = body;
  if (!email || !company_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'email + company_id requis' }) };
  }

  // Vérifier les variables d'env
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'SUPABASE_SERVICE_ROLE_KEY non configuré dans Netlify',
        email_sent: false
      })
    };
  }

  const supa = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Token unique (ou fourni en fallback)
  const token = fallback_token || crypto.randomBytes(24).toString('hex');

  // 1. Insérer l'invitation
  const { data: inv, error: invErr } = await supa
    .from('invitations')
    .insert({
      email: email.toLowerCase().trim(),
      company_id,
      role: role || 'Collaborateur',
      kind: kind || 'employee',
      token,
      invited_by: invited_by || null,
      accepted: false
    })
    .select()
    .single();

  if (invErr) {
    // Si c'est un doublon (email déjà invité), chercher l'invit existante
    if (invErr.code === '23505') {
      const { data: existing } = await supa
        .from('invitations')
        .select('token')
        .eq('email', email.toLowerCase())
        .eq('company_id', company_id)
        .eq('accepted', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (existing && existing.token) {
        const invite_link = buildInviteLink(event, existing.token);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            token: existing.token,
            invite_link,
            email_sent: false,
            email_error: 'Invitation déjà existante, réutilisation du token',
            reused: true
          })
        };
      }
    }
    return { statusCode: 500, headers, body: JSON.stringify({ error: invErr.message }) };
  }

  const invite_link = buildInviteLink(event, token);

  // 2. Envoyer l'email via Supabase Auth Admin
  let emailSent = false;
  let emailError = null;
  try {
    const { error: mailErr } = await supa.auth.admin.inviteUserByEmail(email, {
      redirectTo: invite_link,
      data: { company_id, role, kind, token }
    });
    if (mailErr) {
      emailError = mailErr.message;
      emailSent = false;
    } else {
      emailSent = true;
    }
  } catch (e) {
    emailError = e.message;
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      token,
      invitation_id: inv.id,
      invite_link,
      email_sent: emailSent,
      email_error: emailError
    })
  };
};

function buildInviteLink(event, token) {
  const origin = event.headers.origin
    || `https://${event.headers.host}`
    || process.env.URL
    || 'https://complianceos1.netlify.app';
  return `${origin}/?invite=${token}`;
}
