-- 초대코드 테이블 (Supabase SQL Editor에서 1회 실행)
-- RLS를 켜고 정책을 만들지 않으므로, 브라우저(anon/authenticated)에서는 접근 불가.
-- Edge Function(service role)만 읽고 쓸 수 있습니다.

create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,                       -- 항상 소문자로 저장
  code_hash   text not null,                       -- 초대코드 원문은 저장하지 않고 SHA-256 해시만 저장
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  used_at     timestamptz,
  attempts    int not null default 0               -- 오입력 횟수 (5회 초과 시 코드 무효)
);

create index if not exists invites_email_idx on public.invites (email);

alter table public.invites enable row level security;
-- (의도적으로 policy 없음)
