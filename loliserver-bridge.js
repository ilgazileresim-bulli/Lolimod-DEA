/* loliserver MOTORU (daemon) - Aternos mantigi, tamamen yerel. */
/* Panel klasor secmez; motor kendi sabit klasorunde (%LOCALAPPDATA%\loliserver) calisir. */
/* Gelistiriciler: loli ve bulliiii */
/* Kullanim: node loliserver-bridge.js [--open] [--boot] [--install] [--exit] [--stop] [--quiet]   (Node.js 14+) */
const http = require("http");
const https = require("https");
const net = require("net");
const dgram = require("dgram");
const crypto = require("crypto");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const ARGV = process.argv.slice(2);
const PORT = Number(process.env.LOLI_PORT || 27100);
const HOME = process.env.LOLI_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "loliserver");
const PANEL_FILE = path.join(HOME, "loliserver-panel.url");
const ENGINE_JSON = path.join(HOME, "loliserver.instance.json");
const LEGACY_JSON = path.join(__dirname, "loliserver.instance.json");
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Private-Network": "true" };
const VBS = path.join(HOME, "loli-start.vbs");
const BUILD = 8;
const PATHMARK = path.join(HOME, "bridge-path.txt");
const HOMEBRIDGE = path.join(HOME, "loliserver-bridge.js");
function has(f) { return ARGV.indexOf(f) >= 0; }
function DQ() { return String.fromCharCode(34); }
function BS() { return String.fromCharCode(92); }
function mk(d) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) { } return d; }
function slug(s) {
  const k = String(s || "loliserver").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return k || "loliserver";
}
/* motor asla sessizce olmesin: beklenmeyen hatalar loglanir ve calismaya devam eder */
process.on("uncaughtException", function (e) {
  try { console.log("[daemon] yakalanmayan hata (motor calismaya devam ediyor): " + ((e && e.stack) || e)); } catch (x) { }
});
process.on("unhandledRejection", function (e) {
  try { console.log("[daemon] islenmeyen promise hatasi: " + ((e && e.message) || e)); } catch (x) { }
});
let cfg = {
  name: "loliserver", software: "paper", softwareName: "Paper", version: "", jar: "", jarUrl: "",
  ramMin: 1024, ramMax: 2048, javaPath: "java", javaArgs: "", port: 25565,
  autoBoot: true, autoRestart: true, eula: false, eulaAccepted: false, schedules: [],
  userId: "", projectId: "",
  tunnelOn: true, tunnelSecret: "", tunnelAddr: ""
};
const LEGACY = fs.existsSync(LEGACY_JSON) && path.resolve(__dirname) !== path.resolve(HOME);
const CFG_FILE = LEGACY ? LEGACY_JSON : ENGINE_JSON;
try { Object.assign(cfg, JSON.parse(fs.readFileSync(CFG_FILE, "utf8"))); } catch (e) { }
const clients = new Set();
const bufs = new WeakMap();
const players = new Set();
const logs = [];
let child = null, state = "OFFLINE", startedAt = 0, dlPct = 0;
let stopping = false, crashN = 0, listTimer = null, restartTimer = null;
/* ---- tünel (playit.gg) durum değişkenleri ---- */
let tunProc = null, tunPollT = null, tunClaimT = null, tunBusy = false, tunPolling = false;
let tunSecret = cfg.tunnelSecret || "", tunClaim = "", tunAddr = cfg.tunnelAddr || "";
let tunSt = "", tunErr = "", tunCreateTried = "", tunUpdId = "", tunDied = 0, tunBorn = 0;
function saveCfg() { try { fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2)); } catch (e) { } }
function ensureEnv() {
  mk(HOME);
  if (process.env.LOLI_ROOT) {
    ROOT = process.env.LOLI_ROOT;
  } else if (cfg.userId && cfg.projectId) {
    ROOT = path.join(HOME, "users", cfg.userId, "projects", cfg.projectId);
  } else if (LEGACY) {
    ROOT = __dirname;
  } else {
    ROOT = path.join(HOME, "servers", slug(cfg.name));
  }
  mk(ROOT);
  ["plugins", "mods", "world", "logs", "backups"].forEach(function (d) { mk(path.join(ROOT, d)); });
  return ROOT;
}
let ROOT = __dirname;
ensureEnv();
saveCfg();
/* ---- ag yardimcilari: LAN/WAN IP, UPnP, guvenlik duvari, port testi ---- */
let wanIp = "", wanAt = 0, portOk = false, upnpState = "", upnpResult = "", preloading = false;
let pubOk = null, pubTestAt = 0, pubBusy = false, pubTimer = null, cgnat = false, rtrWan = "", gwCache = "";
function lanIp() {
  try {
    const ifs = os.networkInterfaces();
    const keys = Object.keys(ifs);
    for (let i = 0; i < keys.length; i++) {
      const arr = ifs[keys[i]] || [];
      for (let j = 0; j < arr.length; j++) {
        const x = arr[j];
        if (x.family === "IPv4" && !x.internal) return x.address;
      }
    }
  } catch (e) { }
  return "";
}
function fetchWan() {
  if (wanIp && Date.now() - wanAt < 600000) return;
  const get = function (u, n) {
    if (n > 2) return;
    try {
      const mod = u.indexOf("https:") === 0 ? https : http;
      const req = mod.get(u, { headers: { "User-Agent": "loliserver-daemon" } }, function (res) {
        let b = "";
        res.on("data", function (c) { b += c; });
        res.on("end", function () {
          const m = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.exec(b);
          if (m) { wanIp = m[0]; wanAt = Date.now(); bcast("[daemon] dis (public) IP: " + wanIp); cgnatCheck("genel IP"); }
        });
        res.resume();
      });
      req.on("error", function () { get(n === 0 ? "http://api.ipify.org" : "http://whatismyip.akamai.com", n + 1); });
      req.setTimeout(6000, function () { try { req.destroy(); } catch (e) { } });
    } catch (e) { }
  };
  get("https://api.ipify.org", 0);
}
function checkPort(port) {
  try {
    const s = net.connect({ host: "127.0.0.1", port: port, timeout: 3000 }, function () {
      portOk = true;
      bcast("[daemon] yerel port testi ✓: " + port + " dinleniyor (dis erisim ayri test edilir)");
      try { s.destroy(); } catch (e) { }
    });
    s.on("error", function () { portOk = false; try { s.destroy(); } catch (e) { } });
    s.on("timeout", function () { portOk = false; try { s.destroy(); } catch (e) { } });
  } catch (e) { }
}
function isPrivIp(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || ""));
  if (!m) return false;
  const a = +m[1], b = +m[2];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}
function gatewayHint() {
  if (gwCache) return gwCache;
  try {
    cp.exec("route print -4", { windowsHide: true, timeout: 6000 }, function (err, so) {
      if (err) return;
      const m = /0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}(?:\.\d{1,3}){3})/.exec(String(so));
      if (m && isPrivIp(m[1])) gwCache = m[1];
    });
  } catch (e) { }
  return lanIp() ? lanIp().replace(/\.\d+$/, ".1") : "192.168.1.1";
}
function netEvent() {
  bcast("@@loli:net pubOk=" + (pubOk === null ? "" : (pubOk ? 1 : 0)) + " cgnat=" + (cgnat ? 1 : 0) + " upnp=" + upnpResult + " rtrWan=" + rtrWan +
    " tun=" + tunSt + " tunAddr=" + encodeURIComponent(tunAddr || "") + " tunClaim=" + encodeURIComponent(tunClaim || "") + " tunErr=" + encodeURIComponent(tunErr || ""));
}
function cgnatCheck(reason) {
  if (!rtrWan || cgnat) return;
  if (isPrivIp(rtrWan) || (wanIp && rtrWan !== wanIp)) {
    cgnat = true;
    bcast("[daemon] CGNAT (" + reason + "): modemin dis IP'si " + rtrWan + ", genel IP " + (wanIp || "?") + " → arada ISS nat'i var");
    bcast("[daemon] CGNAT etkisi: modemden port acmak yetmez, internetten giris yine KAPALI kalir");
    bcast("[daemon] CGNAT cozumu: ISS'nden gercek (statik) IP iste ya da playit.gg gibi bir tunnel kullan");
    netEvent();
  }
}
function pubTest(port) {
  if (!port) port = cfg.port || 25565;
  if (pubBusy) return;
  if (state !== "ONLINE" && state !== "online") { bcast("[daemon] dis test: sunucu online degil, once sunucuyu baslat"); return; }
  pubBusy = true;
  pubTestAt = Date.now();
  bcast("[daemon] dis test basladi: port " + port + " internetten kontrol ediliyor (ifconfig.co)...");
  let done = false;
  const fin = function (ok) {
    if (done) return;
    done = true;
    pubBusy = false;
    if (ok === null) { bcast("[daemon] dis test: sonuc alinamadi, sonra tekrar denenir"); netEvent(); return; }
    pubOk = ok;
    pubTestAt = Date.now();
    if (ok) {
      bcast("[daemon] DIS TEST ✓: port " + port + " internetten erisilebiliyor → arkadaslarin " + (wanIp || "genel IP") + ":" + port + " adresiyle girebilir");
    } else {
      bcast("[daemon] DIS TEST ✗: port " + port + " disaridan KAPALI — localhost calisiyor ama internetten girilmiyor");
      bcast("[daemon] Cozum 1: modem yonetim paneli (http://" + gatewayHint() + ") → Port Yonlendirme/NAT → TCP+UDP " + port + " → " + (lanIp() || "bu bilgisayar") + " ekle");
      bcast("[daemon] Cozum 2: modemde UPnP kapaliysa ac; sonra panelde Yenile ile testi tekrarla");
      cgnatCheck("dis test");
      if (cgnat) bcast("[daemon] Not: CGNAT aktifken Cozum 1/2 yetmez → ISS'den gercek IP iste ya da tunnel kullan");
    }
    netEvent();
    schedulePubTest(port);
  };
  try {
    const req = https.get({ host: "ifconfig.co", path: "/port/" + port, family: 4, headers: { "User-Agent": "loliserver-daemon", "Accept": "application/json" }, timeout: 14000 }, function (res) {
      let b = "";
      res.on("data", function (c) { b += c; });
      res.on("end", function () {
        const m = /"reachable"\s*:\s*(true|false)/.exec(b);
        fin(m ? m[1] === "true" : null);
      });
    });
    req.on("timeout", function () { try { req.destroy(); } catch (e) { } pubTestFallback(port, fin); });
    req.on("error", function () { pubTestFallback(port, fin); });
  } catch (e) { pubTestFallback(port, fin); }
}
function pubTestFallback(port, fin) {
  const attempt = function (n) {
    if (n > 2 || !wanIp) { fin(null); return; }
    try {
      const req = https.get({ host: "check-host.net", path: "/check-tcp?host=" + wanIp + ":" + port + "&max_nodes=2", headers: { "User-Agent": "loliserver-daemon", "Accept": "application/json" }, timeout: 12000 }, function (res) {
        let b = "";
        res.on("data", function (c) { b += c; });
        res.on("end", function () {
          let id = "";
          try { id = String((JSON.parse(b) || {}).request_id || ""); } catch (e) { }
          if (!id) { setTimeout(function () { attempt(n + 1); }, 2000); return; }
          const poll = function (k) {
            try {
              const r2 = https.get({ host: "check-host.net", path: "/check-result/" + id, headers: { "User-Agent": "loliserver-daemon", "Accept": "application/json" }, timeout: 12000 }, function (res2) {
                let b2 = "";
                res2.on("data", function (c) { b2 += c; });
                res2.on("end", function () {
                  let ready = false, ok = null;
                  try {
                    const j = JSON.parse(b2) || {};
                    const keys = Object.keys(j);
                    for (let i = 0; i < keys.length; i++) {
                      const v = j[keys[i]];
                      if (!v || !v.length) continue;
                      ready = true;
                      const f0 = v[0];
                      if (Array.isArray(f0) && f0.length >= 2) ok = (ok === null) ? !!f0[1] : (ok || !!f0[1]);
                    }
                  } catch (e) { }
                  if (!ready && k < 6) { setTimeout(function () { poll(k + 1); }, 2500); return; }
                  fin(ok);
                });
              });
              r2.on("error", function () { if (k < 6) setTimeout(function () { poll(k + 1); }, 2500); else fin(null); });
            } catch (e) { fin(null); }
          };
          poll(0);
        });
      });
      req.on("error", function () { setTimeout(function () { attempt(n + 1); }, 2000); });
      req.on("timeout", function () { try { req.destroy(); } catch (e) { } });
    } catch (e) { setTimeout(function () { attempt(n + 1); }, 2000); }
  };
  attempt(0);
}
function schedulePubTest(port) {
  if (pubTimer) { clearTimeout(pubTimer); pubTimer = null; }
  if (pubOk === true) return;
  pubTimer = setTimeout(function () {
    pubTimer = null;
    if (state === "ONLINE" || state === "online") pubTest(port || cfg.port || 25565);
  }, 10 * 60 * 1000);
}
/* ---- TUNEL (playit.gg): port acmadan herkese acik adres (Aternos modu) ----
   Modemde port acmaya, CGNAT'e, guvenlik duvarina takilmadan disaridan giris:
   playit.gg aracisi (playit.exe) bizim cocuk surecimiz olarak calisir;
   tek seferlik onay https://playit.gg/claim/<kod> uzerinden yapilir. */
