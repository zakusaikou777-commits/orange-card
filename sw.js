// Orange Card v15.1 - オフラインで開けるようにするためのキャッシュ
const CACHE = "orange-card-v15-1";
const SHELL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll は1つでも失敗すると全部入らない。
    // 以前は catch で握りつぶしていたので、オフラインが丸ごと効かないのに気づけなかった。
    const failed = [];
    await Promise.all(SHELL.map(async url => {
      try { await cache.add(new Request(url, { cache: "reload" })); }
      catch (e) { failed.push(url); }
    }));
    if (failed.length) console.warn("[sw] キャッシュできなかったファイル:", failed);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Google の認証・Drive API は必ずネットワークへ（キャッシュすると同期が壊れる）
  if (url.hostname.endsWith("googleapis.com") || url.hostname.endsWith("google.com")) return;

  // Chart.js（CDN）は一度取れたら使い回す
  if (url.hostname === "cdn.jsdelivr.net") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        // 保存に失敗しても配信は続ける
        cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch (e) {
        // オフラインで未キャッシュ。グラフだけ出ない状態でアプリは動く
        return new Response("", { status: 504, statusText: "offline" });
      }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  // 自分のファイルはキャッシュを先に返しつつ、裏で新しいものを取ってくる
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then(res => {
      if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone())).catch(() => {});
      return res;
    }).catch(() => cached);
    return cached || network;
  })());
});
