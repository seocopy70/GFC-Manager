# 초대코드 가입 설정 (1회만 하면 됩니다)

## 1. 테이블 만들기
Supabase 대시보드 → SQL Editor → `supabase/invite_setup.sql` 내용을 붙여넣고 Run.

## 2. 메일 발송용 SMTP Secrets 등록
Supabase 대시보드 → Edge Functions → Secrets (또는 CLI `supabase secrets set`)

| 이름 | 값 (네이버 메일 예시) |
|---|---|
| SMTP_HOST | smtp.naver.com |
| SMTP_PORT | 465 |
| SMTP_USER | 네이버 아이디@naver.com |
| SMTP_PASS | 네이버 **애플리케이션 비밀번호** (2단계 인증 사용 시 필수) |
| SMTP_FROM | (선택) 보내는 주소. 비우면 SMTP_USER 사용 |

네이버 메일 → 환경설정 → POP3/IMAP 설정에서 "IMAP/SMTP 사용"을 켜야 합니다.

## 3. Edge Function 배포 (PC 터미널, 레포 폴더에서)
```
supabase login
supabase link --project-ref mtffgykhsxumdcxpdxwc
supabase functions deploy send-invite
supabase functions deploy signup-with-invite --no-verify-jwt
```

## 4. 직접 가입 막기 (중요)
Authentication → Sign In / Providers → **"Allow new users to sign up" 끄기**.
이걸 꺼야 초대코드 없이 API로 직접 가입하는 것이 차단됩니다.
(초대 가입은 서버 함수가 관리자 권한으로 계정을 만들기 때문에 이 설정과 무관하게 동작합니다.)
