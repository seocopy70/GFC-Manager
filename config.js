// Supabase 설정 정보
const SUPABASE_URL = 'https://mtffgykhsxumdcxpdxwc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10ZmZneWtoc3h1bWRjeHBkeHdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNDY3OTcsImV4cCI6MjEwMDcyMjc5N30.BuGXiKfMnBJJNjq4I3CVVzhnmzq_EB5sJQk-G3CKF08';

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

// PWA 설정: GitHub Pages의 /GFC-Manager/ 하위 경로에서도 동작하도록// 매니페스트와 Service Worker를 상대 경로로 등록합니다.
(function registerGfcPwa() {
  try {
    if (!document.querySelector('link[rel="manifest"]')) {
      const manifest = document.createElement('link');
      manifest.rel = 'manifest';
      manifest.href = './manifest.webmanifest';
      document.head.appendChild(manifest);
    }

    if (!document.querySelector('meta[name="theme-color"]')) {
      const themeColor = document.createElement('meta');
      themeColor.name = 'theme-color';
      themeColor.content = '#0f172a';
      document.head.appendChild(themeColor);
    }

    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      const appleIcon = document.createElement('link');
      appleIcon.rel = 'apple-touch-icon';
      appleIcon.href = './icons/icon-192.svg';
      document.head.appendChild(appleIcon);
    }

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { scope: './' })
          .then((registration) => {
            console.log('[PWA] Service Worker registered:', registration.scope);
          })
          .catch((error) => {
            console.warn('[PWA] Service Worker registration failed:', error);
          });
      });
    }
  } catch (error) {
    console.warn('[PWA] Initialization skipped:', error);
  }
})();
