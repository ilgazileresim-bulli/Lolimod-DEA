/* sync-html.mjs
   REVERSE SYNC: bridge.js -> server.html
   Bridge'te yapilan degisiklikleri server.html icindeki BRIDGE_JS dizisine yazar.
   
   Kullanim: node sync-html.mjs
   
   Ardindan:  node sync-engine.mjs
   ile dogrulayabilirsin. */
import fs from 'node:fs';

const here = new URL('.', import.meta.url);
const bridgeCode = fs.readFileSync(new URL('./loliserver-bridge.js', here), 'utf8');
const html = fs.readFileSync(new URL('./server.html', here), 'utf8');

const lines = bridgeCode.split('\n');
function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
const arrStr = lines
  .map(function (l) { return "            '" + esc(l) + "'"; })
  .join(',\n');

const replacement = 'const BRIDGE_JS = [\n' + arrStr + '\n        ].join(\'\\n\');';

const START = 'const BRIDGE_JS = [';
const END = "].join('\\n');";
const si = html.indexOf(START);
if (si < 0) throw new Error('BRIDGE_JS baslangici bulunamadi (server.html)');
const ei = html.indexOf(END, si);
if (ei < 0) throw new Error('BRIDGE_JS sonu bulunamadi (server.html)');

const newHtml = html.slice(0, si) + replacement + html.slice(ei + END.length);
fs.writeFileSync(new URL('./server.html', here), newHtml, 'utf8');

// BUILD numarasini guncelle
const v = (Number(bridgeCode.match(/const BUILD = (\d+)/)?.[1]) || 0) + 1;
const finalBridge = bridgeCode.replace(/const BUILD = \d+/, 'const BUILD = ' + v);
const finalHtml2 = newHtml.replace(/BUILD = \d+/g, 'BUILD = ' + v);
fs.writeFileSync(new URL('./loliserver-bridge.js', here), finalBridge, 'utf8');
fs.writeFileSync(new URL('./server.html', here), finalHtml2, 'utf8');

console.log('--- REVERSE SYNC: bridge.js -> server.html ---');
console.log('server.html BRIDGE_JS guncellendi');
console.log(lines.length + ' satir · BUILD=' + v);
console.log('Simdi dogrulamak icin: node sync-engine.mjs');
