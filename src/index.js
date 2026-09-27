/* カリンバ楽譜メーカー ― かんたんアカウント用のサーバー
   ------------------------------------------------------------
   /api/... だけをこのスクリプトが受け持ちます。
   それ以外（HTML や JS、画像）は public/ の中身がそのまま配られます。
   （どこまでをこちらに回すかは wrangler.jsonc の run_worker_first で決めています）

   保存先は Workers KV です。キーの形は次のとおり:
     u:<ログインID>   … {uid, salt, hash, created}
     t:<トークン>     … {uid, id}            （期限つき。ログイン状態の記録）
     s:<uid>:<曲名>   … 曲の中身（JSON 文字列）。表示用の名前などは metadata に入れる

   退会すると u: と s: を消します。t:（ログイン記録）は期限切れに任せますが、
   session() が「その利用者がまだいるか」を見るので、消したあとは入れません。

   パスワードの扱いについて:
   Workers の無料枠は 1 リクエストあたり CPU 10ms までなので、
   サーバー側で時間のかかるハッシュ（PBKDF2 を何万回も回すようなもの）は動かせません。
   そこで、時間のかかる計算はブラウザ側でやっています。
     ブラウザ: PBKDF2(パスワード, 塩 = サイト名+ログインID, 15万回) → その結果だけを送る
     サーバー: SHA-256(利用者ごとの塩 + 送られてきた値) を保存する
   こうすると
     ・パスワードそのものはブラウザから出ていきません
     ・保存データが漏れても、元のパスワードに戻すには 15 万回の計算を
       1 回の推測ごとにやり直す必要があります
   サーバー側でも重いハッシュを使うのが本来は望ましいのですが、
   上の制限があるため、この形にしています。
   ============================================================ */

const TOKEN_TTL = 60 * 60 * 24 * 180;   // ログイン状態を保つ期間（180日）
const MAX_ID    = 40;                   // ログインIDの長さ（KV のキーに収めるため）
const MAX_NAME  = 120;                  // 曲名の長さ（同上）
const MAX_SONG  = 300 * 1024;           // 1曲あたりの大きさ

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};
const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: HEADERS });
const bad  = (msg, status) => json({ error: msg }, status || 400);

const enc = new TextEncoder();
const hex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return hex(a);
}

async function hashPw(salt, clientHex) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(salt + ':' + clientHex)));
}

/* 比べるのにかかる時間で中身を推測されないようにする */
function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* 送られてきた値がその項目として使えるかだけを見る。
   中身の書き方（使える文字など）には口を出さない */
function textField(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  if (Array.from(s).length > max) return null;
  return s;
}

async function readJson(req) {
  try { return await req.json(); } catch (e) { return null; }
}

async function session(req, env) {
  const h = req.headers.get('authorization') || '';
  const token = h.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const v = await env.KV.get('t:' + token, 'json');
  if (!v) return null;
  /* 退会したあと、別の端末に残っていた記録で入れてしまわないように、
     その利用者がまだいるかどうかも確かめる */
  const u = await env.KV.get('u:' + v.id, 'json');
  if (!u || u.uid !== v.uid) return null;
  return { token, uid: v.uid, id: v.id };
}

async function newSession(env, uid, id) {
  const token = randomHex(24);
  await env.KV.put('t:' + token, JSON.stringify({ uid, id }), { expirationTtl: TOKEN_TTL });
  return token;
}

/* ---------- 登録 ---------- */
async function register(req, env) {
  const b = await readJson(req);
  if (!b) return bad('送信された内容を読み取れませんでした');

  /* ふだんは誰でも登録できる。
     いたずらされたときだけ、秘密 SIGNUP_CODE を登録すれば合言葉制になる。
     （コードを直さずに閉じられるようにしてある） */
  const code = env.SIGNUP_CODE;
  if (code && b.code !== code) return bad('いまは新規登録に合言葉が必要です', 403);

  const id = textField(b.id, MAX_ID);
  if (!id) return bad('ログインIDを入れてください（' + MAX_ID + '文字まで）');
  if (typeof b.pw !== 'string' || b.pw.length !== 64) return bad('パスワードの形式が不正です');

  if (await env.KV.get('u:' + id)) return bad('そのログインIDはすでに使われています', 409);

  const salt = randomHex(16);
  const uid  = randomHex(8);
  await env.KV.put('u:' + id, JSON.stringify({
    uid, salt, hash: await hashPw(salt, b.pw), created: Date.now()
  }));
  return json({ id, token: await newSession(env, uid, id) });
}

