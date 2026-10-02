/* ============================================
   macc.lol/photo worker
   Routes (everything else is a static file from public/photo):
     /photo/img/(full|thumb)/<id>.jpg   image bytes from R2
     /photo/p/<id>                      the page, with share tags for one photo
     /photo/api/...                     JSON API, see `api()` below
   Posting needs the shared INVITE_CODE; ADMIN_CODE logs in as admin, who can
   edit or delete anything. Viewing is public.
   ============================================ */

const BASE = '/photo';
const COOKIE = 'photo_session';
const YEAR_S = 60 * 60 * 24 * 365;

const MAX_FULL_BYTES = 12 * 1024 * 1024;
const MAX_THUMB_BYTES = 2 * 1024 * 1024;
const MAX_CAPTION = 500;
const MAX_NAME = 24;
const PAGE_SIZE = 48;
const SNIPPET_S = 15;

// invite-code guessing: this many misses per IP, then a pause
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path.startsWith(`${BASE}/api/`)) return await api(request, env, url);
      if (path.startsWith(`${BASE}/img/`)) return await serveImage(request, env, path.slice(`${BASE}/img/`.length));
      const share = path.match(/^\/photo\/p\/([a-z0-9]{1,32})\/?$/);
      if (share) return await sharePage(request, env, url, share[1]);
      return new Response('not found', { status: 404 });
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'something went wrong on our end' }, 500);
    }
  },
};

/* ---------- API ---------- */

