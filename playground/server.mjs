#!/usr/bin/env node
/**
 * RaceUI playground: a deliberately vulnerable local web app plus a corrected variant.
 *
 *   node playground/server.mjs --mode vulnerable   # check-then-act races (demonstrates bugs)
 *   node playground/server.mjs --mode fixed        # atomic / optimistic-locking handlers
 *
 * Options: --port <n> (default 3000, env PORT), --delay <ms> (default 150).
 * Test-support endpoints require "Authorization: Bearer <RACEUI_FIXTURE_TOKEN>" (default "dev-token").
 *
 * This is a test fixture only, NOT a production architecture recommendation. It binds to 127.0.0.1.
 */
import http from 'node:http';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const o = { mode: 'vulnerable', port: Number(process.env.PORT ?? 3000), delay: 150, host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') o.mode = argv[++i];
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--delay') o.delay = Number(argv[++i]);
    else if (a === '--help' || a === '-h') o.help = true;
  }
  if (!['vulnerable', 'fixed'].includes(o.mode)) throw new Error(`--mode must be "vulnerable" or "fixed"`);
  return o;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(title, user, body, script = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#1f2328}
button{background:#0a6cf0;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:16px;cursor:pointer}
button:disabled{opacity:.5}.result{margin-top:16px;font-size:18px;font-weight:600}.ok{color:#1a7f37}.err{color:#cf222e}
input{font-size:16px;padding:8px;border:1px solid #ccc;border-radius:6px}header{color:#666;font-size:14px;margin-bottom:24px}</style>
</head><body><header>RaceUI playground &middot; signed in as <b data-testid="current-user">${esc(user ?? 'anonymous')}</b></header>
${body}<script>${script}</script></body></html>`;
}

const ACTION_SCRIPT = (endpoint, payload, okMsg, conflictMsg, btn) => `
const btn = document.querySelector('[data-testid="${btn}"]');
const out = document.getElementById('result');
btn.addEventListener('click', async () => {
  btn.disabled = true;
  try {
    const res = await fetch(${JSON.stringify(endpoint)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${payload}) });
    if (res.ok) { out.textContent = ${JSON.stringify(okMsg)}; out.className = 'result ok'; }
    else if (res.status === 409) { out.textContent = ${JSON.stringify(conflictMsg)}; out.className = 'result err'; }
    else { out.textContent = 'Error ' + res.status; out.className = 'result err'; }
  } catch (e) { out.textContent = 'Network error'; out.className = 'result err'; }
});`;

export function createPlayground({ mode = 'vulnerable', delay = 150, token = process.env.RACEUI_FIXTURE_TOKEN || 'dev-token' } = {}) {
  const state = {
    seats: new Map(), // seatId -> [{ user, at }]
    attendance: [], // { employee, date, at }
    records: new Map(), // id -> { value, version, writes }
  };
  const reset = () => {
    state.seats.clear();
    state.attendance = [];
    state.records.clear();
  };
  const seat = (id) => {
    if (!state.seats.has(id)) state.seats.set(id, []);
    return state.seats.get(id);
  };
  const record = (id) => {
    if (!state.records.has(id)) state.records.set(id, { value: 'initial', version: 1, writes: 0 });
    return state.records.get(id);
  };
  const today = () => new Date().toISOString().slice(0, 10);

  const send = (res, status, body, headers = {}) => {
    const isJson = typeof body !== 'string';
    res.writeHead(status, { 'content-type': isJson ? 'application/json' : 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(isJson ? JSON.stringify(body) : body);
  };
  const readJson = (req) =>
    new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => {
        data += c;
        if (data.length > 64 * 1024) req.destroy();
      });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
    });
  const userOf = (req) => /(?:^|;\s*)pg_user=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://playground');
    const p = url.pathname;
    const user = userOf(req);
    let m;

    // ---- test-support (fixture) API -------------------------------------------------
    if (p.startsWith('/test-support/')) {
      if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: 'unauthorized' });
      if (req.method === 'POST' && p === '/test-support/reset') {
        reset();
        return send(res, 200, { reset: true });
      }
      if (req.method === 'GET' && (m = /^\/test-support\/([\w.-]+)\/booking-count$/.exec(p))) {
        const b = seat(m[1]);
        return send(res, 200, { seat: m[1], count: b.length, users: b.map((x) => x.user) });
      }
      if (req.method === 'GET' && (m = /^\/test-support\/attendance\/([\w.-]+)\/count$/.exec(p))) {
        const count = state.attendance.filter((a) => a.employee === m[1] && a.date === today()).length;
        return send(res, 200, { employee: m[1], date: today(), count });
      }
      if (req.method === 'GET' && (m = /^\/test-support\/records\/([\w.-]+)$/.exec(p))) {
        return send(res, 200, record(m[1]));
      }
      return send(res, 404, { error: 'not found' });
    }

    // ---- session ------------------------------------------------------------------------
    if (req.method === 'GET' && p === '/login') {
      const u = url.searchParams.get('user') ?? '';
      const next = url.searchParams.get('next') ?? '/';
      if (!/^[\w.-]{1,40}$/.test(u)) return send(res, 400, 'invalid user');
      const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
      return send(res, 302, '', { location: safeNext, 'set-cookie': `pg_user=${u}; Path=/; HttpOnly; SameSite=Lax` });
    }

    // ---- pages ----------------------------------------------------------------------------
    if (req.method === 'GET' && p === '/') {
      return send(res, 200, page('RaceUI playground', user, `<h1>RaceUI playground <small>(${mode})</small></h1>
<ul><li><a href="/booking/seat-01">Seat booking</a></li><li><a href="/attendance">Attendance clock-in</a></li><li><a href="/records/1">Shared record editor</a></li></ul>`));
    }
    if (req.method === 'GET' && (m = /^\/booking\/([\w.-]+)$/.exec(p))) {
      const id = m[1];
      const free = seat(id).length === 0;
      return send(res, 200, page(`Book ${id}`, user, `<h1>Seat ${esc(id)}</h1><p>Status: <span data-testid="seat-status">${free ? 'available' : 'taken'}</span></p>
<button data-testid="confirm-booking">Confirm booking</button><div id="result" class="result" role="status"></div>`,
        ACTION_SCRIPT('/api/bookings', `{ seat: ${JSON.stringify(id)} }`, 'Booking successful', 'Seat unavailable', 'confirm-booking')));
    }
    if (req.method === 'GET' && p === '/attendance') {
      return send(res, 200, page('Attendance', user, `<h1>Attendance</h1><p>Employee: ${esc(user ?? '-')}</p>
<button data-testid="clock-in">Clock in</button><div id="result" class="result" role="status"></div>`,
        ACTION_SCRIPT('/api/attendance', '{}', 'Clocked in', 'Already clocked in', 'clock-in')));
    }
    if (req.method === 'GET' && (m = /^\/records\/([\w.-]+)$/.exec(p))) {
      const r = record(m[1]);
      return send(res, 200, page(`Record ${m[1]}`, user, `<h1>Record ${esc(m[1])}</h1><p>Version ${r.version}</p>
<label>Value <input data-testid="record-value" id="value" value="${esc(r.value)}"></label>
<button data-testid="save-record">Save</button><div id="result" class="result" role="status"></div>`,
        ACTION_SCRIPT(`/api/records/${m[1]}`, `{ value: document.getElementById('value').value, version: ${r.version} }`, 'Saved', 'Conflict: record was modified by someone else', 'save-record')));
    }

    // ---- mutating API -------------------------------------------------------------------
    if (req.method === 'POST' && p === '/api/bookings') {
      if (!user) return send(res, 401, { error: 'login required' });
      const { seat: id } = await readJson(req);
      if (typeof id !== 'string') return send(res, 400, { error: 'seat required' });
      const bookings = seat(id);
      if (mode === 'vulnerable') {
        // BUG (intentional): check, then await, then commit. Concurrent requests both pass the check.
        const available = bookings.length === 0;
        await sleep(delay);
        if (!available) return send(res, 409, { error: 'seat unavailable' });
        bookings.push({ user, at: Date.now() });
        return send(res, 200, { booked: id });
      }
      // FIXED: check-and-commit in one synchronous step (atomic in a single-threaded runtime).
      if (bookings.length > 0) {
        await sleep(delay);
        return send(res, 409, { error: 'seat unavailable' });
      }
      bookings.push({ user, at: Date.now() });
      await sleep(delay);
      return send(res, 200, { booked: id });
    }
    if (req.method === 'POST' && p === '/api/attendance') {
      if (!user) return send(res, 401, { error: 'login required' });
      const exists = () => state.attendance.some((a) => a.employee === user && a.date === today());
      if (mode === 'vulnerable') {
        const already = exists();
        await sleep(delay);
        if (already) return send(res, 409, { error: 'already clocked in' });
        state.attendance.push({ employee: user, date: today(), at: Date.now() });
        return send(res, 200, { clockedIn: true });
      }
      if (exists()) {
        await sleep(delay);
        return send(res, 409, { error: 'already clocked in' });
      }
      state.attendance.push({ employee: user, date: today(), at: Date.now() });
      await sleep(delay);
      return send(res, 200, { clockedIn: true });
    }
    if (req.method === 'POST' && (m = /^\/api\/records\/([\w.-]+)$/.exec(p))) {
      if (!user) return send(res, 401, { error: 'login required' });
      const { value, version } = await readJson(req);
      const r = record(m[1]);
      if (mode === 'vulnerable') {
        // BUG (intentional): last write wins; the version sent by the client is ignored.
        await sleep(delay);
        r.value = String(value);
        r.version += 1;
        r.writes += 1;
        return send(res, 200, r);
      }
      // FIXED: optimistic locking.
      if (version !== r.version) {
        await sleep(delay);
        return send(res, 409, { error: 'version conflict', current: r.version });
      }
      r.value = String(value);
      r.version += 1;
      r.writes += 1;
      await sleep(delay);
      return send(res, 200, r);
    }

    return send(res, 404, page('Not found', user, '<h1>Not found</h1>'));
  };

  const server = http.createServer((req, res) => {
    handler(req, res).catch((e) => send(res, 500, { error: String(e?.message ?? e) }));
  });
  return { server, state, reset };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    const norm = (f) => {
      const r = realpathSync(f);
      return process.platform === 'win32' ? r.toLowerCase() : r;
    };
    return norm(process.argv[1]) === norm(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
const isMain = isMainModule();
if (isMain) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (opts.help) {
    console.log('Usage: raceui-playground [--mode vulnerable|fixed] [--port 3000] [--delay 150]');
    process.exit(0);
  }
  const { server } = createPlayground(opts);
  server.listen(opts.port, opts.host, () => {
    console.log(`RaceUI playground (${opts.mode}) listening on http://127.0.0.1:${opts.port}`);
    console.log(`Fixture token: RACEUI_FIXTURE_TOKEN=${process.env.RACEUI_FIXTURE_TOKEN ? '(from env)' : 'dev-token'}`);
  });
}
