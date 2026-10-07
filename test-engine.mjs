/* loliserver motor E2E testi
   node test-engine.mjs
   Akis: /api/ping (build kontrolu) → PaperMC son surum → POST /api/config
         → WS @@loli:start → jar/java otomatik indirilir → "Done (" bekle
         → @@loli:stop → state stopped. */
const API = 'http://127.0.0.1:27100';
const log = (...a) => console.log('[test]', ...a);

async function main() {
  const ping = await (await fetch(API + '/api/ping')).json();
  if (!ping.ok) throw new Error('ping basarisiz');
  log('motor build=' + ping.build + ' · state=' + ping.state);
  if (!(ping.build >= 4)) throw new Error('motor eski: build ' + ping.build);

  log('PaperMC (fill v3) son surum sorgulaniyor...');
  const proj = await (await fetch('https://fill.papermc.io/v3/projects/paper')).json();
  const keys = Object.keys(proj.versions || {});
  if (!keys.length) throw new Error('PaperMC v3: surum listesi bos');
  let ver = null, bl = null;
  for (const k of keys) {
    try {
      const r = await fetch('https://fill.papermc.io/v3/projects/paper/versions/' + encodeURIComponent(k) + '/builds');
      if (!r.ok) continue;
      const arr = await r.json();
      if (Array.isArray(arr) && arr.length) { ver = k; bl = arr; break; }
    } catch (e) { }
  }
  if (!ver) throw new Error('PaperMC v3: calisan surum bulunamadi');
  /* panel resolveDownload ile ayni secim: STABLE tercih, ilk build */
  const stable = bl.filter((x) => x.channel === 'STABLE');
  const b = (stable.length ? stable : bl)[0];
  const dk = Object.keys(b.downloads || {})[0];
  const f = b.downloads[dk];
  const jarUrl = f.url;
  log('hedef: Paper ' + ver + ' · build ' + b.id + ' · ' + f.name);

  const cfgRes = await fetch(API + '/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'loliserver Test', software: 'paper', softwareName: 'Paper', version: ver, jar: 'server.jar', jarUrl: jarUrl, port: 25565, ramMin: 1024, ramMax: 2048, autoBoot: false, autoRestart: true, eula: true, schedules: [] })
  });
  const cfg = await cfgRes.json();
  if (!cfg.ok) throw new Error('config reddedildi: ' + JSON.stringify(cfg));
  log('config tamam · dir=' + cfg.dir + ' · jarReady=' + cfg.jarReady);

  await new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:27100');
    let phase = 'baglaniyor';
    let to = null;
    const finish = (err) => { if (to) clearTimeout(to); try { ws.close(); } catch (e) { } err ? reject(err) : resolve(); };
    to = setTimeout(() => finish(new Error('zaman asimi · faz=' + phase)), 300000);
    ws.onopen = () => { phase = 'start gonderiliyor'; log('ws acildi → @@loli:start'); ws.send('@@loli:start'); };
    ws.onmessage = (ev) => {
      String(ev.data).split(/\r?\n/).forEach((line) => {
        if (!line.trim()) return;
        if (line.startsWith('@@loli:state')) {
          const st = line.slice(13).trim();
          log('state →', st);
          if (st === 'stopped' && phase === 'durduruluyor') finish();
          return;
        }
        if (line.startsWith('@@loli:')) return;
        if (/Done \(|Done!|For help, type/.test(line) && phase !== 'durduruluyor') {
          log('SUNUCU HAZIR ✓ ' + line.trim().slice(0, 90));
          phase = 'durduruluyor';
          ws.send('@@loli:stop');
          return;
        }
        log('  | ' + line);
      });
    };
    ws.onerror = () => { if (phase === 'baglaniyor') finish(new Error('ws baglanamadi')); };
    ws.onclose = () => { if (phase !== 'durduruluyor') finish(new Error('ws beklenmedik kapandi · faz=' + phase)); };
  });
  log('E2E BASARILI: motor jar/Java zincirini otomatik yuruttu, sunucuyu acti, dunyayi kaydedip temiz kapatti.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('[test] HATA:', e.message); process.exit(1); });
