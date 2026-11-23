// 초대코드 생성 (관리자 전용) - 메일 발송 없이 코드를 응답으로 돌려줌
// 배포: supabase functions deploy create-invite
// (선택) Secrets: ADMIN_EMAIL (기본 seongkyos@naver.com)
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// 헷갈리기 쉬운 문자(0/O, 1/I/L) 제외한 8자리 코드
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeCode(len = 8): string {
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => ALPHABET[n % ALPHABET.length]).join('');
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: '허용되지 않는 요청입니다.' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ADMIN_EMAIL = (Deno.env.get('ADMIN_EMAIL') ?? 'seongkyos@naver.com').toLowerCase();

  // 1) 호출자 인증: 로그인한 사용자가 관리자 이메일인지 서버에서 확인
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: '로그인이 필요합니다.' }, 401);
  if ((userData.user.email ?? '').toLowerCase() !== ADMIN_EMAIL) {
    return json({ error: '초대코드를 보낼 권한이 없습니다.' }, 403);
  }

  // 2) 입력 검증
  let body: { email?: string };
  try { body = await req.json(); } catch { return json({ error: '잘못된 요청입니다.' }, 400); }
  const email = (body.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: '올바른 이메일 주소를 입력해주세요.' }, 400);

  // 3) 새 코드 생성 (같은 이메일의 기존 미사용 코드는 모두 폐기)
  const code = makeCode();
  const codeHash = await sha256(`${email}:${code}`);
  await admin.from('invites').delete().eq('email', email).is('used_at', null);
  const { error: insErr } = await admin.from('invites').insert({ email, code_hash: codeHash });
  if (insErr) return json({ error: '초대코드 저장 실패: ' + insErr.message }, 500);

  // 4) 코드는 이 응답으로만 전달됨 (DB에는 해시만 저장되므로 다시 조회 불가)
  return json({ ok: true, email, code });

});
