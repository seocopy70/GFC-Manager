-- 초대코드 테이블 (Oracle VM의 PostgreSQL에서 1회 실행)
-- 실행 예: sudo -u postgres psql -d gfc_manager_db -f backend/invites.sql
-- 코드 원문은 저장하지 않고 HMAC 해시만 저장합니다.

CREATE TABLE IF NOT EXISTS public.invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,                              -- 항상 소문자
  code_hash   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  used_at     timestamptz,
  attempts    int NOT NULL DEFAULT 0,                     -- 오입력 5회 초과 시 무효
  created_by  uuid
);

CREATE INDEX IF NOT EXISTS invites_email_idx ON public.invites (email);

-- 앱 계정(gfc_app)이 사용할 수 있도록 권한 부여
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invites TO gfc_app;
