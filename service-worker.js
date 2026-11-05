// 아주 단순한 캐시-우선 서비스워커 - 오프라인에서도 앱이 열리게 하는 용도.
// 데이터는 전부 localStorage에 있으므로 여기서 캐시하는 건 앱 껍데기(HTML/JS/매니페스트/아이콘)뿐이다.
var CACHE_NAME = "drinklog-v2";
var ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
            .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var fetchPromise = fetch(event.request).then(function (networkResp) {
        if (networkResp && networkResp.ok) {
          var copy = networkResp.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return networkResp;
      }).catch(function () { return cached; });
      return cached || fetchPromise;
    })
  );
});
