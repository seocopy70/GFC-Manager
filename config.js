// Supabase 설정 정보
const SUPABASE_URL = 'https://mtffgykhsxumdcxpdxwc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10ZmZneWtoc3h1bWRjeHBkeHdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNDY3OTcsImV4cCI6MjEwMDcyMjc5N30.BuGXiKfMnBJJNjq4I3CVVzhnmzq_EB5sJQk-G3CKF08';

// Supabase SDK가 전역 객체로 로드되었는지 확인 (CDN 방식)
// persistSession: false → 브라우저에 로그인 세션을 저장하지 않아,
// 페이지를 새로고침/재방문할 때마다 항상 로그인 화면부터 다시 시작합니다.
if (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function') {
  window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
} else if (window.supabase && typeof window.supabase.createClient === 'function') {
  // 이미 초기화된 경우
} else {
  console.error('Supabase SDK가 올바르게 로드되지 않았습니다.');
}
