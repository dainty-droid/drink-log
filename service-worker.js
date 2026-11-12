// 네트워크 우선 서비스워커 - 온라인이면 항상 최신 파일, 오프라인일 때만 캐시로 연다.
// (캐시 우선이었을 때 아이콘/매니페스트가 옛날 것으로 남는 문제가 있었음)
// 데이터는 전부 localStorage에 있으므로 여기서 캐시하는 건 앱 껍데기(HTML/JS/매니페스트/아이콘)뿐이다.
var CACHE_NAME = "drinklog-v11";
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
      // HTTP 캐시를 거치지 않고 서버에서 새로 받아 저장
      return cache.addAll(ASSETS.map(function (u) { return new Request(u, { cache: "reload" }); }));
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
    fetch(event.request).then(function (networkResp) {
      if (networkResp && networkResp.ok) {
        var copy = networkResp.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
      }
      return networkResp;
    }).catch(function () {
      return caches.match(event.request, { ignoreSearch: true });
    })
  );
});
