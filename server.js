/* file:// でマイクが使えないとき用の、ごく小さなローカルサーバー。
   start.cmd をダブルクリックすると、このサーバー経由でページが開きます。
   配信するのは、このフォルダの中のファイルだけです。 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { exec } = require('child_process');

const PORT = 8731;
const ROOT = path.join(__dirname, 'public');   // 公開するのは public/ の中だけ
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.gif':  'image/gif',
  '.png':  'image/png',
  '.svg':  'image/svg+xml'
};

/* 拡張子のないパス（/practice など）用。ページ本体を返す */
function serveIndex(res) {
  fs.readFile(path.join(ROOT, 'index.html'), (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

http.createServer((req, res) => {
  let p = decodeURIComponent(url.parse(req.url).pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      /* /practice のような拡張子なしのパスは index.html を返す。
         本番（Cloudflare）でも not_found_handling で同じことをしています */
      if (!path.extname(file)) { serveIndex(res); return; }
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'          // 編集したらすぐ反映されるように
    });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  const at = 'http://localhost:' + PORT + '/';
  console.log('カリンバ楽譜メーカー: ' + at);
  console.log('終了するにはこのウィンドウで Ctrl+C を押してください。');
  exec('start "" ' + at);
});
