/* loliserver engine senkronizasyon araci
   server.html icindeki BRIDGE_JS dizisini birebir cikarip
   loliserver-bridge.js olarak yazar. Panel guncellenince:
   node sync-engine.mjs  -> motor dosyasi her zaman panel ile ayni kalir. */
import fs from 'node:fs';

const here = new URL('.', import.meta.url);
const src = fs.readFileSync(new URL('./server.html', here), 'utf8');

const START = 'const BRIDGE_JS = [';
const END = "].join('\\n');";
const si = src.indexOf(START);
if (si < 0) throw new Error('BRIDGE_JS baslangici bulunamadi (server.html)');
const ei = src.indexOf(END, si);
if (ei < 0) throw new Error('BRIDGE_JS sonu bulunamadi (server.html)');

const inner = src.slice(si + START.length, ei);
const arr = eval('[' + inner + ']');
if (!Array.isArray(arr) || arr.length < 400) throw new Error('Beklenmeyen dizi uzunlugu: ' + (arr && arr.length));

const code = arr.join('\n') + '\n';
fs.writeFileSync(new URL('./loliserver-bridge.js', here), code);

const lines = code.split('\n');
const m = code.match(/const BUILD = (\d+)/);
console.log('loliserver-bridge.js yazildi · ' + arr.length + ' satir · ' + code.length + ' bayt · BUILD=' + (m ? m[1] : 'YOK'));
console.log('--- ilk 2 satir ---');
console.log(lines.slice(0, 2).join('\n'));
console.log('--- son 2 satir ---');
console.log(lines.slice(-3).join('\n'));
