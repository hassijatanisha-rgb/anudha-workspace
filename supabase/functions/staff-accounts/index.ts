// Owner-only staff logins without email addresses: create an employee (ID from the name, temporary password)
// and reset a forgotten password. The service key is used only for the two auth.admin calls; every staff-table
// change and log entry is made with the owner's own session, so the database records the owner as the actor.
// No password is stored or logged; the temporary password is returned once to the owner who asked for it.
import { createClient } from 'npm:@supabase/supabase-js@2';

const DOMAIN = 'staff.anudha.com';
const ALLOWED_ORIGINS = ['https://hassijatanisha-rgb.github.io'];
const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cors(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}
function reply(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
// Same rules as employee-login.js so the ID the owner sees is the ID staff type.
function idPart(word: string) {
  return word.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function employeeIdCandidates(fullName: string) {
  const words = fullName.trim().split(/\s+/).map(idPart).filter(Boolean);
  if (!words.length) return [];
  const first = words[0].slice(0, 30), last = words.length > 1 ? words[words.length - 1].slice(0, 30) : '';
  const base = last ? [`${first}.${last}`, `${first}.${last[0]}`, first] : [first];
  for (let n = 2; n <= 99; n++) base.push(`${last ? `${first}.${last}` : first}${n}`);
  return [...new Set(base)].filter((id) => id.length >= 2 && id.length <= 40 && ID_PATTERN.test(id));
}
function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < 12) for (const byte of crypto.getRandomValues(new Uint8Array(32))) if (byte < limit && out.length < 12) out += alphabet[byte % alphabet.length];
  return out;
}
function normalPhone(value: unknown) {
  const phone = String(value ?? '').replace(/[\s()-]/g, '');
  if (phone && !/^\+[0-9]{8,15}$/.test(phone)) throw new Error('Enter the phone with country code, for example +255712345678');
  return phone;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return reply(req, 405, { error: 'Use POST' });
  const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return reply(req, 500, { error: 'Staff accounts are not configured on the server' });

  const asOwner = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false, autoRefreshToken: false } });
  const who = await asOwner.auth.getUser();
  if (who.error || !who.data.user) return reply(req, 401, { error: 'Sign in again' });
  const owner = await asOwner.rpc('is_owner');
  if (owner.error || owner.data !== true) return reply(req, 403, { error: 'Only an active owner can manage staff logins' });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(req, 400, { error: 'Send JSON' }); }

  try {
    if (body.action === 'create') {
      const fullName = String(body.full_name ?? '').trim().replace(/\s+/g, ' ');
      const role = body.role === 'owner' ? 'owner' : body.role === 'staff' ? 'staff' : '';
      if (fullName.length < 2 || fullName.length > 120) return reply(req, 400, { error: 'Enter the employee’s full name' });
      if (!role) return reply(req, 400, { error: 'Choose Staff or Owner' });
      const phone = normalPhone(body.phone);
      const password = temporaryPassword();
      let userId = '', employeeId = '';
      for (const id of employeeIdCandidates(fullName)) {
        const created = await admin.auth.admin.createUser({ email: `${id}@${DOMAIN}`, password, email_confirm: true,
          user_metadata: { full_name: fullName, employee_id: id, must_change_password: true } });
        if (created.error) {
          if (/already|registered|exists/i.test(created.error.message)) continue;
          throw new Error(created.error.message);
        }
        userId = created.data.user.id; employeeId = id; break;
      }
      if (!userId) return reply(req, 409, { error: 'No free employee ID for this name; add a middle name or initial' });
      const access = await asOwner.rpc('manage_staff', { p_user_id: userId, p_role: role, p_active: true });
      if (access.error) {
        await admin.auth.admin.deleteUser(userId);
        throw new Error(`Access could not be enabled, so the login was removed again: ${access.error.message}`);
      }
      const warnings: string[] = [];
      const named = await asOwner.rpc('set_staff_display_name', { p_user_id: userId, p_expected_version: 0, p_display_name: fullName });
      if (named.error) warnings.push(`Name not saved: ${named.error.message}`);
      if (phone) { const saved = await asOwner.rpc('set_staff_phone', { p_user_id: userId, p_phone: phone }); if (saved.error) warnings.push(`Phone not saved: ${saved.error.message}`); }
      const logged = await asOwner.rpc('record_staff_account_event', { p_user_id: userId, p_action: 'created', p_note: `Employee ID ${employeeId}` });
      if (logged.error) warnings.push(`History not recorded: ${logged.error.message}`);
      return reply(req, 200, { user_id: userId, employee_id: employeeId, full_name: fullName, temporary_password: password, warnings });
    }

    if (body.action === 'reset') {
      const target = String(body.user_id ?? '');
      if (!UUID.test(target)) return reply(req, 400, { error: 'Choose an employee' });
      if (target === who.data.user.id) return reply(req, 400, { error: 'Use Change password for your own login' });
      const member = await asOwner.from('staff').select('user_id').eq('user_id', target).maybeSingle();
      if (member.error || !member.data) return reply(req, 404, { error: 'This person is not on the staff list' });
      const existing = await admin.auth.admin.getUserById(target);
      if (existing.error || !existing.data.user) return reply(req, 404, { error: 'Login not found' });
      const password = temporaryPassword();
      const updated = await admin.auth.admin.updateUserById(target, { password,
        user_metadata: { ...(existing.data.user.user_metadata ?? {}), must_change_password: true } });
      if (updated.error) throw new Error(updated.error.message);
      const logged = await asOwner.rpc('record_staff_account_event', { p_user_id: target, p_action: 'password_reset', p_note: '' });
      return reply(req, 200, { user_id: target, temporary_password: password, warnings: logged.error ? [`History not recorded: ${logged.error.message}`] : [] });
    }
    return reply(req, 400, { error: 'Unknown action' });
  } catch (error) {
    return reply(req, 400, { error: error instanceof Error ? error.message : 'Request failed' });
  }
});
