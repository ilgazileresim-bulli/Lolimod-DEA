/* Geçici doğrulama aracı: server.html içindeki satır içi script'leri çıkarıp node --check yapar */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const html = fs.readFileSync('server.html', 'utf8');
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, i = 0, fail = 0;
while ((m = re.exec(html)) !== null) {
    const code = m[1];
    if (!code.trim()) continue;
    i++;
    const f = `_inline_${i}.js`;
    fs.writeFileSync(f, code, 'utf8');
    try {
        execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
        console.log(`script #${i}: OK (${code.length} chars)`);
    } catch (e) {
        fail++;
        console.log(`script #${i}: HATA\n${e.stderr ? e.stderr.toString().slice(0, 2000) : e.message}`);
    }
    fs.unlinkSync(f);
}
console.log(fail ? `SONUC: ${fail} script HATALI` : 'SONUC: tum inline scriptler gecerli');