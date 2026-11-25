// Oracle PostgreSQL deployment: API is same-origin under /api.

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
