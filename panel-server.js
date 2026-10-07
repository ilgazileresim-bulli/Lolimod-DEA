/* loliserver PANEL WEB SUNUCUSU
   Google ile giriş (Sign in with Google) yalnızca http(s) kaynaklardan çalışır;
   file:// ile açılan sayfalarda Google "Error 400: Hatalı istek" döndürür.
   Bu sunucu paneli http://localhost:27200 adresinden servis eder.
   Kullanım: node panel-server.js [--no-open]  ·  Port: LOLI_PANEL_PORT ortam değişkeni (varsayılan 27200) */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
const PORT = Number(process.env.LOLI_PANEL_PORT || 27200);
const OPEN = process.argv.indexOf("--no-open") < 0;
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8",
  ".vbs": "text/plain; charset=utf-8", ".bat": "text/plain; charset=utf-8"
};

function openBrowser(u) {
  try {
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", u], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    else if (process.platform === "darwin") spawn("open", [u], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [u], { detached: true, stdio: "ignore" }).unref();
  } catch (e) { }
}

const server = http.createServer(function (req, res) {
  let p = "/";
  try { p = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname); } catch (e) { }
  if (p === "/" || p === "") p = "/server.html";
  const file = path.join(ROOT, p);
  const rel = path.relative(ROOT, file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("403 Yasak");
    return;
  }
  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Bulunamadi");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, "127.0.0.1", function () {
  const url = "http://localhost:" + PORT + "/server.html";
  console.log("[loliserver-panel] Panel hazir: " + url);
  console.log("[loliserver-panel] Google Cloud Console > Yetkili JavaScript kaynaklarina bunu ekle: http://localhost:" + PORT);
  if (OPEN) openBrowser(url);
});

server.on("error", function (e) {
  if (e && e.code === "EADDRINUSE") {
    console.log("[loliserver-panel] Port " + PORT + " zaten calisiyor; panel aciliyor: http://localhost:" + PORT + "/server.html");
    if (OPEN) openBrowser("http://localhost:" + PORT + "/server.html");
    process.exit(0);
  } else {
    console.error("[loliserver-panel] Hata: " + ((e && e.message) || e));
    process.exit(1);
  }
});