const TUN_BIN = path.join(HOME, "bin", "playit.exe");
const TUN_URL = "https://github.com/playit-cloud/playit-agent/releases/download/v1.0.10/playit-windows-x86_64.exe";
const TUN_URL2 = "https://github.com/playit-cloud/playit-agent/releases/latest/download/playit-windows-x86_64.exe";
function tunLog(m) { bcast("[tunel] " + m); }
function tunnelEnabled() { return process.platform === "win32" && cfg.tunnelOn !== false; }
function tunnelState() {
  return { on: cfg.tunnelOn !== false, st: tunSt, err: tunErr, addr: tunAddr, claim: tunClaim, claimed: !!tunSecret, proc: !!tunProc };
}
function tunSet(st, err) {
  tunSt = st || ""; tunErr = err || "";
  if (st === "err") tunLog("hata: " + tunErr);
  netEvent();
}
function tunApi(p, body, cb) {
  const fin = function (fn) { let d = false; return function (a, b) { if (d) return; d = true; fn(a, b); }; };
  const done = fin(cb);
  let data = "";
  try { data = JSON.stringify(body || {}); } catch (e) { data = "{}"; }
  const headers = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) };
  if (tunSecret) headers["Authorization"] = "Agent-Key " + tunSecret;
  try {
    const req = https.request({ host: "api.playit.gg", path: p, method: "POST", timeout: 15000, headers: headers }, function (res) {
      let b = "";
      res.on("data", function (c) { b += c; });
      res.on("end", function () {
        let j = null;
        try { j = JSON.parse(b || "{}"); } catch (e) { }
        if (j && j.status === "success") return done(null, j.data);
        if (j && j.status === "fail") return done(String(j.data || "api hatasi"), j.data);
        if (j && j.status === "error") return done("api hatasi", j.data);
        done("HTTP " + res.statusCode);
      });
    });
    req.on("error", function (e) { done((e && e.message) || "ag hatasi"); });
    req.on("timeout", function () { try { req.destroy(); } catch (e) { } });
    req.write(data); req.end();
  } catch (e) { done((e && e.message) || "istek hatasi"); }
}
function tunLocalPort(t) {
  try {
    const f = (t && t.agent_config && t.agent_config.fields) || [];
    for (let i = 0; i < f.length; i++) if (f[i] && f[i].name === "local_port") return Number(f[i].value) || 0;
  } catch (e) { }
  return 0;
}
function tunCreate(port) {
  tunApi("/tunnels/create", { name: "loliserver", port_type: "both", port_count: 1, origin: { type: "default", data: { local_ip: "127.0.0.1", local_port: port } }, enabled: true }, function (e) {
    if (e) { tunLog("tunel olusturulamadi: " + e + " (playit.gg sitesinden Minecraft tuneli de olusturabilirsin)"); return; }
    tunLog("tunel olusturuldu ✓ (yerel port " + port + ")");
  });
}
function tunPoll() {
  if (!tunnelEnabled() || !tunSecret || tunPolling) return;
  tunPolling = true;
  tunApi("/v1/agents/rundata", {}, function (e, d) {
    tunPolling = false;
    if (e) return;
    const ts = (d && d.tunnels) || [];
    const port = cfg.port || 25565;
    let pick = null, pickPort = 0;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      if (!t || t.disabled_reason) continue;
      const lp = tunLocalPort(t);
      if (!pick || (lp === port && pickPort !== port)) { pick = t; pickPort = lp; }
    }
    if (!pick) {
      if (tunCreateTried !== String(port)) { tunCreateTried = String(port); tunCreate(port); }
      return;
    }
    const addr = String(pick.display_address || "");
    if (addr && addr !== tunAddr) {
      tunAddr = addr; cfg.tunnelAddr = addr; saveCfg();
      tunSet("run", "");
      tunLog("TUNEL HAZIR ✓ herkese acik adres: " + addr);
      tunLog("Arkadaslarin girecegi adres: " + addr + "  (Minecraft → Cok Oyunculu → Sunucu Ekle)");
    }
    const lp = tunLocalPort(pick);
    if (lp && lp !== port && tunUpdId !== String(pick.id) + ":" + port) {
      tunUpdId = String(pick.id) + ":" + port;
      tunApi("/tunnels/update", { tunnel_id: pick.id, local_ip: "127.0.0.1", local_port: port, enabled: true }, function (e2) {
        if (!e2) { tunLog("tunel yerel porta yonlendirildi: " + port); tunAddr = ""; }
        else tunUpdId = "";
      });
    }
  });
}
function tunnelSpawn() {
  tunBorn = Date.now();
  try {
    tunProc = cp.spawn(TUN_BIN, ["--secret", tunSecret, "--socket-path", "\\\\.\\pipe\\loli-tunel", "--log-path", path.join(HOME, "logs", "playit.log")], { windowsHide: true, stdio: "ignore" });
    tunProc.on("error", function () { tunProc = null; });
    tunProc.on("exit", function () {
      if (Date.now() - tunBorn < 3000 && tunDied < 3) tunDied++;
      tunProc = null;
    });
    tunLog("playit aracisi baslatildi");
  } catch (e) { tunProc = null; }
}
function tunnelDown(tries) {
  if (!tunnelEnabled()) return;
  if (fs.existsSync(TUN_BIN)) { try { if (fs.statSync(TUN_BIN).size > 1048576) { tunnelRun(); return; } } catch (e) { } }
  mk(path.dirname(TUN_BIN));
  if (tunBusy) return;
  tunBusy = true;
  tunSet("run", "");
  tunLog("playit aracisi indiriliyor (tek seferlik ~5 MB)...");
  dl(tries ? TUN_URL2 : TUN_URL, TUN_BIN, function () { }, function (err) {
    tunBusy = false;
    if (err) {
      if (!tries) { tunnelDown(1); return; }
      tunSet("err", "araci indirilemedi: " + ((err && err.message) || err));
      return;
    }
    tunLog("playit aracisi indirildi ✓");
    tunAddr = ""; tunUpdId = ""; tunDied = 0;
    tunnelRun();
  });
}
function tunnelRun() {
  if (!tunnelEnabled()) return;
  if (!tunSecret) { tunnelClaim(); return; }
  if (tunProc) { tunPoll(); return; }
  try { if (fs.existsSync(TUN_BIN) && fs.statSync(TUN_BIN).size < 1048576) fs.unlinkSync(TUN_BIN); } catch (e) { }
  if (!fs.existsSync(TUN_BIN)) { tunnelDown(0); return; }
  tunSet("run", "");
  tunnelSpawn();
  if (tunPollT) clearInterval(tunPollT);
  tunPollT = setInterval(function () {
    if (!tunnelEnabled()) return;
    if (!tunProc) {
      if (tunDied >= 3) return; /* baska bir playit kopyasi pipe'i tutuyor olabilir; rundata yine de takip edilir */
      tunnelSpawn();
      return;
    }
    tunPoll();
  }, 12000);
  setTimeout(tunPoll, 4000);
}
function tunnelClaim() {
  if (!tunnelEnabled() || tunSecret || tunClaimT) return;
  tunSet("wait", "");
  const code = crypto.randomBytes(5).toString("hex");
  tunClaim = "https://playit.gg/claim/" + code;
  let setupOk = false, setupTries = 0;
  tunLog("ONAY GEREKLI (tek seferlik): tarayicida " + tunClaim + " ac → 'Add agent' de → 'Minecraft Java' sec → Create");
  netEvent();
  const setup = function () {
    if (tunSecret || !tunnelEnabled()) return;
    tunApi("/claim/setup", { code: code, agent_type: "self-managed", version: "playit 1.0.10" }, function (e, d) {
      if (tunSecret || !tunnelEnabled()) return;
      if (!e) {
        setupOk = true;
        if (d === "UserRejected") {
          if (tunClaimT) { clearInterval(tunClaimT); tunClaimT = null; }
          tunClaim = "";
          tunSet("err", "onay reddedildi — 'Tuneli baslat' ile yeniden dene");
        }
        return;
      }
      if (e === "CodeExpired" || e === "InvalidCode") {
        if (tunClaimT) { clearInterval(tunClaimT); tunClaimT = null; }
        tunClaim = "";
        tunnelClaim();
        return;
      }
      setupTries++;
      if (setupTries < 6) setTimeout(setup, 10000);
      else {
        tunSet("err", "playit.gg baglantisi kurulamadi (" + e + ") — 'Tuneli baslat' ile yeniden dene");
        if (tunClaimT) { clearInterval(tunClaimT); tunClaimT = null; }
      }
    });
  };
  tunClaimT = setInterval(function () {
    if (!tunnelEnabled()) { clearInterval(tunClaimT); tunClaimT = null; return; }
    if (tunSecret) { clearInterval(tunClaimT); tunClaimT = null; return; }
    tunApi("/claim/exchange", { code: code }, function (e, d) {
      if (tunSecret || !tunnelEnabled()) return;
      if (!e && d && d.secret_key) {
        tunSecret = String(d.secret_key);
        cfg.tunnelSecret = tunSecret; saveCfg();
        clearInterval(tunClaimT); tunClaimT = null; tunClaim = "";
        tunLog("hesap onaylandi ✓ — tunel kuruluyor...");
        netEvent();
        tunnelRun();
        return;
      }
      if (e === "CodeExpired") { clearInterval(tunClaimT); tunClaimT = null; tunClaim = ""; tunnelClaim(); return; }
      if (e === "UserRejected") { clearInterval(tunClaimT); tunClaimT = null; tunClaim = ""; tunSet("err", "onay reddedildi — 'Tuneli baslat' ile yeniden dene"); return; }
      if (!setupOk && e === "CodeNotFound") setup();
    });
  }, 5000);
  setup();
}
function tunnelKick(delay) {
  if (!tunnelEnabled()) return;
  setTimeout(function () {
    if (!tunnelEnabled()) return;
    if (tunSecret) { if (!tunProc && !tunPollT) tunnelRun(); else tunPoll(); }
    else if (!tunClaimT) tunnelClaim();
  }, delay || 0);
}
function tunnelStop(killProc) {
  if (tunClaimT) { clearInterval(tunClaimT); tunClaimT = null; }
  if (tunPollT) { clearInterval(tunPollT); tunPollT = null; }
  if (killProc && tunProc) { try { tunProc.kill(); } catch (e) { } tunProc = null; }
  tunSt = ""; tunClaim = "";
  netEvent();
}
function panelUrl() { try { return fs.existsSync(PANEL_FILE) ? String(fs.readFileSync(PANEL_FILE, "utf8")).trim() : ""; } catch (e) { return ""; } }
function writePanelUrl(u) { try { if (u) fs.writeFileSync(PANEL_FILE, String(u).trim()); } catch (e) { } }
function bcast(line) {
  const txt = String(line);
  if (txt.indexOf("@@loli:") !== 0) {
    process.stdout.write(txt + "\n");
    logs.push(txt);
    if (logs.length > 900) logs.shift();
  }
  const payload = Buffer.from(txt, "utf8");
  let head;
  if (payload.length < 126) { head = Buffer.alloc(2); head[1] = payload.length; }
  else if (payload.length < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(payload.length, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(payload.length), 2); }
  head[0] = 0x81;
  const frame = Buffer.concat([head, payload]);
  clients.forEach(function (s) { try { s.write(frame); } catch (e) { } });
}
function statusObj() {
  return {
    ok: 1, state: state, name: cfg.name, software: cfg.software, softwareName: cfg.softwareName || "",
    version: cfg.version || "", jar: cfg.jar || "server.jar", jarReady: fs.existsSync(path.join(ROOT, cfg.jar || "server.jar")),
    port: cfg.port || 25565, ramMin: cfg.ramMin, ramMax: cfg.ramMax, javaPath: cfg.javaPath || "java",
    pid: child ? child.pid : 0, uptime: startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0, dlPct: dlPct,
    players: Array.from(players), clients: clients.size, autoBoot: cfg.autoBoot !== false, autoRestart: cfg.autoRestart !== false,
    build: BUILD, limit: "sure limiti yok", dir: ROOT, home: HOME, port27100: PORT, node: process.version, platform: process.platform,
    logs: logs.length, lan: lanIp(), wan: wanIp, portOk: portOk, pubOk: pubOk, pubTestAt: pubTestAt, upnp: upnpResult, cgnat: cgnat, rtrWan: rtrWan,
    tunSt: tunSt, tunAddr: tunAddr, tunClaim: tunClaim, tunErr: tunErr, tunnelOn: cfg.tunnelOn !== false,
    userId: cfg.userId || "", projectId: cfg.projectId || "", eulaAccepted: cfg.eulaAccepted || false
  };
}
function ping() {
  return {
    ok: 1, state: state, name: cfg.name, softwareName: cfg.softwareName || "", version: cfg.version || "",
    port: cfg.port || 25565, pid: child ? child.pid : 0, uptime: startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0,
    players: players.size, dir: ROOT, home: HOME, jar: cfg.jar || "", api: PORT, node: process.version, build: BUILD, lan: lanIp(), wan: wanIp, portOk: portOk, pubOk: pubOk, pubTestAt: pubTestAt, upnp: upnpResult, cgnat: cgnat, rtrWan: rtrWan,
    tunSt: tunSt, tunAddr: tunAddr, tunClaim: tunClaim, tunErr: tunErr, tunnelOn: cfg.tunnelOn !== false,
    userId: cfg.userId || "", projectId: cfg.projectId || ""
  };
}
function setState(s, msg) {
  const valid = ["OFFLINE", "STARTING", "ONLINE", "STOPPING", "CRASHED", "loading", "stopped"];
  const sUp = s.toUpperCase();
  if (valid.indexOf(sUp) < 0 && valid.indexOf(s) < 0) return;
  const oldState = state;
  state = s;
  bcast("@@loli:state " + s);
  bcast("[daemon] durum: " + s + (msg ? " · " + msg : ""));
  if (s === "ONLINE" || s === "online") {
    crashN = 0;
    fetchWan();
    setTimeout(function () { upnpOpen(cfg.port || 25565); }, 600);
    setTimeout(function () { checkPort(cfg.port || 25565); }, 1500);
    setTimeout(function () { pubTest(cfg.port || 25565); }, 20000);
  }
  if (s === "CRASHED") {
    bcast("[daemon] \u26a0 SUNUCU COKTU! Otomatik yeniden baslatma deneniyor...");
    if (cfg.autoRestart !== false && crashN < 3) {
      crashN++;
      setTimeout(function () { setState("STARTING", "yeniden baslatma " + crashN + "/3"); startServer(); }, 6000);
    }
  }
  if (oldState !== s) bcast("@@loli:stateChange " + oldState + "\u2192" + s);
}
function setPlayers() { bcast("@@loli:players " + Array.from(players).join(",")); }
function track(l) {
  let m = /: ([A-Za-z0-9_.]{1,16}) joined the game/.exec(l);
  if (m) { players.add(m[1]); setPlayers(); }
  m = /: ([A-Za-z0-9_.]{1,16}) left the game/.exec(l);
  if (m) { players.delete(m[1]); setPlayers(); }
  m = /There are (\d+) of a max of (\d+) players online:?\s*(.*)$/.exec(l);
  if (m) {
    players.clear();
    String(m[3] || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (x) { players.add(x); });
    bcast("[daemon] oyuncular: " + (players.size ? Array.from(players).join(", ") : "yok") + " (" + m[1] + "/" + m[2] + ")");
    setPlayers();
  }
}
function pump(d) {
  String(d).split(/\r?\n/).forEach(function (l) {
    if (!l.length) return;
    if (/Done \(/.test(l) && state !== "ONLINE" && state !== "online") { setState("ONLINE"); }
    track(l);
    bcast(l);
  });
}
function ensureFiles() {
  const eula = path.join(ROOT, "eula.txt");
  try {
    if (!fs.existsSync(eula)) {
      if (cfg.eulaAccepted || cfg.eula) {
        fs.writeFileSync(eula, "# loliserver - kullanici onayi ile\r\neula=true\r\n");
        bcast("[daemon] eula.txt olusturuldu (eula=true, kullanici onayladi)");
      } else {
        fs.writeFileSync(eula, "# loliserver - EULA henuz onaylanmadi\r\neula=false\r\n");
        bcast("[daemon] eula.txt olusturuldu (eula=false) - Panelden EULA'yı kabul etmelisin");
      }
    } else {
      const txt = String(fs.readFileSync(eula, "utf8"));
      if (cfg.eulaAccepted || cfg.eula) {
        if (/eula\s*=\s*false/i.test(txt)) {
          fs.writeFileSync(eula, txt.replace(/eula\s*=\s*false/gi, "eula=true"));
          bcast("[daemon] eula=false -> eula=true (kullanici panelden onayladi)");
        }
      }
    }
  } catch (e) { }
  const props = path.join(ROOT, "server.properties");
  if (!fs.existsSync(props)) {
    try {
      fs.writeFileSync(props, "motd=" + cfg.name + " · loliserver\r\ngamemode=survival\r\ndifficulty=easy\r\nmax-players=20\r\nonline-mode=false\r\nenable-rcon=false\r\nview-distance=8\r\nserver-ip=\r\nserver-port=" + (cfg.port || 25565) + "\r\n");
      bcast("[daemon] server.properties olusturuldu (port " + (cfg.port || 25565) + ")");
    } catch (e) { }
  } else {
    try {
      let txt = String(fs.readFileSync(props, "utf8"));
      const m = /^server-ip\s*=\s*(\S+)/mi.exec(txt);
      if (m && m[1] !== "0.0.0.0") {
        txt = txt.replace(/^server-ip\s*=.*$/mi, "server-ip=");
        bcast("[daemon] server-ip bosaltildi (tum ag arayuzleri) → Minecraft baglantisi icin");
      }
      const pm = /^server-port\s*=\s*(\d+)/mi.exec(txt);
      const wantPort = String(cfg.port || 25565);
      if (pm && pm[1] !== wantPort) {
        txt = txt.replace(/^server-port\s*=\s*\d+/mi, "server-port=" + wantPort);
        bcast("[daemon] server-port " + pm[1] + " → " + wantPort + " (yapilandirma guncellendi)");
      }
      fs.writeFileSync(props, txt);
    } catch (e) { }
  }
}
function dl(url, dest, onPct, done, retries) {
  retries = retries || 0;
  const maxRetry = 3;
  const mod = url.indexOf("https:") === 0 ? https : http;
  const tmp = dest + ".part";
  const label = path.basename(dest);
  function retryErr(err) {
    if (retries < maxRetry) {
      bcast("[daemon] \u26a0 " + label + " indirme hatasi (" + err + ") " + (retries + 1) + "/" + maxRetry + " yeniden deneniyor...");
      return setTimeout(function () { dl(url, dest, onPct, done, retries + 1); }, 3000);
    }
    return done(new Error(err + " (" + maxRetry + " deneme)"));
  }
  try {
    const req = mod.get(url, { headers: { "User-Agent": "loliserver-daemon" } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const nx = res.headers.location.indexOf("http") === 0 ? res.headers.location : url.replace(/\/[^\/]*$/, "/") + res.headers.location.replace(/^\.\//, "");
        return dl(nx, dest, onPct, done, retries);
      }
      function retryErr2(err2) {
        if (retries < maxRetry) {
          bcast("[daemon] \u26a0 " + label + " indirme hatasi (" + err2 + ") " + (retries + 1) + "/" + maxRetry + " yeniden deneniyor...");
          return setTimeout(function () { dl(url, dest, onPct, done, retries + 1); }, 3000);
        }
        return done(new Error(err2 + " (" + maxRetry + " deneme)"));
      }
      if (res.statusCode !== 200) { res.resume(); return retryErr2("HTTP " + res.statusCode); }
      const total = Number(res.headers["content-length"] || 0);
      let got = 0;
      let lastPct = -1;
      const ws = fs.createWriteStream(tmp);
      res.on("data", function (c) {
        got += c.length;
        if (total) {
          const pct = Math.min(99, Math.round((got / total) * 100));
          if (pct !== lastPct) { lastPct = pct; onPct(pct); }
        }
      });
      res.pipe(ws);
      ws.on("finish", function () { try { fs.renameSync(tmp, dest); } catch (e) { } onPct(100); done(null); });
      ws.on("error", function (e) { retryErr2(e && e.message || "yazma hatasi"); });
    });
    req.on("error", function (e) { retryErr(e && e.message || "baglanti hatasi"); });
    req.setTimeout(90000, function () { try { req.destroy(new Error("zaman asimi 90sn")); } catch (e) { } });
  } catch (e) { retryErr(e && e.message || "baslatma hatasi"); }
}
/* ---- Java otomatik tespit + kurulum: 'spawn java ENOENT' bir daha cikmaz ---- */
let javaState = { path: "", ver: 0, done: false, pending: null, failedAt: 0 };
let javaRetryN = 0;
function javaExe() { return process.platform === "win32" ? "java.exe" : "java"; }
function subDirs(root) { let out = []; try { out = fs.readdirSync(root).map(function (n) { return path.join(root, n); }).filter(function (p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }); } catch (e) { } return out; }
function javaVerOf(exe) {
  try {
    const r = cp.spawnSync(exe, ["-version"], { timeout: 12000, windowsHide: true });
    if (r.error) return 0;
    const m = /version "(\d+)(?:\.(\d+))?[^\"]*"/.exec(String(r.stdout || "") + " " + String(r.stderr || ""));
    if (!m) return 0;
    let major = Number(m[1]);
    if (major === 1 && m[2]) major = Number(m[2]);
    return major > 0 ? major : 0;
  } catch (e) { return 0; }
}
function runtimeRoot() { return path.join(HOME, "runtime"); }
function runtimeJava() { let found = ""; subDirs(runtimeRoot()).some(function (d) { const j = path.join(d, "bin", javaExe()); if (fs.existsSync(j)) { found = j; return true; } return false; }); return found; }
function whereJavaList() {
  try {
    const r = cp.spawnSync(process.platform === "win32" ? "where" : "which", ["java"], { timeout: 10000, windowsHide: true });
    return String(r.stdout || "").split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  } catch (e) { return []; }
}
function javaCandidates() {
  const list = [];
  const add = function (p) { if (p && list.indexOf(p) < 0) list.push(p); };
  ["JAVA_HOME", "JDK_HOME"].forEach(function (k) { if (process.env[k]) add(path.join(process.env[k], "bin", javaExe())); });
  const pf = process.env["ProgramFiles"] || path.join("C:", "Program Files");
  const pf86 = process.env["ProgramFiles(x86)"] || path.join("C:", "Program Files (x86)");
  const lad = process.env["LOCALAPPDATA"] || path.join(os.homedir(), "AppData", "Local");
  const appd = process.env["APPDATA"] || path.join(os.homedir(), "AppData", "Roaming");
  [pf, pf86, path.join(lad, "Programs")].forEach(function (root) {
    subDirs(root).forEach(function (vendor) {
      add(path.join(vendor, "bin", javaExe()));
      subDirs(vendor).forEach(function (sub) { add(path.join(sub, "bin", javaExe())); });
    });
  });
  [path.join(appd, ".minecraft", "runtime"), path.join(lad, "Packages", "Microsoft.4297127D64EC6_8wekyb3d8bbwe", "LocalCache", "Local", "runtime")].forEach(function (root) {
    subDirs(root).forEach(function (a) {
      add(path.join(a, "bin", javaExe()));
      subDirs(a).forEach(function (b) {
        add(path.join(b, "bin", javaExe()));
        subDirs(b).forEach(function (c) { add(path.join(c, "bin", javaExe())); });
      });
    });
  });
  add(runtimeJava());
  return list;
}
function pickBestJava(cands) {
  let best = null;
  cands.forEach(function (p) {
    if (!p || !fs.existsSync(p)) return;
    const v = javaVerOf(p);
    if (v > 0 && (!best || v > best.v)) best = { p: p, v: v };
  });
  return best;
}
function findJava(cb) {
  const pref = String(cfg.javaPath || "").trim();
  if (pref && pref !== "java" && fs.existsSync(pref)) {
    const v = javaVerOf(pref);
    if (v > 0) return cb(pref, v);
  }
  const cands = javaCandidates();
  whereJavaList().forEach(function (w) { if (cands.indexOf(w) < 0) cands.push(w); });
  const b = pickBestJava(cands);
  cb(b ? b.p : "", b ? b.v : 0);
}
const JAVA_DL_URL = "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse?project=jdk";
function installJava(cb) {
  if (process.platform !== "win32") return cb("", 0);
  const root = runtimeRoot();
  mk(root);
  const zip = path.join(root, "temurin-21-jre.zip");
  bcast("[daemon] sistemde Java bulunamadi · Java 21 otomatik indiriliyor (adoptium.net)...");
  setState("loading", "Java 21 indiriliyor");
  dlPct = 0;
  dl(JAVA_DL_URL, zip, function (p) { if (p - dlPct >= 4) { dlPct = p; bcast("[daemon] Java 21 indiriliyor %" + p); } }, function (err) {
    if (err) { bcast("[daemon] Java indirme hatasi: " + err.message + " · bir sure sonra tekrar Baslat'a bas"); return cb("", 0); }
    dlPct = 100;
    bcast("[daemon] Java 21 indirildi · arsiv aciliyor...");
    try {
      cp.spawnSync("tar", ["-xf", zip, "-C", root], { windowsHide: true, timeout: 300000 });
      if (!runtimeJava()) {
        const ps = "Expand-Archive -LiteralPath '" + zip + "' -DestinationPath '" + root + "' -Force";
        cp.spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { windowsHide: true, timeout: 300000 });
      }
    } catch (e) { }
    try { fs.unlinkSync(zip); } catch (e) { }
    const j = runtimeJava();
    const v = j ? javaVerOf(j) : 0;
    if (!j || v <= 0) { bcast("[daemon] Java 21 kurulamadi · manuel kurulum: https://adoptium.net/temurin/releases/?version=21"); return cb("", 0); }
    cb(j, v);
  });
}
function ensureJava(force, cb) {
  if (typeof force === "function") { cb = force; force = false; }
  if (!force && javaState.path && javaState.done) return cb(javaState.path, javaState.ver);
  if (!force && javaState.failedAt && Date.now() - javaState.failedAt < 30000) return cb("", 0);
  if (javaState.pending) { javaState.pending.push(cb); return; }
  const waiters = [cb];
  javaState.pending = waiters;
  const fin = function (p, v) {
    javaState.pending = null;
    if (p) {
      javaState.path = p; javaState.ver = v; javaState.done = true; javaState.failedAt = 0;
      if (cfg.javaPath !== p) { cfg.javaPath = p; saveCfg(); }
      bcast("[daemon] Java hazir: v" + v + " · " + p);
    } else {
      javaState.done = false;
      javaState.failedAt = Date.now();
    }
    waiters.forEach(function (w) { try { w(javaState.path, javaState.ver); } catch (e) { } });
  };
  findJava(function (p, v) {
    if (p) return fin(p, v);
    installJava(function (p2, v2) { fin(p2, v2); });
  });
}
function javaFailHelp() {
  bcast("[daemon] HATA: Java bulunamadi ve otomatik kurulum basarisiz oldu.");
  bcast("[daemon] Cozum 1: internetini kontrol et, bir sure sonra tekrar Baslat'a bas (Java 21 otomatik indirilecek).");
  bcast("[daemon] Cozum 2: https://adoptium.net adresinden Java 21 kur, ya da Ayarlar'daki Java yolunu elle gir.");
  setState("offline", "java yok");
}
function upnpOpen(port) {
  if (process.platform !== "win32" || !port) return;
  if (upnpState === String(port)) return;
  upnpState = String(port);
  const me = lanIp() || "127.0.0.1";
  const failMsg = function (why) {
    if (upnpResult !== "ok") upnpResult = "fail";
    bcast("[daemon] UPnP: " + why);
    bcast("[daemon] Elle port acma: modem yonetim paneli (http://" + gatewayHint() + ") → Port Yonlendirme/NAT → TCP+UDP " + port + " → " + me + " ekle, kaydet");
    netEvent();
  };
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  let found = false, closed = false, tcpOk = false;
  const fin = function () { if (!closed) { closed = true; try { sock.close(); } catch (e) { } } };
  const timer = setTimeout(function () { if (!found) failMsg("router yanit vermedi (UPnP kapali olabilir)"); fin(); }, 5000);
  sock.on("error", function () { });
  sock.on("message", function (buf) {
    if (found) return;
    const m = /location:\s*(http[^\r\n]+)/i.exec(buf.toString());
    if (!m) return;
    found = true;
    clearTimeout(timer);
    let base = null;
    try { base = new URL(m[1].trim()); } catch (e) { failMsg("router bilgisi okunamadi"); fin(); return; }
    fetch(base.href, { headers: { "User-Agent": "loliserver-daemon" } }).then(function (r) { return r.text(); }).then(function (xml) {
      const svcs = [];
      const re = /<service>([\s\S]*?)<\/service>/gi;
      let mm;
      while ((mm = re.exec(xml))) {
        const t = /<serviceType>([^<]+)<\/serviceType>/i.exec(mm[1]);
        const c = /<controlURL>([^<]+)<\/controlURL>/i.exec(mm[1]);
        if (t && c && /WAN(IP|PPP)Connection/i.test(t[1])) svcs.push({ type: t[1], ctrl: c[1].trim() });
      }
      if (!svcs.length) { failMsg("routerda port-acma servisi yok (UPnP desteklemiyor olabilir)"); fin(); return; }
      const getWan = function (i, cb) {
        if (closed) return cb("");
        let cu = svcs[i].ctrl;
        try { cu = new URL(cu, base).href; } catch (e) { return cb(""); }
        const gb = "<?xml version='1.0'?><s:Envelope xmlns:s='http://schemas.xmlsoap.org/soap/envelope/' s:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'><s:Body><u:GetExternalIPAddress xmlns:u='" + svcs[i].type + "'></u:GetExternalIPAddress></s:Body></s:Envelope>";
        fetch(cu, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", "SOAPACTION": DQ() + svcs[i].type + DQ() + "#GetExternalIPAddress" }, body: gb }).then(function (r) { return r.text(); }).then(function (tx) {
          const m2 = /<NewExternalIPAddress>\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})\s*<\/NewExternalIPAddress>/i.exec(tx || "");
          cb(m2 ? m2[1] : "");
        }).catch(function () { cb(""); });
      };
      getWan(0, function (rw) { if (rw) { rtrWan = rw; cgnatCheck("router WAN"); netEvent(); } });
      const map = function (i, proto) {
        if (closed) return;
        if (i >= svcs.length) { if (!tcpOk) failMsg("router port acmayi reddetti"); fin(); return; }
        let cu = svcs[i].ctrl;
        try { cu = new URL(cu, base).href; } catch (e) { }
        const body = "<?xml version='1.0'?><s:Envelope xmlns:s='http://schemas.xmlsoap.org/soap/envelope/' s:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'><s:Body><u:AddPortMapping xmlns:u='" + svcs[i].type + "'><NewRemoteHost></NewRemoteHost><NewExternalPort>" + port + "</NewExternalPort><NewProtocol>" + proto + "</NewProtocol><NewInternalPort>" + port + "</NewInternalPort><NewInternalClient>" + me + "</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>loliserver MC</NewPortMappingDescription><NewLeaseDuration>0</NewLeaseDuration></u:AddPortMapping></s:Body></s:Envelope>";
        fetch(cu, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", "SOAPACTION": DQ() + svcs[i].type + DQ() + "#AddPortMapping" }, body: body }).then(function (r) { return r.text().then(function () { return r.ok; }); }).then(function (ok) {
          if (ok) {
            if (closed) return;
            if (proto === "TCP") { tcpOk = true; upnpResult = "ok"; bcast("[daemon] UPnP ✓: routerda " + port + "/TCP acildi → dis erisim test ediliyor"); netEvent(); map(i, "UDP"); }
            else { bcast("[daemon] UPnP ✓: routerda " + port + "/UDP acildi"); fin(); }
          } else { map(i + 1, proto); }
        }).catch(function () { map(i + 1, proto); });
      };
      map(0, "TCP");
    }).catch(function () { failMsg("router bilgisi okunamadi"); fin(); });
  });
  try {
    sock.bind(function () {
      ["urn:schemas-upnp-org:service:WANIPConnection:1", "urn:schemas-upnp-org:service:WANPPPConnection:1"].forEach(function (st) {
        const q = "M-SEARCH * HTTP/1.1\r\nHOST:239.255.255.250:1900\r\nMAN:" + DQ() + "ssdp:discover" + DQ() + "\r\nMX:2\r\nST:" + st + "\r\n\r\n";
        try { sock.send(q, 0, q.length, 1900, "239.255.255.250"); } catch (e) { }
      });
    });
  } catch (e) { fin(); }
}
function ensureFirewall(port, allowElevate) {
  if (process.platform !== "win32" || !port) return;
  const nmT = "loliserver MC TCP " + port;
  const nmU = "loliserver MC UDP " + port;
  cp.exec("netsh advfirewall firewall show rule name=" + DQ() + nmT + DQ(), { windowsHide: true, timeout: 8000 }, function (err, so) {
    if (!err && String(so).indexOf(nmT) >= 0) return;
    const add = "netsh advfirewall firewall add rule name=" + DQ() + nmT + DQ() + " dir=in action=allow protocol=TCP localport=" + port + " profile=any\r\nnetsh advfirewall firewall add rule name=" + DQ() + nmU + DQ() + " dir=in action=allow protocol=UDP localport=" + port + " profile=any";
    cp.exec(add.replace(/\r\n/g, " & "), { windowsHide: true, timeout: 15000 }, function (e2) {
      if (!e2) { bcast("[daemon] guvenlik duvari kurali eklendi: port " + port + " TCP+UDP ✓"); return; }
      if (!allowElevate) return;
      const ps1 = path.join(HOME, "fw-ac.ps1");
      try { fs.writeFileSync(ps1, add + "\r\n"); } catch (e) { return; }
      bcast("[daemon] Windows guvenlik duvari icin yonetici izni gerekiyor → UAC penceresine bir kez 'Evet' de");
      try { cp.spawn("powershell", ["-NoProfile", "-Command", "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','" + ps1 + "'"], { windowsHide: true, detached: true, stdio: "ignore" }).unref(); } catch (e) { }
    });
  });
}
function preloadJar() {
  if (child || preloading) return;
  const jar = cfg.jar || "server.jar";
  if (!cfg.jarUrl || fs.existsSync(path.join(ROOT, jar))) return;
  preloading = true;
  bcast("[daemon] on yukleme: " + jar + " arka planda indiriliyor (Baslat'a basınca anında açılır)");
  dl(cfg.jarUrl, path.join(ROOT, jar), function () { }, function (err) {
    preloading = false;
    if (err) { bcast("[daemon] on yukleme hatasi: " + err.message + " (Baslat'ta tekrar denenir)"); return; }
    let mb = 0;
    try { mb = Math.round(fs.statSync(path.join(ROOT, jar)).size / 1048576); } catch (e) { }
    bcast("[daemon] " + jar + " on yuklendi (" + mb + " MB) — Baslat → anında açılış ✓");
  });
}
function spawnJar() {
  if (child) return;
  javaRetryN = 0;
  ensureJava(false, function (jp, jv) { if (!jp) javaFailHelp(); else launchJava(jp, jv); });
}
function javaRetry(oldPath) {
  if (javaRetryN >= 2) return javaFailHelp();
  javaRetryN++;
  javaState.done = false;
  javaState.path = "";
  bcast("[daemon] Java calistirilamadi (" + oldPath + ") · otomatik tespit/kurulum yeniden deneniyor...");
  ensureJava(true, function (jp, jv) { if (!jp) javaFailHelp(); else launchJava(jp, jv); });
}
function launchJava(jp, jv) {
  if (child) return;
  ensureFirewall(cfg.port || 25565, true);
  ensureFiles();
  const jar = cfg.jar || "server.jar";
  if (!fs.existsSync(path.join(ROOT, jar))) { bcast("[daemon] HATA: " + jar + " bulunamadi"); setState("offline", "jar yok"); return; }
  const args = ["-Xms" + (cfg.ramMin || 1024) + "M", "-Xmx" + (cfg.ramMax || 2048) + "M"];
  if (!String(cfg.javaArgs || "").trim()) args.push("-XX:+UnlockExperimentalVMOptions", "-XX:+UseG1GC", "-XX:G1NewSizePercent=20", "-XX:G1ReservePercent=20", "-XX:MaxGCPauseMillis=50", "-XX:G1HeapRegionSize=16M");
  String(cfg.javaArgs || "").split(/\s+/).filter(Boolean).forEach(function (a) { args.push(a); });
  args.push("-jar", jar, "nogui");
  setState("starting", jp + " · " + jar + " · " + (cfg.ramMax || 2048) + " MB");
  bcast("[daemon] Java v" + (jv || javaState.ver || "?") + " ile baslatiliyor: " + jp);
  let proc = null;
  try { proc = cp.spawn(jp, args, { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], windowsHide: true }); } catch (e) { proc = null; }
  if (!proc) return javaRetry(jp);
  child = proc;
  stopping = false;
  startedAt = Date.now();
  child.stdout.on("data", pump);
  child.stderr.on("data", pump);
  child.on("exit", function (code) {
    if (child !== proc) return;
    const up = Date.now() - startedAt;
    child = null;
    startedAt = 0;
    dlPct = 0;
    if (listTimer) { clearInterval(listTimer); listTimer = null; }
    if (players.size) { players.clear(); setPlayers(); }
    bcast("[daemon] sunucu kapandi (cikis kodu " + code + ")");
    if (stopping) { setState("OFFLINE", "durduruldu"); return; }
    if (code !== 0 && cfg.autoRestart !== false && crashN < 3 && up > 4000) {
      crashN++;
      setState("CRASHED", "cikis kodu " + code);
      bcast("[daemon] cokme algilandi · " + crashN + "/3 otomatik yeniden baslatma (6 sn)");
      restartTimer = setTimeout(startServer, 6000);
      return;
    }
    setState("OFFLINE", "kapandi");
  });
  child.on("error", function (e) {
    if (child !== proc) return;
    child = null;
    if (e && e.code === "ENOENT") return javaRetry(jp);
    bcast("[daemon] HATA: " + e.message);
    setState("offline");
  });
  if (listTimer) clearInterval(listTimer);
  listTimer = setInterval(function () { if (child) { try { child.stdin.write("list\n"); } catch (e) { } } }, 45000);
}
function startServer() {
  if (child) { bcast("[daemon] sunucu zaten calisiyor"); return; }
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  crashN = 0;
  stopping = false;
  ensureEnv();
  /* EULA kontrolu */
  if (!cfg.eulaAccepted && !cfg.eula) {
    bcast("[daemon] \u26a0 Minecraft EULA henuz onaylanmadi! Panelden kabul etmelisin.");
    setState("OFFLINE", "EULA onayi gerekli");
    return;
  }
  bcast("[daemon] baslatma · " + cfg.name + " · " + (cfg.softwareName || cfg.software) + " " + cfg.version + " · " + (cfg.ramMin || 1024) + "-" + (cfg.ramMax || 2048) + " MB · port " + (cfg.port || 25565));
  setState("STARTING", "JAR kontrolu");
  const jar = cfg.jar || "server.jar";
  if (fs.existsSync(path.join(ROOT, jar))) { setState("STARTING", "Java baslatiliyor"); spawnJar(); return; }
  if (!cfg.jarUrl) { bcast("[daemon] HATA: " + jar + " yok ve indirme adresi tanimli degil (panelden Baslat)"); setState("OFFLINE", "jar yok"); return; }
  dlPct = 0;
  setState("STARTING", jar + " indiriliyor");
  dl(cfg.jarUrl, path.join(ROOT, jar), function (p) { if (p - dlPct >= 4) { dlPct = p; bcast("[daemon] indiriliyor %" + p); } }, function (err) {
    if (err) { bcast("[daemon] HATA indirme: " + err.message + " · " + cfg.jarUrl); setState("OFFLINE", "indirme hatasi"); return; }
    dlPct = 100;
    let mb = 0;
    try { mb = Math.round(fs.statSync(path.join(ROOT, jar)).size / 1048576); } catch (e) { }
    bcast("[daemon] indirildi: " + jar + " (" + mb + " MB)");
    setState("STARTING", "Java baslatiliyor");
    spawnJar();
  });
}
function stopServer() {
  if (!child) { bcast("[daemon] sunucu zaten kapali"); return; }
  stopping = true;
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  setState("STOPPING", "dunya kaydediliyor");
  try { child.stdin.write("stop\n"); } catch (e) { }
  setTimeout(function () { if (child) { try { child.kill(); } catch (e) { } } }, 25000);
}
function restartServer() {
  if (!child) { startServer(); return; }
  stopping = true;
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  setState("STOPPING", "yeniden baslatma");
  bcast("[daemon] yeniden baslatma: dunya kaydediliyor...");
  try { child.stdin.write("save-all\n"); } catch (e) { }
  setTimeout(function () { try { child.stdin.write("stop\n"); } catch (e) { } }, 600);
  setTimeout(function () { stopping = false; startServer(); }, 9000);
}
function openFolder(which) {
  const d = which === "downloads" ? path.join(os.homedir(), "Downloads") : ROOT;
  try {
    const p = cp.spawn("explorer", [d], { detached: true, stdio: "ignore", windowsHide: true });
    p.on("error", function () { });
    p.unref();
    bcast("[daemon] klasor acildi: " + d);
  } catch (e) { }
  return d;
}
function openPanel() {
  let u = panelUrl();
  if (!u) u = "http://127.0.0.1:" + PORT + "/";
  try {
    const p = cp.spawn("cmd", ["/c", "start", "", u], { detached: true, stdio: "ignore", windowsHide: true });
    p.on("error", function () { });
    p.unref();
    bcast("[daemon] panel aciliyor: " + u);
  } catch (e) { bcast("[daemon] panel acilamadi: " + e.message); }
}
function backup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const zip = path.join(ROOT, "backups", "dunya-" + stamp + ".zip");
  const world = path.join(ROOT, "world");
  if (!fs.existsSync(world)) { bcast("[daemon] yedek: world klasoru yok"); return { ok: false, why: "world yok" }; }
  bcast("[daemon] yedek aliniyor: " + path.basename(zip));
  try {
    cp.spawnSync("powershell", ["-NoProfile", "-Command", "Compress-Archive -Path '" + world + "' -DestinationPath '" + zip + "' -Force"], { windowsHide: true, timeout: 180000 });
  } catch (e) { }
  const ok = fs.existsSync(zip);
  bcast("[daemon] yedek " + (ok ? "tamam: " + path.basename(zip) : "alikoyamadi"));
  return { ok: ok, file: ok ? path.basename(zip) : "" };
}
/* ---- Aternos mantigi: sunucu klasoru motorun ICINDEDIR (ROOT) ----
   Panel klasor secmez; tum dosya islemleri bu API ile ROOT icinde yapilir. */
