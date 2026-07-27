// Supabase 설정 정보
const SUPABASE_URL = 'https://mtffgykhsxumdcxpdxwc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10ZmZneWtoc3h1bWRjeHBkeHdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNDY3OTcsImV4cCI6MjEwMDcyMjc5N30.BuGXiKfMnBJJNjq4I3CVVzhnmzq_EB5sJQk-G3CKF08';

if (typeof supabase !== 'undefined') {
  if (window.supabase) {
    console.warn('Supabase already initialized');
  } else {
    window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} else {
  console.error('Supabase SDK가 로드되지 않았습니다.');
}
