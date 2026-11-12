// ?ㅽ듃?뚰겕 ?곗꽑 ?쒕퉬?ㅼ썙而?- ?⑤씪?몄씠硫???긽 理쒖떊 ?뚯씪, ?ㅽ봽?쇱씤???뚮쭔 罹먯떆濡??곕떎.
// (罹먯떆 ?곗꽑?댁뿀?????꾩씠肄?留ㅻ땲?섏뒪?멸? ?쏅궇 寃껋쑝濡??⑤뒗 臾몄젣媛 ?덉뿀??
// ?곗씠?곕뒗 ?꾨? localStorage???덉쑝誘濡??ш린??罹먯떆?섎뒗 嫄???猿띾뜲湲?HTML/JS/留ㅻ땲?섏뒪???꾩씠肄?肉먯씠??
var CACHE_NAME = "drinklog-v13";
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
      // HTTP 罹먯떆瑜?嫄곗튂吏 ?딄퀬 ?쒕쾭?먯꽌 ?덈줈 諛쏆븘 ???      return cache.addAll(ASSETS.map(function (u) { return new Request(u, { cache: "reload" }); }));
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