/* ---------- ログイン ---------- */
async function login(req, env) {
  const b = await readJson(req);
  if (!b) return bad('送信された内容を読み取れませんでした');
  const id = textField(b.id, MAX_ID);
  if (!id || typeof b.pw !== 'string') return bad('ログインIDとパスワードを入れてください');

  const u = await env.KV.get('u:' + id, 'json');
  /* 見つからないときも、合っていないときと同じ返事にする */
  if (!u || !sameHash(u.hash, await hashPw(u.salt, b.pw))) {
    return bad('ログインIDかパスワードがちがいます', 401);
  }
  return json({ id, token: await newSession(env, u.uid, id) });
}

/* ---------- 曲 ---------- */
const songKey = (uid, name) => 's:' + uid + ':' + name;

async function listSongs(env, s) {
  const out = [];
  let cursor;
  do {
    const r = await env.KV.list({ prefix: 's:' + s.uid + ':', cursor });
    r.keys.forEach(k => {
      const m = k.metadata || {};
      out.push({ name: m.n || k.name.slice(('s:' + s.uid + ':').length),
                 updated: m.u || 0, notes: m.c || 0 });
    });
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  out.sort((a, b) => b.updated - a.updated);
  return json({ songs: out });
}

async function getSong(env, s, name) {
  const data = await env.KV.get(songKey(s.uid, name));
  if (data === null) return bad('その曲は見つかりませんでした', 404);
  return json({ name, data });
}

async function putSong(req, env, s) {
  const b = await readJson(req);
  if (!b) return bad('送信された内容を読み取れませんでした');
  const name = textField(b.name, MAX_NAME);
  if (!name) return bad('曲の名前を入れてください（' + MAX_NAME + '文字まで）');
  if (typeof b.data !== 'string' || !b.data) return bad('曲の中身がありません');
  if (b.data.length > MAX_SONG) return bad('曲が大きすぎます');

  let notes = 0;
  try { notes = (JSON.parse(b.data).notes || []).length; } catch (e) { return bad('曲の形式がちがいます'); }

  const updated = Date.now();
  await env.KV.put(songKey(s.uid, name), b.data, { metadata: { n: name, u: updated, c: notes } });
  return json({ name, updated });
}

async function delSong(env, s, name) {
  await env.KV.delete(songKey(s.uid, name));
  return json({ ok: true });
}

/* ---------- 退会 ---------- */
/* その人の曲をすべて消してから、利用者そのものを消す。元に戻せない。
   ほかの端末に残っているログイン記録は、session() が
   「利用者がもういない」と見て弾くので、そちらは消さなくてよい */
async function delAccount(env, s) {
  let n = 0, cursor;
  do {
    const r = await env.KV.list({ prefix: 's:' + s.uid + ':', cursor });
    for (const k of r.keys) { await env.KV.delete(k.name); n++; }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  await env.KV.delete('u:' + s.id);
  await env.KV.delete('t:' + s.token);
  return json({ ok: true, deleted: n });
}

/* ---------- 振り分け ---------- */
async function api(req, env, path) {
  if (path === '/api/register' && req.method === 'POST') return register(req, env);
  if (path === '/api/login'    && req.method === 'POST') return login(req, env);

  const s = await session(req, env);
  if (path === '/api/logout' && req.method === 'POST') {
    if (s) await env.KV.delete('t:' + s.token);
    return json({ ok: true });
  }
  if (!s) return bad('ログインしていません', 401);

  if (path === '/api/me') return json({ id: s.id });

  if (path === '/api/account' && req.method === 'DELETE') return delAccount(env, s);

  if (path === '/api/songs') {
    const url = new URL(req.url);
    const name = url.searchParams.get('name');
    if (req.method === 'GET')    return name ? getSong(env, s, name) : listSongs(env, s);
    if (req.method === 'PUT')    return putSong(req, env, s);
    if (req.method === 'DELETE') return name ? delSong(env, s, name) : bad('曲の名前がありません');
  }
  return bad('そのような窓口はありません', 404);
}

export default {
  async fetch(req, env) {
    const path = new URL(req.url).pathname;

    /* 練習画面の URL。実体のあるファイルではないので、
       ここで楽譜ページ（トップ）の中身をそのまま返す。
       /index.html ではなく / を取りに行くのは、
       Cloudflare が /index.html を / へ転送してしまうため */
    if (path === '/practice' || path === '/practice/') {
      return env.ASSETS.fetch(new Request(new URL('/', req.url), { headers: req.headers }));
    }

    if (path.startsWith('/api/')) {
      if (!env.KV) return bad('保存領域(KV)が設定されていません', 503);
      try {
        return await api(req, env, path);
      } catch (e) {
        return bad('サーバー側で問題が起きました', 500);
      }
    }
    /* ここには基本来ない（静的ファイルは Worker を通らない設定）が、念のため */
    return env.ASSETS.fetch(req);
  }
};
