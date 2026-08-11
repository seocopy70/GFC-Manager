// Supabase 설정 정보
const SUPABASE_URL = 'https://mtffgykhsxumdcxpdxwc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10ZmZneWtoc3h1bWRjeHBkeHdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNDY3OTcsImV4cCI6MjEwMDcyMjc5N30.BuGXiKfMnBJJNjq4I3CVVzhnmzq_EB5sJQk-G3CKF08';

// 로그인 아이디 입력칸에 '@' 없이 아이디만 입력해도 이 도메인이 자동으로 붙습니다.
// 예: AUTO_LOGIN_EMAIL_DOMAIN = 'gfcteam.com' 으로 설정하면 'hong' 입력 시 'hong@gfcteam.com'으로 로그인 시도.
// 실제 사용 중인 이메일 도메인으로 바꿔서 사용하세요. 빈 문자열이면 이 기능은 꺼집니다.
const AUTO_LOGIN_EMAIL_DOMAIN = '';

// Supabase SDK가 전역 객체로 로드되었는지 확인 (CDN 방식)
// persistSession: true → 브라우저(localStorage)에 로그인 세션을 저장해서,
// 새로고침/재방문해도 로그아웃 버튼을 누르기 전까지는 로그인 상태가 유지됩니다.
if (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function') {
  window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true
    }
  });
} else if (window.supabase && typeof window.supabase.createClient === 'function') {
  // 이미 초기화된 경우
} else {
  console.error('Supabase SDK가 올바르게 로드되지 않았습니다.');
}