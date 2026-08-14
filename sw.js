
// Import Babel standalone script
importScripts("https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.24.7/babel.min.js");

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercept only .ts and .tsx files from the same origin
  if (url.origin === self.origin && (url.pathname.endsWith('.ts') || url.pathname.endsWith('.tsx'))) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(event.request);

          if (!response.ok) {
            return response;
          }

          const sourceCode = await response.text();

          if (!self.Babel) {
              throw new Error("Babel is not loaded in Service Worker.");
          }

          // Transpile code
          const transpiledResult = self.Babel.transform(sourceCode, {
            presets: [
                ["react", { runtime: "automatic" }],
                "typescript"
            ],
            filename: url.pathname
          });

          if (!transpiledResult || !transpiledResult.code) {
              throw new Error(`Babel transformation returned null for ${url.pathname}`);
          }
          
          // CRITICAL: Ensure JS MIME type is strictly set for browsers like Safari
          return new Response(transpiledResult.code, {
            headers: {
              'Content-Type': 'application/javascript; charset=utf-8',
              'X-Content-Type-Options': 'nosniff'
            }
          });

        } catch (e) {
          console.error('Service Worker error for', url.pathname, e);
          const errorMessage = e instanceof Error ? e.message : String(e);
          return new Response(
            `/*\n [Service Worker Error]\n URL: ${url.pathname}\n Message: ${errorMessage}\n*/`, 
            {
              status: 500,
              headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
            }
          );
        }
      })()
    );
  }
});

// Lifecycle events
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  // تفعيل السيطرة الفورية على جميع التبويبات المفتوحة
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // التأكد من تهيئة Babel مسبقاً إذا أمكن
    ])
  );
});