async function api(request, env, url) {
  const route = url.pathname.slice(`${BASE}/api`.length).replace(/\/$/, '');
  const method = request.method;

  // Cookies are SameSite=Lax already; also refuse writes coming from other sites.
  if (method !== 'GET' && method !== 'HEAD' && request.headers.get('Origin') !== url.origin) {
    throw new HttpError(403, 'bad origin');
  }

  if (route === '/photos' && method === 'GET') return listPhotos(env, url);
  if (route === '/songs' && method === 'GET') return searchSongs(request, url);
  if (route === '/preview' && method === 'GET') return songPreview(request, url);
  if (route === '/me' && method === 'GET') return json({ member: await currentMember(request, env) });
  if (route === '/join' && method === 'POST') return join(request, env);
  if (route === '/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (route === '/photos' && method === 'POST') return createPhoto(request, env);

  const one = route.match(/^\/photos\/([a-z0-9]{1,32})$/);
  if (one && method === 'PATCH') return updatePhoto(request, env, one[1]);
  if (one && method === 'DELETE') return deletePhoto(request, env, one[1]);

  throw new HttpError(404, 'no such endpoint');
}

async function listPhotos(env, url) {
  const limit = clampInt(url.searchParams.get('limit'), 1, 100, PAGE_SIZE);
  const before = url.searchParams.get('before'); // "<created_at>_<id>" from the previous page

  let rows;
  if (before) {
    const [at, id] = before.split('_');
    rows = await env.DB.prepare(
      `SELECT p.*, m.name FROM photos p JOIN members m ON m.id = p.member_id
       WHERE (p.created_at, p.id) < (?, ?)
       ORDER BY p.created_at DESC, p.id DESC LIMIT ?`
    ).bind(Number(at) || 0, id || '', limit).all();
  } else {
    rows = await env.DB.prepare(
      `SELECT p.*, m.name FROM photos p JOIN members m ON m.id = p.member_id
       ORDER BY p.created_at DESC, p.id DESC LIMIT ?`
    ).bind(limit).all();
  }

  const photos = rows.results.map(publicPhoto);
  const last = rows.results[rows.results.length - 1];
  const body = {
    photos,
    next: rows.results.length === limit ? `${last.created_at}_${last.id}` : null,
  };

  // totals for the header, first page only
  if (!before) {
    body.stats = await env.DB.prepare(
      'SELECT COUNT(*) AS frames, COUNT(DISTINCT member_id) AS people, MAX(created_at) AS latest FROM photos'
    ).first();
  }
  return json(body, 200, { 'Cache-Control': 'no-store' });
}

async function join(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  await checkThrottle(env, ip);

  const body = await readJson(request);
  const code = String(body.code || '').trim();
  const name = cleanName(body.name);
  if (!code) throw new HttpError(400, 'enter the invite code');
  if (!name) throw new HttpError(400, 'enter a name (up to 24 characters)');

  let role = null;
  if (env.ADMIN_CODE && (await safeEqual(code, env.ADMIN_CODE))) role = 'admin';
  else if (env.INVITE_CODE && (await safeEqual(code, env.INVITE_CODE))) role = 'member';
  if (!role) {
    await recordFailure(env, ip);
    throw new HttpError(401, "that code isn't right");
  }

  // Joining with a name that already exists picks that person back up, so friends can
  // post from a phone and a laptop. The admin's name can only be claimed with the admin code.
  const nameKey = name.toLowerCase();
  let member = await env.DB.prepare('SELECT * FROM members WHERE name_key = ?').bind(nameKey).first();
  if (member && member.is_admin && role !== 'admin') {
    throw new HttpError(403, 'that name is taken, pick another');
  }
  if (!member) {
    member = { id: newId(), name, name_key: nameKey, is_admin: role === 'admin' ? 1 : 0, created_at: Date.now() };
    await env.DB.prepare('INSERT INTO members (id, name, name_key, is_admin, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(member.id, member.name, member.name_key, member.is_admin, member.created_at)
      .run();
  } else if (role === 'admin' && !member.is_admin) {
    await env.DB.prepare('UPDATE members SET is_admin = 1 WHERE id = ?').bind(member.id).run();
    member.is_admin = 1;
  }
  await env.DB.prepare('DELETE FROM join_attempts WHERE ip = ?').bind(ip).run();

  const token = await signSession(env, { m: member.id, r: role, t: Date.now() });
  return json({ member: publicMember(member) }, 200, { 'Set-Cookie': sessionCookie(token, YEAR_S) });
}

async function createPhoto(request, env) {
  const member = await requireMember(request, env);
  const form = await request.formData();

  const full = form.get('photo');
  const thumb = form.get('thumb');
  if (!(full instanceof File) || !(thumb instanceof File)) throw new HttpError(400, 'missing photo');
  if (full.size > MAX_FULL_BYTES || thumb.size > MAX_THUMB_BYTES) throw new HttpError(413, 'that photo is too big');

  // The page always re-encodes to JPEG before upload; anything else is refused.
  const [fullBytes, thumbBytes] = await Promise.all([full.arrayBuffer(), thumb.arrayBuffer()]);
  if (!isJpeg(fullBytes) || !isJpeg(thumbBytes)) throw new HttpError(415, 'photos must be JPEG');

  const width = clampInt(form.get('width'), 1, 20000, 0);
  const height = clampInt(form.get('height'), 1, 20000, 0);
  if (!width || !height) throw new HttpError(400, 'missing photo size');

  const id = newId();
  const caption = cleanCaption(form.get('caption'));
  const song = cleanSong(form.get('song'));
  const createdAt = Date.now();

  const meta = { httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' } };
  await Promise.all([
    env.BUCKET.put(`full/${id}.jpg`, fullBytes, meta),
    env.BUCKET.put(`thumb/${id}.jpg`, thumbBytes, meta),
  ]);
  await env.DB.prepare(
    'INSERT INTO photos (id, member_id, width, height, caption, song, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, member.id, width, height, caption, song ? JSON.stringify(song) : null, createdAt).run();

  return json({
    photo: publicPhoto({ id, member_id: member.id, name: member.name, width, height, caption, song: song && JSON.stringify(song), created_at: createdAt }),
  }, 201);
}

async function updatePhoto(request, env, id) {
  const member = await requireMember(request, env);
  const row = await ownedPhoto(env, member, id);
  const body = await readJson(request);

  const caption = 'caption' in body ? cleanCaption(body.caption) : row.caption;
  const song = 'song' in body ? cleanSong(body.song) : parseSong(row.song);
  await env.DB.prepare('UPDATE photos SET caption = ?, song = ? WHERE id = ?')
    .bind(caption, song ? JSON.stringify(song) : null, id)
    .run();

  return json({ photo: publicPhoto({ ...row, caption, song: song && JSON.stringify(song) }) });
}

async function deletePhoto(request, env, id) {
  const member = await requireMember(request, env);
  await ownedPhoto(env, member, id);
  await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
  await env.BUCKET.delete([`full/${id}.jpg`, `thumb/${id}.jpg`]);
  return json({ ok: true });
}

async function ownedPhoto(env, member, id) {
  const row = await env.DB.prepare(
    'SELECT p.*, m.name FROM photos p JOIN members m ON m.id = p.member_id WHERE p.id = ?'
  ).bind(id).first();
  if (!row) throw new HttpError(404, 'that photo is gone');
  if (row.member_id !== member.id && !member.isAdmin) throw new HttpError(403, "that's not your photo");
  return row;
}

/* ---------- songs ----------
   Search and previews go through here instead of the browser calling Apple directly:
   content blockers and Firefox's tracking protection can stop requests to apple.com,
   and Firefox won't play Apple's "audio/x-m4p" content type. */

const PREVIEW_URL = /^https:\/\/audio-ssl\.itunes\.apple\.com\/itunes-assets\/[^\s"'<>?#]+$/;

async function searchSongs(request, url) {
  const term = (url.searchParams.get('q') || '').trim().slice(0, 100);
  if (term.length < 2) return json({ tracks: [] });

  // same search, same answer for a day; also keeps us well under Apple's rate limit
  const cacheKey = new Request(`${url.origin}${BASE}/api/songs?q=${encodeURIComponent(term.toLowerCase())}`);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const apple = new URL('https://itunes.apple.com/search');
  apple.search = new URLSearchParams({ media: 'music', entity: 'song', limit: '15', term }).toString();
  const upstream = await fetch(apple, { headers: { Accept: 'application/json' } });
  if (!upstream.ok) throw new HttpError(502, "couldn't reach apple music. try again in a moment.");

  const data = await upstream.json();
  const tracks = (data.results || [])
    .filter((r) => r.previewUrl && PREVIEW_URL.test(r.previewUrl))
    .map((r) => ({
      id: r.trackId,
      title: r.trackName,
      artist: r.artistName,
      artwork: r.artworkUrl100 || null,
      preview: r.previewUrl,
      link: r.trackViewUrl || null,
    }));

  const response = json({ tracks }, 200, { 'Cache-Control': 'public, max-age=86400' });
  await caches.default.put(cacheKey, response.clone());
  return response;
}

async function songPreview(request, url) {
  const src = url.searchParams.get('src') || '';
  if (!PREVIEW_URL.test(src)) throw new HttpError(400, 'not an apple music preview');

  const headers = new Headers();
  const range = request.headers.get('Range');
  if (range) headers.set('Range', range); // the <audio> element seeks with ranges
  const upstream = await fetch(src, { headers, cf: { cacheEverything: true, cacheTtl: 60 * 60 * 24 * 30 } });
  if (!upstream.ok) return new Response('preview unavailable', { status: upstream.status === 404 ? 404 : 502 });

  const out = new Headers({
    'Content-Type': 'audio/mp4',
    'Cache-Control': 'public, max-age=604800',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
  });
  for (const name of ['Content-Length', 'Content-Range', 'ETag', 'Last-Modified']) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

/* ---------- images and share pages ---------- */

async function serveImage(request, env, key) {
  if (!/^(full|thumb)\/[a-z0-9]{1,32}\.jpg$/.test(key)) return new Response('not found', { status: 404 });

  const object = await env.BUCKET.get(key, { onlyIf: request.headers });
  if (!object) return new Response('not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');
  // R2 hands back metadata without a body when the browser's copy is still current
  if (!('body' in object) || !object.body) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
}

// /photo/p/<id> is the normal page with the photo opened, plus link-preview tags so
// a shared link shows the photo in iMessage, Discord, etc.
async function sharePage(request, env, url, id) {
  const page = await env.ASSETS.fetch(new URL(`${BASE}/`, url));
  const row = await env.DB.prepare(
    'SELECT p.id, p.caption, p.width, p.height, m.name FROM photos p JOIN members m ON m.id = p.member_id WHERE p.id = ?'
  ).bind(id).first();
  if (!row) return page;

  const title = `photo by ${row.name} · macc.lol`;
  const description = row.caption || 'from the macc.lol photo roll';
  const image = `${url.origin}${BASE}/img/full/${row.id}.jpg`;
  const tags = {
    'og:title': title,
    'og:description': description,
    'og:url': `${url.origin}${BASE}/p/${row.id}`,
    'og:image': image,
    'og:image:width': String(row.width),
    'og:image:height': String(row.height),
  };

  const response = new Response(page.body, page);
  response.headers.delete('ETag');
  return new HTMLRewriter()
    .on('title', { element: (el) => el.setInnerContent(title) })
    .on('meta[property^="og:"]', {
      element(el) {
        const value = tags[el.getAttribute('property')];
        if (value) el.setAttribute('content', value);
      },
    })
    .on('meta[name="description"]', { element: (el) => el.setAttribute('content', description) })
    .transform(response);
}

/* ---------- sessions ---------- */

// A session is "<payload>.<signature>". The signing key mixes in the current invite
// (or admin) code, so changing a code signs everyone who used it out.
async function signSession(env, payload) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(sessionKey(env, payload.r), body);
  return `${body}.${sig}`;
}

async function currentMember(request, env) {
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
  } catch {
    return null;
  }
  if (payload.r !== 'admin' && payload.r !== 'member') return null;
  const expected = await hmac(sessionKey(env, payload.r), body);
  if (!(await safeEqual(sig, expected))) return null;

  const row = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(payload.m).first();
  if (!row) return null;
  return { ...publicMember(row), isAdmin: payload.r === 'admin' && !!row.is_admin };
}

async function requireMember(request, env) {
  const member = await currentMember(request, env);
  if (!member) throw new HttpError(401, 'enter the invite code first');
  return member;
}

function sessionKey(env, role) {
  const code = role === 'admin' ? env.ADMIN_CODE : env.INVITE_CODE;
  if (!env.SESSION_SECRET || !code) throw new Error('INVITE_CODE, ADMIN_CODE and SESSION_SECRET must be set');
  return `${env.SESSION_SECRET}:${role}:${code}`;
}

function sessionCookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=${BASE}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

async function checkThrottle(env, ip) {
  const row = await env.DB.prepare('SELECT failures, reset_at FROM join_attempts WHERE ip = ?').bind(ip).first();
  if (row && row.reset_at > Date.now() && row.failures >= MAX_FAILURES) {
    throw new HttpError(429, 'too many wrong codes, try again in a few minutes');
  }
}

async function recordFailure(env, ip) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO join_attempts (ip, failures, reset_at) VALUES (?1, 1, ?2)
     ON CONFLICT (ip) DO UPDATE SET
       failures = CASE WHEN reset_at <= ?3 THEN 1 ELSE failures + 1 END,
       reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END`
  ).bind(ip, now + FAILURE_WINDOW_MS, now).run();
}

/* ---------- cleaning input ---------- */

function cleanName(raw) {
  const name = String(raw || '')
    .replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name.length >= 1 && name.length <= MAX_NAME ? name : null;
}

function cleanCaption(raw) {
  return String(raw || '')
    .replace(/[\p{Cc}]/gu, (c) => (c === '\n' ? c : ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CAPTION);
}

// Songs are Apple Music previews picked in the page. Only Apple's own URLs are kept,
// so a post can't point the player at arbitrary audio.
function cleanSong(raw) {
  if (raw == null || raw === '' || raw === 'null') return null;
  let s = raw;
  if (typeof raw === 'string') {
    try {
      s = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'bad song');
    }
  }
  if (!s || typeof s !== 'object') return null;

  const preview = String(s.preview || '');
  if (!/^https:\/\/audio-ssl\.itunes\.apple\.com\/[^\s"'<>]+$/.test(preview)) throw new HttpError(400, 'bad song preview');
  const artwork = /^https:\/\/[a-z0-9-]+\.mzstatic\.com\/[^\s"'<>]+$/.test(s.artwork || '') ? s.artwork : null;
  const link = /^https:\/\/(music|itunes)\.apple\.com\/[^\s"'<>]+$/.test(s.link || '') ? s.link : null;
  const start = Math.round(Math.min(Math.max(Number(s.start) || 0, 0), 30) * 10) / 10;

  return {
    id: Number(s.id) || null,
    title: String(s.title || '').slice(0, 200),
    artist: String(s.artist || '').slice(0, 200),
    artwork,
    preview,
    link,
    start,
    length: SNIPPET_S,
  };
}

function parseSong(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function publicPhoto(row) {
  return {
    id: row.id,
    owner: row.member_id,
    by: row.name,
    width: row.width,
    height: row.height,
    caption: row.caption,
    song: parseSong(row.song),
    at: row.created_at,
    thumb: `${BASE}/img/thumb/${row.id}.jpg`,
    full: `${BASE}/img/full/${row.id}.jpg`,
  };
}

function publicMember(row) {
  return { id: row.id, name: row.name, isAdmin: !!row.is_admin };
}

/* ---------- small helpers ---------- */

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    throw new HttpError(400, 'bad request body');
  }
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function clampInt(raw, min, max, fallback) {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function isJpeg(buffer) {
  const b = new Uint8Array(buffer, 0, Math.min(3, buffer.byteLength));
  return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function newId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))));
}

// constant-time compare of two strings of any length
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text) {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
