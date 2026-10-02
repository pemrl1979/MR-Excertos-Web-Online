const CACHE='mr-excertos-web-1.0';
const LOCAL=[
  './','./index.html','./style.css','./app.js','./core.mjs','./manual.html','./manifest.webmanifest',
  './icons/icon-192.png','./icons/icon-512.png','./assets/Modelo_MR_Excertos.odt','./vendor/jszip.min.js',
  './vendor/pdfjs/pdf.min.mjs','./vendor/pdfjs/pdf.worker.min.mjs'
];
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(c=>c.addAll(LOCAL)))});
self.addEventListener('activate',event=>event.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),
  self.clients.claim()
])));
async function networkFirst(request){
  try{const response=await fetch(request,{cache:'no-store'});if(response&&response.ok){const c=await caches.open(CACHE);c.put(request,response.clone())}return response}
  catch(e){const cached=await caches.match(request);if(cached)return cached;throw e}
}
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin)return;
  const dynamic=event.request.mode==='navigate'||/\.(?:html|js|mjs|css)$/.test(url.pathname)||url.pathname.endsWith('/');
  event.respondWith(dynamic?networkFirst(event.request):caches.match(event.request).then(r=>r||networkFirst(event.request)));
});
