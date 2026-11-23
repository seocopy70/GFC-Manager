// 초대코드 검증 후 가입 (누구나 호출 가능, 코드가 맞아야만 계정 생성)
// 배포: supabase functions deploy signup-with-invite --no-verify-jwt
// ※ Supabase 대시보드에서 "Allow new users to sign up"을 꺼야, 이 함수를 우회한 직접 가입이 막힙니다.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

const MAX_ATTEMPTS = 5;
const GENERIC_FAIL = '이메일 또는 초대코드가 올바르지 않거나 만료되었습니다.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: '허용되지 않는 요청입니다.' }, 405);

  let body: { email?: string; password?: string; code?: string };
  try { body = await req.json(); } catch { return json({ error: '잘못된 요청입니다.' }, 400); }

  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  const code = (body.code ?? '').trim().toUpperCase().replace(/\s+/g, '');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: '올바른 이메일 주소를 입력해주세요.' }, 400);
  if (password.length < 6) return json({ error: '비밀번호는 6자 이상이어야 합니다.' }, 400);
  if (!code) return json({ error: '초대코드를 입력해주세요.' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 이 이메일로 발급된 가장 최근 미사용 초대코드 조회
  const { data: invite } = await admin
    .from('invites')
    .select('*')
    .eq('email', email)
    .is('used_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!invite || new Date(invite.expires_at) < new Date() || invite.attempts >= MAX_ATTEMPTS) {
    return json({ error: GENERIC_FAIL }, 400);
  }

  // 이메일 + 코드가 함께 일치해야 통과 (해시에 이메일이 포함되어 있어 다른 이메일엔 사용 불가)
  const given = await sha256(`${email}:${code}`);
  if (given !== invite.code_hash) {
    await admin.from('invites').update({ attempts: invite.attempts + 1 }).eq('id', invite.id);
    return json({ error: GENERIC_FAIL }, 400);
  }

  // 계정 생성 (초대받은 메일이므로 이메일 인증 완료 처리)
  const { error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr) {
    const already = /already|registered|exists/i.test(createErr.message);
    return json({ error: already ? '이미 가입된 이메일입니다. 로그인해주세요.' : '가입 실패: ' + createErr.message }, 400);
  }

  await admin.from('invites').update({ used_at: new Date().toISOString() }).eq('id', invite.id);
  return json({ ok: true });
});
