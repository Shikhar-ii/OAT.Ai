'use strict';

const cacheName='oat-ai-demo-20261120-v4';
const shell=['./','./index.html','./style.css','./app.js','./bottle-scan.mjs','./fonts/dm-sans-latin.woff2','./fonts/instrument-serif-latin.woff2','./images/bottle-studio.webp'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(shell)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('oat-ai-demo-')&&key!==cacheName).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if (request.method!=='GET' || new URL(request.url).origin!==location.origin) return;
  const isShell=shell.some(path=>new URL(path,registration.scope).href===request.url);
  const isVision=request.url.startsWith(new URL('./vision/',registration.scope).href);
  if (request.mode!=='navigate' && !isShell && !isVision) return;
  event.respondWith(fetch(request).then(response=>{
    if (response.ok && (isShell || isVision)) {
      const copy=response.clone();
      event.waitUntil(caches.open(cacheName).then(cache=>cache.put(request,copy)));
    }
    return response;
  }).catch(()=>caches.match(request).then(hit=>hit||(request.mode==='navigate'?caches.match('./index.html'):Response.error()))));
});
