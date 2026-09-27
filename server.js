/* file:// でマイクが使えないとき用の、ごく小さなローカルサーバー。
   start.cmd をダブルクリックすると、このサーバー経由でページが開きます。
   配信するのは、このフォルダの中のファイルだけです。

   /api/... は本番と同じ src/index.js（Cloudflare Workers のスクリプト）を
   そのまま動かします。保存先だけは本物の Workers KV ではなく、
   .wrangler/dev-kv.json というファイルで代用しています。 */
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
  '.svg':  'image/svg+xml',
  '.txt':  'text/plain; charset=utf-8',
  '.xml':  'application/xml; charset=utf-8'
};

/* ============================================================
   ここから下の「開発用」は、本番（Cloudflare）では使われません
   ============================================================ */

/* Workers KV の代わり。中身はファイルに書き出して、再起動しても残るようにする */
const KV_FILE = path.join(__dirname, '.wrangler', 'dev-kv.json');
function kvLoad() {
  try { return new Map(Object.entries(JSON.parse(fs.readFileSync(KV_FILE, 'utf8')))); }
  catch (e) { return new Map(); }
}
function kvSave(m) {
  try {
    fs.mkdirSync(path.dirname(KV_FILE), { recursive: true });
    fs.writeFileSync(KV_FILE, JSON.stringify(Object.fromEntries(m), null, 1));
  } catch (e) { /* 開発用なので、保存できなくても続ける */ }
}
const kvMap = kvLoad();
const devKV = {
  async get(k, type) {
    const e = kvMap.get(k);
    if (!e) return null;
    if (e.exp && Date.now() > e.exp) { kvMap.delete(k); return null; }
    return type === 'json' ? JSON.parse(e.value) : e.value;
  },
  async put(k, value, opts) {
    const o = opts || {};
    kvMap.set(k, {
      value: value,
      metadata: o.metadata || null,
      exp: o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0
    });
    kvSave(kvMap);
  },
  async delete(k) { kvMap.delete(k); kvSave(kvMap); },
  async list(opts) {
    const prefix = (opts && opts.prefix) || '';
    const keys = [...kvMap.keys()].filter(k => k.startsWith(prefix)).sort()
      .map(k => ({ name: k, metadata: kvMap.get(k).metadata }));
    return { keys: keys, list_complete: true, cursor: null };
  }
};

/* 合言葉は .dev.vars の SIGNUP_CODE から読む。
   書いていなければ本番と同じく「誰でも登録できる」状態になる */
function devSignupCode() {
  try {
    const m = fs.readFileSync(path.join(__dirname, '.dev.vars'), 'utf8')
      .match(/^\s*SIGNUP_CODE\s*=\s*(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch (e) { /* 無ければ合言葉なし */ }
  return '';
}

let workerPromise = null;
function loadWorker() {
  if (!workerPromise) workerPromise = import('./src/index.js').then(m => m.default);
  return workerPromise;
}

async function handleApi(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request('http://localhost:' + PORT + req.url, {
    method: req.method,
    headers: req.headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined
  });
  const worker = await loadWorker();
  const out = await worker.fetch(request, {
    KV: devKV,
    SIGNUP_CODE: devSignupCode(),
    ASSETS: { fetch: () => new Response('not found', { status: 404 }) }
  });
  const headers = {};
  out.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(out.status, headers);
  res.end(Buffer.from(await out.arrayBuffer()));
}

/* ============================================================
   ここまで開発用
   ============================================================ */

function sendHtml(res, file, onMissing) {
  fs.readFile(file, (err, data) => {
    if (err) { onMissing(); return; }
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

/* 見つからないときは 404.html を 404 で返す（本番と同じ） */
function send404(res) {
  fs.readFile(path.join(ROOT, '404.html'), (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(404, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

/* 拡張子のないパスの扱い。本番（Cloudflare）に合わせる。
     /about    → about.html
     /practice → index.html（練習画面。本番では Worker が同じことをします）
     それ以外  → 404 */
function serveExtensionless(res, file, p) {
  sendHtml(res, file + '.html', () => {
    if (p === '/practice' || p === '/practice/') {
      sendHtml(res, path.join(ROOT, 'index.html'), () => send404(res));
      return;
    }
    send404(res);
  });
}

http.createServer((req, res) => {
  let p = decodeURIComponent(url.parse(req.url).pathname);

  if (p.indexOf('/api/') === 0) {
    handleApi(req, res).catch(err => {
      res.writeHead(500, { 'Content-Type': TYPES['.json'] });
      res.end(JSON.stringify({ error: 'ローカルサーバー側の問題: ' + err.message }));
    });
    return;
  }

  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      if (!path.extname(file)) { serveExtensionless(res, file, p); return; }
      send404(res); return;
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
  console.log('（新規登録に合言葉を要求したいときは .dev.vars に SIGNUP_CODE を書く）');
  console.log('終了するにはこのウィンドウで Ctrl+C を押してください。');
  exec('start "" ' + at);
});
