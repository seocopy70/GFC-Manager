// 초대코드 생성 + 메일 발송 (관리자 전용)
// 배포: supabase functions deploy send-invite
// 필요한 Secrets: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, (선택) SMTP_FROM, ADMIN_EMAIL, APP_URL
import { createClient } from 'npm:@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

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

  // 4) 메일 발송
  const appUrl = Deno.env.get('APP_URL') ?? 'https://seocopy70.github.io/GFC-Manager/';
  const smtpUser = Deno.env.get('SMTP_USER')!;
  const client = new SMTPClient({
    connection: {
      hostname: Deno.env.get('SMTP_HOST')!,
      port: Number(Deno.env.get('SMTP_PORT') ?? '465'),
      tls: true,
      auth: { username: smtpUser, password: Deno.env.get('SMTP_PASS')! },
    },
  });
  try {
    await client.send({
      from: Deno.env.get('SMTP_FROM') ?? smtpUser,
      to: email,
      subject: '[GFC Manager] 가입 초대코드 안내',
      content: `GFC Manager 가입 초대코드: ${code}\n\n가입 주소: ${appUrl}\n\n사용 방법\n1. 위 주소에 접속해 "가입하기"를 누릅니다.\n2. 이 메일을 받은 이메일 주소(${email})와 비밀번호를 입력합니다.\n3. 초대코드 ${code} 를 입력하고 가입합니다.\n\n※ 초대코드는 이 이메일 주소로만 가입할 수 있으며, 7일 후 만료됩니다.`,
      html: `<div style="font-family:sans-serif;line-height:1.6">
        <h2>GFC Manager 가입 초대</h2>
        <p>아래 초대코드를 가입 화면에 입력해주세요.</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:4px;background:#f1f5f9;padding:12px 20px;display:inline-block;border-radius:8px">${code}</p>
        <p>가입 주소: <a href="${appUrl}">${appUrl}</a></p>
        <ol>
          <li>"가입하기"를 누릅니다.</li>
          <li>이 메일을 받은 주소(<b>${email}</b>)와 비밀번호를 입력합니다.</li>
          <li>초대코드를 입력하고 가입합니다.</li>
        </ol>
        <p style="color:#64748b;font-size:12px">초대코드는 이 이메일 주소로만 가입할 수 있으며, 7일 후 만료됩니다.</p>
      </div>`,
    });
    await client.close();
  } catch (e) {
    // 메일 발송에 실패하면 쓸모없는 코드가 남지 않도록 삭제
    await admin.from('invites').delete().eq('email', email).is('used_at', null);
    return json({ error: '메일 발송 실패: ' + (e as Error).message }, 502);
  }

  return json({ ok: true, email });
});
