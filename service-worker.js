// 네트워크 우선 서비스워커 - 온라인이면 항상 최신 파일, 오프라인/통신 불량일 때는 캐시로 연다.
// (캐시 우선이었을 때 아이콘/매니페스트가 옛날 것으로 남는 문제가 있었음)
// 데이터는 전부 localStorage에 있으므로 여기서 캐시하는 건 앱 껍데기(HTML/JS/매니페스트/아이콘)뿐이다.
// 2026-11-14: 통신이 약하면 fetch가 한참 매달려 있다 실패하므로, 3초 안에 응답이 없으면 캐시로 먼저 연다.
// (주의: 이 파일은 PowerShell Get-Content/Set-Content로 고치지 말 것 - 한글 주석이 깨지면서
//  줄바꿈이 사라져 cache.addAll 줄이 주석에 먹혀 오프라인 캐시가 비는 사고가 있었음)
var CACHE_NAME = "drinklog-v14";
var NET_TIMEOUT_MS = 3000;
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

function fromCache(req) {
  return caches.match(req, { ignoreSearch: true }).then(function (hit) {
    if (hit) return hit;
    // 페이지 이동 요청은 주소가 조금 달라도 앱 화면(index.html)으로 연다
    if (req.mode === "navigate") return caches.match("./index.html");
    return undefined;
  });
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(new Promise(function (resolve) {
    var done = false;
    function finish(resp) {
      if (!done && resp) { done = true; resolve(resp); }
    }

    var net = fetch(req).then(function (resp) {
      if (resp && resp.ok) {
        var copy = resp.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
      }
      return resp;
    });

    // 3초 지나도 응답이 없으면 캐시로 먼저 띄운다 (네트워크 응답은 뒤에서 캐시만 갱신)
    var timer = setTimeout(function () {
      fromCache(req).then(finish);
    }, NET_TIMEOUT_MS);

    net.then(function (resp) {
      clearTimeout(timer);
      finish(resp);
    }).catch(function () {
      clearTimeout(timer);
      fromCache(req).then(function (hit) {
        finish(hit || new Response("오프라인이고 저장된 화면도 없어요. 통신 되는 곳에서 한 번 열어주세요.",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }));
      });
    });
  }));
});
