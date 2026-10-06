// Public website requests: a visitor sends an inquiry, quote request, complaint or support request and gets a request
// number straight away. The number is also sent to them by WhatsApp and/or email when those are set up (secrets
// below); the result is recorded on the request so staff can confirm by hand when sending was not possible.
// Visitors can check progress with the request number and the last 6 digits of their phone.
// No login: this function runs without a user token (verify_jwt false) and talks to the database only through
// submit_customer_request / record_customer_request_confirmation / track_customer_request, which only the service
// role may call. A hidden form field catches simple bots; the database limits each connection to 5 requests an hour.
//
// Optional secrets (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY, EMAIL_FROM            e.g. "Anudha Limited <requests@anudha.com>" (domain verified in Resend)
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID,    WhatsApp Business Platform (Meta) access token and phone number ID
//   WHATSAPP_TEMPLATE, WHATSAPP_LANGUAGE  an approved template with two body values: {{1}} name, {{2}} request number
import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = ['https://hassijatanisha-rgb.github.io', 'https://anudha.com', 'https://www.anudha.com'];
const KINDS = ['inquiry', 'quote', 'complaint', 'support'];
const KIND_WORDS: Record<string, string> = { inquiry: 'inquiry', quote: 'quote request', complaint: 'complaint', support: 'support request' };

function cors(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
    'Vary': 'Origin',
  };
}
function reply(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const longText = (value: unknown, max: number) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
// Tanzanian numbers written 07xx… become 2557xx…; others keep their country code.
export function internationalPhone(phone: string) {
  const digits = phone.replace(/[^0-9]/g, '');
  if (/^0[67][0-9]{8}$/.test(digits)) return '255' + digits.slice(1);
  return digits;
}
async function clientKey(req: Request, salt: string) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'unknown';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${ip}`));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function confirmationText(name: string, kind: string, number: string) {
  return `Hello ${name}, thank you for contacting Anudha Limited. We have received your ${KIND_WORDS[kind] ?? 'request'}. ` +
    `Your request number is ${number}. Please keep it; our team will contact you soon. Phone: +255 783 523 777.`;
}

async function sendWhatsApp(phone: string, name: string, number: string) {
  const token = Deno.env.get('WHATSAPP_TOKEN'), phoneId = Deno.env.get('WHATSAPP_PHONE_ID'), template = Deno.env.get('WHATSAPP_TEMPLATE');
  if (!token || !phoneId || !template) return { status: 'not_set_up', detail: 'WhatsApp is not connected yet' };
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: internationalPhone(phone), type: 'template',
      template: { name: template, language: { code: Deno.env.get('WHATSAPP_LANGUAGE') || 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: name.slice(0, 60) }, { type: 'text', text: number }] }] } }),
  });
  return res.ok ? { status: 'sent', detail: 'WhatsApp sent' } : { status: 'failed', detail: `WhatsApp ${res.status}: ${(await res.text()).slice(0, 200)}` };
}
async function sendEmail(email: string, name: string, kind: string, number: string) {
  const key = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('EMAIL_FROM');
  if (!key || !from) return { status: 'not_set_up', detail: 'Email sending is not set up yet' };
  const body = confirmationText(name, kind, number);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [email], subject: `We received your request ${number}`, text: body }),
  });
  return res.ok ? { status: 'sent', detail: 'Email sent' } : { status: 'failed', detail: `Email ${res.status}: ${(await res.text()).slice(0, 200)}` };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return reply(req, 405, { error: 'Use POST' });
  const url = Deno.env.get('SUPABASE_URL'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !service) return reply(req, 500, { error: 'Requests are not available right now. Please call +255 783 523 777.' });
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(req, 400, { error: 'Send the form again' }); }

  if (body.action === 'track') {
    const result = await db.rpc('track_customer_request', { p_request_number: text(body.request_number, 40), p_phone_end: text(body.phone_end, 40) });
    if (result.error) return reply(req, 400, { error: 'Could not check right now. Please try again.' });
    const row = (result.data ?? [])[0];
    return row ? reply(req, 200, { found: true, ...row }) : reply(req, 200, { found: false });
  }

  if (body.action !== 'submit') return reply(req, 400, { error: 'Unknown request' });
  // Hidden field: people never fill it in, simple bots do.
  if (text(body.website, 200)) return reply(req, 400, { error: 'Request not accepted' });
  const kind = String(body.kind ?? '');
  if (!KINDS.includes(kind)) return reply(req, 400, { error: 'Choose what your request is about' });
  const name = text(body.name, 200), phone = text(body.phone, 40), email = text(body.email, 200).toLowerCase(), message = longText(body.message, 4000);
  const channel = ['whatsapp', 'email', 'phone'].includes(String(body.channel)) ? String(body.channel) : 'whatsapp';
  if (name.length < 2) return reply(req, 400, { error: 'Enter your name' });
  if (!/^\+?[0-9][0-9\s()-]{5,20}$/.test(phone)) return reply(req, 400, { error: 'Enter a phone number we can reach you on' });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(req, 400, { error: 'Check the email address' });
  if (message.length < 2) return reply(req, 400, { error: 'Tell us how we can help' });

  const saved = await db.rpc('submit_customer_request', {
    p_kind: kind, p_name: name, p_phone: phone, p_email: email, p_organization: text(body.organization, 300), p_product: text(body.product, 300),
    p_quantity: text(body.quantity, 60), p_message: message, p_channel: channel, p_client_key: await clientKey(req, url),
  });
  if (saved.error) {
    const known = /Too many requests|Enter |Tell us|Choose /.test(saved.error.message);
    return reply(req, known ? 429 : 500, { error: known ? saved.error.message : 'Your request could not be saved. Please call +255 783 523 777.' });
  }
  const row = (saved.data ?? [])[0];
  if (!row) return reply(req, 500, { error: 'Your request could not be saved. Please call +255 783 523 777.' });
  if (row.duplicate) return reply(req, 200, { request_number: row.request_number, kind, confirmation: 'already_received' });

  // Send the request number. WhatsApp first when that is how they want to be reached, email when they gave one.
  const results: { status: string; detail: string }[] = [];
  try { if (channel === 'whatsapp') results.push(await sendWhatsApp(phone, name, row.request_number)); } catch (e) { results.push({ status: 'failed', detail: `WhatsApp: ${(e as Error).message}` }); }
  try { if (email) results.push(await sendEmail(email, name, kind, row.request_number)); } catch (e) { results.push({ status: 'failed', detail: `Email: ${(e as Error).message}` }); }
  const status = results.some((r) => r.status === 'sent') ? 'sent' : results.some((r) => r.status === 'failed') ? 'failed' : 'not_set_up';
  const detail = results.map((r) => r.detail).join('; ') || 'No email given and WhatsApp not chosen';
  await db.rpc('record_customer_request_confirmation', { p_id: row.id, p_status: status, p_detail: detail });
  return reply(req, 200, { request_number: row.request_number, kind, confirmation: status });
});