function safeRelPath(rel) {
  const parts = String(rel || "").replace(/\\/g, "/").split("/").filter(function (x) {
    const t = x.trim();
    return t && t !== "." && t !== ".." && !/^[. ]+$/.test(t);
  });
  if (!parts.length) return null;
  return path.join(ROOT, parts.join(path.sep));
}
function readRawBody(req, limit, cb) {
  const chunks = []; let n = 0, dead = false;
  req.on("data", function (c) {
    if (dead) return;
    n += c.length;
    if (n > limit) { dead = true; try { req.destroy(); } catch (e) { } cb(null); return; }
    chunks.push(c);
  });
  req.on("end", function () { if (!dead) cb(Buffer.concat(chunks)); });
  req.on("error", function () { if (!dead) { dead = true; cb(null); } });
}
function listDir(rel) {
  const base = safeRelPath(rel);
  if (!base) return { ok: false, why: "gecersiz yol" };
  try {
    const entries = fs.readdirSync(base).map(function (nm) {
      let st = null; try { st = fs.statSync(path.join(base, nm)); } catch (e) { }
      return { name: nm, kind: st && st.isDirectory() ? "directory" : "file", size: st && st.isFile() ? st.size : 0 };
    });
    entries.sort(function (a, b) { return a.kind === b.kind ? a.name.localeCompare(b.name) : (a.kind === "directory" ? -1 : 1); });
    return { ok: true, dir: String(rel || ""), entries: entries };
  } catch (e) { return { ok: false, why: e.message }; }
}
function writeFileRel(rel, data) {
  const p = safeRelPath(rel);
  if (!p) return { ok: false, why: "gecersiz yol" };
  try { mk(path.dirname(p)); fs.writeFileSync(p, data); return { ok: true, path: rel }; }
  catch (e) { return { ok: false, why: e.message }; }
}
function readFileRel(rel) {
  const p = safeRelPath(rel);
  if (!p) return { ok: false, why: "gecersiz yol" };
  try { return { ok: true, path: rel, text: fs.readFileSync(p, "utf8") }; }
  catch (e) { return { ok: false, why: e.message }; }
}
function deleteFileRel(rel) {
  const p = safeRelPath(rel);
  if (!p) return { ok: false, why: "gecersiz yol" };
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (fs.rmSync) fs.rmSync(p, { recursive: true, force: true }); else { bcast("[daemon] silme desteklenmiyor"); return { ok: false, why: "rm desteklenmiyor" }; } }
    else fs.unlinkSync(p);
    bcast("[daemon] dosya silindi: " + rel);
    return { ok: true };
  } catch (e) { return { ok: false, why: e.message }; }
}
function sendFile(res, buf, name) {
  res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "Content-Disposition": "attachment; filename=\"" + String(name).replace(/[^\w.\-]+/g, "_") + "\"" });
  res.end(buf);
}
function sendCmd(line) {
  const s = String(line).trim();
  if (s.indexOf("@@loli:") === 0) {
    const c = s.slice(7).trim();
    if (c === "start") { startServer(); return; }
    if (c === "stop") { stopServer(); return; }
    if (c === "restart") { restartServer(); return; }
    if (c === "status") { bcast("@@loli:state " + state); setPlayers(); return; }
    if (c === "open") { openPanel(); return; }
    if (c === "install") { selfInstall(); return; }
    if (c === "backup") { backup(); return; }
    if (c === "players") { setPlayers(); return; }
    if (c === "ping") { bcast("@@loli:pong " + state); return; }
    if (c === "clear") { logs.length = 0; bcast("@@loli:clear"); return; }
    if (c === "state") { bcast("@@loli:state " + state); bcast("[daemon] durum: " + state); return; }
    if (c.indexOf("panel ") === 0) { writePanelUrl(c.slice(6).trim()); bcast("@@loli:panelOk " + panelUrl()); return; }
    return;
  }
  if (!child) { bcast("[daemon] sunucu kapali · once Baslat dugmesine bas"); return; }
  try { child.stdin.write(s + "\n"); } catch (e) { }
}
function applyConfig(o) {
  const keys = ["name", "software", "softwareName", "version", "jar", "jarUrl", "ramMin", "ramMax", "javaPath", "javaArgs", "port", "autoBoot", "autoRestart", "eula", "eulaAccepted", "userId", "projectId", "schedules"];
  keys.forEach(function (k) {
    if (o[k] === undefined || o[k] === null || o[k] === "") return;
    if (k === "javaPath" && javaState.path && String(o[k]).trim() === "java") return;
    cfg[k] = o[k];
  });
  if (o.panel) writePanelUrl(o.panel);
  if (!child) ensureEnv(); else mk(ROOT);
  saveCfg();
  ensureFiles();
  if (!child) preloadJar();
  bcast("[daemon] ayarlar alindi · " + cfg.name + " · " + (cfg.softwareName || cfg.software) + " " + cfg.version + " · " + (cfg.ramMin || 1024) + "-" + (cfg.ramMax || 2048) + " MB · port " + cfg.port + " · " + ROOT);
  return { ok: true, dir: ROOT, home: HOME, name: cfg.name, jar: cfg.jar, jarUrl: !!cfg.jarUrl, jarReady: fs.existsSync(path.join(ROOT, cfg.jar || "server.jar")), state: state };
}
function writeLauncher() {
  const Q = DQ();
  const B = BS();
  const ps = "$t=$env:LOLI_TARGET;$p=$env:LOLI_PORTP;$g=Get-CimInstance Win32_Process -Filter 'Name=''node.exe''' | Where-Object {$_.CommandLine -like '*loliserver-bridge.js*' -and $_.CommandLine -notlike ('*'+$t+'*')}; if($g){ try{ Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 ('http://127.0.0.1:'+ $p +'/api/stop') | Out-Null }catch{}; Start-Sleep -Seconds 2; foreach($q in $g){ try{ Stop-Process -Id $q.ProcessId -Force }catch{} }; Start-Sleep -Seconds 1 }";
  const vbs = [
    "' loliserver sessiz motor baslatici (motor tarafindan yazildi)",
    "' Paneldeki Baslat dugmesi bu dosya ile motoru penceresiz acar.",
    "' Zincir kendi kendini onarir: hedef bridge yoksa HOME kopyasina duser.",
    "Set sh = CreateObject(" + Q + "WScript.Shell" + Q + ")",
    "Set fso = CreateObject(" + Q + "Scripting.FileSystemObject" + Q + ")",
    "home = " + Q + HOME + Q,
    "If Not fso.FolderExists(home) Then fso.CreateFolder(home)",
    "sh.CurrentDirectory = home",
    "node = " + Q + process.execPath + Q,
    "If Not fso.FileExists(node) Then node = " + Q + "node.exe" + Q,
    "bridge = " + Q + __filename + Q,
    "If Not fso.FileExists(bridge) Then",
    "  mark = home & " + Q + B + "bridge-path.txt" + Q,
    "  If fso.FileExists(mark) Then",
    "    t = Trim(fso.OpenTextFile(mark, 1).ReadAll())",
    "    If t <> " + Q + Q + " Then",
    "      If fso.FileExists(t) Then bridge = t",
    "    End If",
    "  End If",
    "End If",
    "If Not fso.FileExists(bridge) Then bridge = home & " + Q + B + "loliserver-bridge.js" + Q,
    "If Not fso.FileExists(bridge) Then WScript.Quit(1)",
    "' baska konumdan calisan eski motoru devral (dunya kaydi + surec degisimi)",
    "sh.Environment(" + Q + "Process" + Q + ").Item(" + Q + "LOLI_TARGET" + Q + ") = bridge",
    "sh.Environment(" + Q + "Process" + Q + ").Item(" + Q + "LOLI_PORTP" + Q + ") = " + Q + String(PORT) + Q,
    "ps = " + Q + ps + Q,
    "sh.Run " + Q + "powershell -NoProfile -ExecutionPolicy Bypass -Command " + Q + Q + Q + " & ps & " + Q + Q + Q + Q + ", 0, True",
    "sh.Run " + Q + Q + Q + Q + " & node & " + Q + Q + Q + " " + Q + Q + Q + " & bridge & " + Q + Q + Q + " --boot" + Q + Q + Q + ", 0, False"
  ].join("\r\n") + "\r\n";
  try { fs.writeFileSync(VBS, vbs); } catch (e) { }
  return VBS;
}
function registerProtocol() {
  const key = "HKCU" + BS() + "Software" + BS() + "Classes" + BS() + "loliserver";
  const cmd = "wscript.exe " + DQ() + VBS + DQ();
  const opts = { windowsHide: true, timeout: 20000 };
  try {
    const a = cp.spawnSync("reg", ["add", key, "/ve", "/d", "URL:loliserver Motoru", "/f"], opts);
    cp.spawnSync("reg", ["add", key, "/v", "URL Protocol", "/d", "", "/f"], opts);
    const b = cp.spawnSync("reg", ["add", key + BS() + "shell" + BS() + "open" + BS() + "command", "/ve", "/d", cmd, "/f"], opts);
    if (a && a.status !== 0) bcast("[daemon] protokol kaydi uyari: reg cikis kodu " + a.status);
    return !!(b && b.status === 0);
  } catch (e) { bcast("[daemon] protokol kaydi hatasi: " + e.message); return false; }
}
function registerStartup() {
  const rel = BS() + "Microsoft" + BS() + "Windows" + BS() + "Start Menu" + BS() + "Programs" + BS() + "Startup" + BS() + "loliserver motoru.lnk";
  const ps = "$w=New-Object -ComObject WScript.Shell;$s=$w.CreateShortcut($env:APPDATA+'" + rel + "');$s.TargetPath='wscript.exe';$s.Arguments='" + DQ() + VBS + DQ() + "';$s.WorkingDirectory='" + HOME + "';$s.WindowStyle=7;$s.Description='loliserver motoru';$s.Save()";
  try {
    const r = cp.spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { windowsHide: true, timeout: 25000 });
    return !!(r && r.status === 0);
  } catch (e) { bcast("[daemon] otomatik baslatma hatasi: " + e.message); return false; }
}
function bridgePath() {
  try { fs.writeFileSync(PATHMARK, __filename); } catch (e) { }
  if (path.resolve(__dirname) !== path.resolve(HOME)) { try { fs.copyFileSync(__filename, HOMEBRIDGE); } catch (e) { } }
}
function selfInstall(quiet) {
  bridgePath();
  writeLauncher();
  const proto = registerProtocol();
  const startup = registerStartup();
  if (quiet) {
    console.log("[daemon] oz-onarim · protokol: " + (proto ? "tam" : "HATA") + " · otomatik baslatma: " + (startup ? "tam" : "HATA") + " · launcher: " + VBS);
  } else {
    bcast("[daemon] tek tik kurulum · protokol: " + (proto ? "kayitli" : "BASARISIZ") + " · otomatik baslatma: " + (startup ? "kuruldu" : "BASARISIZ"));
    if (proto && startup) bcast("[daemon] HAZIR: paneldeki Baslat dugmesi motoru senin yerine acar (" + VBS + ")");
  }
  return { ok: !!(proto && startup), proto: proto, startup: startup, launcher: VBS, home: HOME, dir: ROOT, build: BUILD };
}
function row(k, v) { return "<tr><td>" + k + "</td><td><b>" + v + "</b></td></tr>"; }
function btn(u, txt, cls) { return '<a class="b ' + (cls || "") + '" href="' + u + '">' + txt + '</a>'; }
function page() {
  const st = statusObj();
  const sw = (st.softwareName || st.software || "Paper") + " " + (st.version || "");
  const up = st.uptime > 0 ? Math.floor(st.uptime / 60) + " dk " + (st.uptime % 60) + " sn" : "-";
  const pu = panelUrl();
  const pl = st.players.length ? esc(st.players.join(", ")) : "yok";
  return "<!doctype html><html lang=\"tr\"><head><meta charset=\"utf-8\"><title>loliserver motoru</title>" +
    "<meta http-equiv=\"refresh\" content=\"6\"><style>" +
    "body{font:15px/1.7 system-ui,'Segoe UI',sans-serif;background:#0e1116;color:#e7eaf0;margin:0;padding:34px}" +
    "h1{margin:0 0 4px;font-size:22px}.m{color:#8b93a7}.c{max-width:780px;margin:auto}" +
    "table{border-collapse:collapse;margin:16px 0;width:100%}td{padding:6px 10px;border-bottom:1px solid #1e2430}" +
    "td:first-child{color:#8b93a7;width:200px;white-space:nowrap}b.p{color:#7cc4ff}" +
    ".b{display:inline-block;padding:9px 16px;border-radius:10px;text-decoration:none;margin:4px 6px 4px 0;font-weight:600;background:#1c2331;color:#cfe3ff}" +
    ".g{background:#1d7a48;color:#fff}.r{background:#8d2b34;color:#fff}.y{background:#8a6a1f;color:#fff}</style></head><body><div class=\"c\">" +
    "<h1>loliserver motoru calisiyor</h1><div class=\"m\">Aternos mantigi: sunucu surecini bu motor yonetir, panel sadece komut gonderir.</div>" +
    "<table>" + row("Sunucu adi", esc(st.name)) + row("Yazilim", esc(sw)) + row("Durum", "<span class=\"p\">" + st.state + "</span>") +
    row("Surec (PID)", st.pid || "-") + row("Calisma suresi", up) + row("Oyuncular (" + st.players.length + ")", pl) +
    row("Minecraft portu", st.port) + row("Bellek", st.ramMin + "-" + st.ramMax + " MB") + row("Jar dosyasi", esc(st.jar) + (st.jarReady ? " · hazir" : " · yok")) +
    row("Sunucu klasoru", esc(st.dir)) + row("Motor klasoru", esc(st.home)) + row("WebSocket", "ws://127.0.0.1:" + st.port27100) + row("Node.js", st.node) + row("Motor", "v5 · build " + (st.build || "-") + " · sure limiti yok") +
    row("Minecraft IP (ag)", (st.lan || "?") + ":" + st.port) + row("Minecraft IP (dis)", (st.wan || "-") + ":" + st.port) +
    row("Port (yerel)", st.portOk ? "dinleniyor ✓" : "online olunca test edilir") + row("Dis erisim testi", st.pubOk === true ? "ACIK ✓ internetten girilebilir" : st.pubOk === false ? "KAPALI ✗ modem yonlendirme gerekli" : "online olunca test edilir") +
    "</table>" +
    btn("/api/start", "Sunucuyu baslat", "g") + btn("/api/restart", "Yeniden baslat", "y") + btn("/api/stop", "Durdur", "r") +
    btn("/api/backup", "Dunya yedegi al", "") + btn("/api/openfolder", "Sunucu klasorunu ac", "") + btn("/api/log?n=250", "Log (JSON)", "") +
    (pu ? "<p><a class=\"b g\" href=\"" + pu + "\">Paneli ac</a></p>" : "<p class=\"m\">Panel baglaninca adresi burada gorunur.</p>") +
    "<p class=\"m\">Bu sayfa 6 saniyede bir kendini yeniler. Motoru kapatmak: <b>node loliserver-bridge.js --stop</b></p>" +
    "</div></body></html>";
}
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function sendJson(res, o) {
  const h = Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, CORS);
  res.writeHead(200, h);
  res.end(JSON.stringify(o));
}
function readBody(req, cb) {
  let d = "";
  req.on("data", function (c) { d += c; if (d.length > 3000000) { try { req.destroy(); } catch (e) { } } });
  req.on("end", function () { cb(d); });
}
const server = http.createServer(function (req, res) {
  const u = req.url || "/";
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
  if (u.indexOf("/api/ping") === 0) return sendJson(res, ping());
  if (u.indexOf("/api/status") === 0) return sendJson(res, statusObj());
  if (u.indexOf("/api/log") === 0) {
    const m = /[?&]n=(\d+)/.exec(u), n = m ? Math.min(2000, Number(m[1])) : 250;
    return sendJson(res, { ok: true, lines: logs.slice(-n) });
  }
  if (u.indexOf("/api/players") === 0) return sendJson(res, { ok: true, players: Array.from(players) });
  if (u.indexOf("/api/pubtest") === 0) { upnpState = ""; upnpResult = ""; cgnat = false; fetchWan(); ensureFirewall(cfg.port || 25565, true); setTimeout(function () { upnpOpen(cfg.port || 25565); }, 600); setTimeout(function () { pubTest(cfg.port || 25565); }, 2500); return sendJson(res, { ok: true, testing: true, pubOk: pubOk }); }
  if (u.indexOf("/api/start") === 0) { startServer(); return sendJson(res, { ok: true, state: state }); }
  if (u.indexOf("/api/stop") === 0) { stopServer(); return sendJson(res, { ok: true, state: state }); }
  if (u.indexOf("/api/restart") === 0) { restartServer(); return sendJson(res, { ok: true, state: state }); }
  if (u.indexOf("/api/clear") === 0) { logs.length = 0; return sendJson(res, { ok: true, cleared: true }); }
  if (u.indexOf("/api/state") === 0) { return sendJson(res, { ok: true, state: state, valid: ["OFFLINE","STARTING","ONLINE","STOPPING","CRASHED"] }); }
  if (u.indexOf("/api/eula") === 0) {
    if (req.method === "POST") {
      readBody(req, function (b) { let o = {}; try { o = JSON.parse(b || "{}"); } catch (e) { }
        if (o.accepted) { cfg.eulaAccepted = true; cfg.eula = true; saveCfg(); ensureFiles(); bcast("[daemon] EULA panelden onaylandi ✓"); }
        sendJson(res, { ok: true, eulaAccepted: cfg.eulaAccepted });
      }); return;
    }
    return sendJson(res, { ok: true, eulaAccepted: cfg.eulaAccepted });
  }
  if (u.indexOf("/api/openfolder") === 0) { const i = u.indexOf("dir="); return sendJson(res, { ok: true, dir: openFolder(i >= 0 ? u.slice(i + 4) : "") }); }
  if (u.indexOf("/api/open") === 0) { openPanel(); return sendJson(res, { ok: true }); }
  if (u.indexOf("/api/install") === 0) return sendJson(res, selfInstall());
  if (u.indexOf("/api/backup") === 0) return sendJson(res, backup());
  if (u.indexOf("/api/files") === 0) {
    const i = u.indexOf("dir=");
    let rel = "";
    try { rel = decodeURIComponent(i >= 0 ? u.slice(i + 4).replace(/&.*$/, "") : ""); } catch (e) { }
    return sendJson(res, listDir(rel));
  }
  if (u.indexOf("/api/file/read") === 0) {
    const i = u.indexOf("path=");
    let rel = "";
    try { rel = decodeURIComponent(i >= 0 ? u.slice(i + 5).replace(/&.*$/, "") : ""); } catch (e) { }
    return sendJson(res, readFileRel(rel));
  }
  if (u.indexOf("/api/file/download") === 0) {
    const i = u.indexOf("path=");
    let rel = "";
    try { rel = decodeURIComponent(i >= 0 ? u.slice(i + 5).replace(/&.*$/, "") : ""); } catch (e) { }
    const p = safeRelPath(rel);
    if (!p) return sendJson(res, { ok: false, why: "gecersiz yol" });
    try { return sendFile(res, fs.readFileSync(p), path.basename(p)); }
    catch (e) { return sendJson(res, { ok: false, why: e.message }); }
  }
  if (u.indexOf("/api/file/write") === 0) {
    if (req.method !== "POST") return sendJson(res, { ok: false, why: "POST gerekli" });
    readRawBody(req, 20000000, function (b) {
      let o = {}; try { o = JSON.parse(b ? b.toString("utf8") : "{}"); } catch (e) { }
      if (!o.path) return sendJson(res, { ok: false, why: "path yok" });
      sendJson(res, writeFileRel(o.path, String(o.text === undefined || o.text === null ? "" : o.text)));
    });
    return;
  }
  if (u.indexOf("/api/file/upload") === 0) {
    if (req.method !== "POST") return sendJson(res, { ok: false, why: "POST gerekli" });
    const i = u.indexOf("path=");
    let rel = "";
    try { rel = decodeURIComponent(i >= 0 ? u.slice(i + 5).replace(/&.*$/, "") : ""); } catch (e) { }
    readRawBody(req, 800000000, function (b) {
      if (!b) return sendJson(res, { ok: false, why: "dosya cok buyuk" });
      sendJson(res, writeFileRel(rel, b));
    });
    return;
  }
  if (u.indexOf("/api/file/delete") === 0) {
    if (req.method !== "POST") return sendJson(res, { ok: false, why: "POST gerekli" });
    readRawBody(req, 100000, function (b) {
      let o = {}; try { o = JSON.parse(b ? b.toString("utf8") : "{}"); } catch (e) { }
      if (!o.path) return sendJson(res, { ok: false, why: "path yok" });
      sendJson(res, deleteFileRel(o.path));
    });
    return;
  }
  if (u.indexOf("/api/command") === 0) {
    const i = u.indexOf("line=");
    sendCmd(i >= 0 ? decodeURIComponent(u.slice(i + 5).replace(/&.*$/, "")) : "");
    return sendJson(res, { ok: true });
  }
  if (u.indexOf("/api/panel") === 0) {
    const i = u.indexOf("url=");
    if (i >= 0) writePanelUrl(decodeURIComponent(u.slice(i + 4).replace(/&.*$/, "")));
    return sendJson(res, { ok: true, url: panelUrl() });
  }
  if (u.indexOf("/api/config") === 0) {
    if (req.method === "POST") { readBody(req, function (b) { let o = {}; try { o = JSON.parse(b || "{}"); } catch (e) { } sendJson(res, applyConfig(o)); }); return; }
    const i = u.indexOf("json=");
    let o = {};
    try { o = JSON.parse(decodeURIComponent(i >= 0 ? u.slice(i + 5) : "{}")); } catch (e) { }
    return sendJson(res, applyConfig(o));
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(page());
});
function onData(sock, chunk, onText) {
  let b = Buffer.concat([bufs.get(sock) || Buffer.alloc(0), chunk]);
  try {
    for (;;) {
    if (b.length < 2) break;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) break; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) break; len = Number(b.readBigUInt64BE(2)); off = 10; }
    let mask = null;
    if (masked) { if (b.length < off + 4) break; mask = b.slice(off, off + 4); off += 4; }
    if (b.length < off + len) break;
    const payload = Buffer.from(b.slice(off, off + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    b = b.slice(off + len);
    if (op === 0x8) { try { sock.end(); } catch (e) { } }
    else if (op === 0x9) { try { sock.write(Buffer.from([0x8a, 0x00])); } catch (e) { } }
    else if (op === 0x1 || op === 0x2) onText(payload.toString("utf8"));
    }
  } catch (e) { bcast("[daemon] ws mesaj hatasi: " + e.message); }
  bufs.set(sock, b);
}
server.on("upgrade", function (req, sock) {
  const key = req.headers["sec-websocket-key"];
  if (!key) { sock.destroy(); return; }
  const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
  clients.add(sock);
  bufs.set(sock, Buffer.alloc(0));
  bcast("[daemon] panel baglandi · durum: " + state);
  bcast("@@loli:state " + state);
  setPlayers();
  netEvent();
  sock.on("data", function (c) {
    onData(sock, c, function (txt) {
      txt.split(/\r?\n/).forEach(function (l) { if (l.trim()) sendCmd(l); });
    });
  });
  sock.on("close", function () { clients.delete(sock); });
  sock.on("error", function () { clients.delete(sock); });
});
const banner = [
  "==================================================",
  "  loliserver MOTORU (daemon) v5 · Aternos mantigi · sure limiti yok",
  "--------------------------------------------------",
  "  Motor klasoru : " + HOME,
  "  Sunucu klasoru: " + ROOT,
  "  Sunucu        : " + cfg.name + " · " + (cfg.softwareName || "") + " " + cfg.version + " · port " + (cfg.port || 25565),
  "  WebSocket     : ws://127.0.0.1:" + PORT,
  "  API           : http://127.0.0.1:" + PORT + "/api/status",
  "  Panel         : " + (panelUrl() || "(panel baglaninca kaydedilir)"),
  "  Komutlar      : --open · --boot · --install · --stop",
  "=================================================="
].join("\n");
let bootN = 0;
function takeover(cb) {
  const t0 = Date.now();
  function listPids() {
    try {
      const out = String(cp.execSync("netstat -ano -p tcp", { windowsHide: true, timeout: 8000, encoding: "utf8" }));
      const pids = [];
      out.split(/\r?\n/).forEach(function (ln) {
        if (ln.indexOf(":" + PORT + " ") < 0) return;
        const m = ln.match(/LISTENING\s+(\d+)/);
        if (m && pids.indexOf(Number(m[1])) < 0) pids.push(Number(m[1]));
      });
      return pids;
    } catch (e) { return []; }
  }
  try { http.get("http://127.0.0.1:" + PORT + "/api/stop", function () { }).on("error", function () { }); } catch (e) { }
  (function step() {
    const pids = listPids();
    if (!pids.length) return cb(true);
    let st = "";
    let done = false;
    const decide = function () {
      if (done) return;
      done = true;
      const t = Date.now() - t0;
      if (st === "stopped" || st === "offline" || st === "" || t > 35000) {
        pids.forEach(function (p) { try { cp.spawnSync("taskkill", ["/F", "/PID", String(p)], { windowsHide: true }); } catch (e) { } });
        setTimeout(function () { cb(listPids().length === 0); }, 900);
        return;
      }
      setTimeout(step, 1500);
    };
    try {
      http.get("http://127.0.0.1:" + PORT + "/api/status", function (r) { let s = ""; r.on("data", function (c) { s += c; }); r.on("end", function () { try { st = String(JSON.parse(s).state || "").toLowerCase(); } catch (e) { } decide(); }); }).on("error", function () { decide(); });
    } catch (e) { decide(); }
  })();
}
server.on("error", function (e) {
  if (e && e.code === "EADDRINUSE") {
    if (bootN > 4) { console.log("[daemon] port " + PORT + " hala dolu · bu kopya kapaniyor"); if (has("--open") || has("--boot")) setTimeout(function () { openPanel(); process.exit(0); }, 500); else process.exit(0); return; }
    console.log("[daemon] port " + PORT + " dolu · eski motor devraliniyor (dunya kaydedilir)...");
    takeover(function (ok) {
      if (ok) { console.log("[daemon] eski motor devralindi · yeni motor baslatiliyor"); setTimeout(function () { boot(); }, 800); }
      else { console.log("[daemon] eski motor devralinamadi · bu kopya kapaniyor"); if (has("--open") || has("--boot")) setTimeout(function () { openPanel(); process.exit(0); }, 500); else process.exit(0); }
    });
    return;
  }
  console.log("[daemon] HATA: " + e.message);
});
function onListen() {
  console.log(banner);
  if (!has("--install")) selfInstall(true);
  ensureFiles();
  ensureFirewall(cfg.port || 25565, false);
  fetchWan();
  gatewayHint();
  if (!cfg.autoBoot) preloadJar();
  ensureJava(false, function (jp, jv) { if (jp) console.log("[daemon] Java: v" + jv + " · " + jp); });
  if (has("--install")) {
    bcast("[daemon] kurulum tamam · motor arka planda calisiyor, sunucu panelden Baslat ile acilir");
    setTimeout(openPanel, 1200);
    if (has("--exit")) setTimeout(function () { process.exit(0); }, 2600);
    return;
  }
  if (has("--open") || has("--boot")) setTimeout(openPanel, 900);
  if (cfg.autoBoot && !has("--no-auto") && process.env.LOLI_NO_AUTO !== "1") setTimeout(function () {
    bcast("[daemon] autoBoot acik · sunucu otomatik baslatiliyor...");
    startServer();
  }, 1800);
}
function boot() {
  bootN++;
  server.listen(PORT, "127.0.0.1", onListen);
}
if (has("--stop")) {
  http.get("http://127.0.0.1:" + PORT + "/api/stop", function () { }).on("error", function () { });
  setTimeout(function () { process.exit(0); }, 1500);
} else {
  if (has("--install")) selfInstall();
  boot();
}
(cfg.schedules || []).forEach(function (s) {
  if (!s || !s.enabled) return;
  const ms = Math.max(1, Number(s.every) || 60) * 60000;
  setInterval(function () {
    if (s.type === "restart") { bcast("[daemon] zamanlanmis yeniden baslatma"); stopServer(); setTimeout(function () { stopping = false; startServer(); }, 10000); }
    else if (s.type === "stop") { stopServer(); }
    else if (s.type === "save") { if (child) { try { child.stdin.write("save-all\n"); } catch (e) { } } }
    else if (s.type === "backup") { backup(); }
  }, ms);
});
process.on("SIGINT", function () { stopServer(); setTimeout(function () { process.exit(0); }, 4000); });
process.on("SIGTERM", function () { stopServer(); setTimeout(function () { process.exit(0); }, 4000); });



