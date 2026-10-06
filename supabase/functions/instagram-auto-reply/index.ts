// Instagram auto-reply. Instagram calls this when someone comments on an Anudha post or reel; we send that person one
// private message (Instagram's "private reply" to a comment) with the quote page and the WhatsApp link. Instagram's
// rules allow messages only after a comment or a message from the person, never after a like, view or follow, and
// only one private reply per comment within 7 days. Each person gets at most one reply per post (instagram_auto_replies).
//
// Setup (secrets in Supabase → Edge Functions → Secrets), from a Meta app with Instagram API with Instagram Login:
//   IG_APP_SECRET        the app secret, used to check that a call really comes from Instagram
//   IG_VERIFY_TOKEN      any long random text, also typed into the app's webhook settings
//   IG_ACCESS_TOKEN      long-lived token for the Anudha Instagram business account
//   IG_USER_ID           the Instagram business account ID
//   IG_KEYWORDS          optional, comma-separated (e.g. "price,quote,bei,info"); empty = reply to every comment
//   QUOTE_URL            e.g. https://anudha.com/#quote
//   WHATSAPP_URL         e.g. https://wa.me/2557XXXXXXXX (the WhatsApp Business number)
// Deploy with verify_jwt false: Instagram does not send a Supabase login; the signature check protects the function.
import { createClient } from 'npm:@supabase/supabase-js@2';

export function replyText(quoteUrl: string, whatsappUrl: string) {
  return 'Thanks for your interest in Anudha Limited! ' +
    `Request a quote on our website: ${quoteUrl} ` +
    `or chat with our team directly on WhatsApp: ${whatsappUrl}`;
}
export function wantsReply(text: string, keywords: string) {
  const words = keywords.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (!words.length) return true;
  const lower = text.toLowerCase();
  return words.some((w) => lower.includes(w));
}
async function validSignature(raw: string, header: string | null, secret: string) {
  if (!header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const expected = Array.from(mac).map((b) => b.toString(16).padStart(2, '0')).join('');
  const given = header.slice(7);
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const env = (k: string) => Deno.env.get(k) ?? '';
  const url = new URL(req.url);
  // Webhook setup: Instagram checks the URL once with the verify token.
  if (req.method === 'GET') {
    if (url.searchParams.get('hub.mode') === 'subscribe' && env('IG_VERIFY_TOKEN') && url.searchParams.get('hub.verify_token') === env('IG_VERIFY_TOKEN')) {
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('Use POST', { status: 405 });
  const raw = await req.text();
  if (!env('IG_APP_SECRET') || !(await validSignature(raw, req.headers.get('x-hub-signature-256'), env('IG_APP_SECRET')))) {
    return new Response('Bad signature', { status: 401 });
  }
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return new Response('ok', { status: 200 }); }
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const ready = env('IG_ACCESS_TOKEN') && env('IG_USER_ID') && env('QUOTE_URL') && env('WHATSAPP_URL');

  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== 'comments') continue;
      const c = change.value ?? {};
      const commentId = String(c.id ?? ''), from = c.from ?? {}, commenterId = String(from.id ?? ''), mediaId = String(c.media?.id ?? '');
      const text = String(c.text ?? '').slice(0, 2200);
      // Ignore our own comments and anything without the needed ids.
      if (!commentId || !commenterId || commenterId === env('IG_USER_ID')) continue;
      const record = { comment_id: commentId, commenter_id: commenterId, commenter_username: String(from.username ?? '').slice(0, 100), media_id: mediaId, comment_text: text };
      const seen = await db.from('instagram_auto_replies').select('comment_id').or(`comment_id.eq.${commentId},and(commenter_id.eq.${commenterId},media_id.eq.${mediaId},status.eq.sent)`).limit(1);
      if (seen.data?.length) continue;
      if (!ready) { await db.from('instagram_auto_replies').insert({ ...record, status: 'skipped', detail: 'Instagram auto-reply is not set up yet' }); continue; }
      if (!wantsReply(text, env('IG_KEYWORDS'))) { await db.from('instagram_auto_replies').insert({ ...record, status: 'skipped', detail: 'No keyword in the comment' }); continue; }
      let status = 'failed', detail = '';
      try {
        const res = await fetch(`https://graph.instagram.com/v21.0/${env('IG_USER_ID')}/messages`, {
          method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bearer ${env('IG_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text: replyText(env('QUOTE_URL'), env('WHATSAPP_URL')) } }),
        });
        status = res.ok ? 'sent' : 'failed';
        detail = res.ok ? 'Private reply sent' : `Instagram ${res.status}: ${(await res.text()).slice(0, 300)}`;
      } catch (e) { detail = `Instagram: ${(e as Error).message}`.slice(0, 500); }
      await db.from('instagram_auto_replies').insert({ ...record, status, detail });
    }
  }
  // Always answer 200 quickly, or Instagram retries and eventually switches the webhook off.
  return new Response('ok', { status: 200 });
});
