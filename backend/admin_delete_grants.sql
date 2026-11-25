-- 관리자 "가입 계정 삭제" 기능에 필요한 권한 (DB 서버에서 postgres 계정으로 1회 실행)
-- 이미 권한이 있어도 실행해도 무방합니다.
GRANT SELECT, DELETE ON public.app_users, public.app_sessions, public.profiles, public.contracts, public.invites TO gfc_app;
