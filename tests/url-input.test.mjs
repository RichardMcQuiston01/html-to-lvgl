/**
 * URL input mode: a local node:http server stands in for a served app.
 * The CLI runs as a subprocess (it is a top-level script), pointed at URLs.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { urlScreenName, isUrlInput, parseInputUrl, normalizeLinks, describeNavigationError } from '../src/url-input.mjs';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'src', 'cli.mjs');
const examples = join(here, '..', 'examples');

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** @type {import('node:http').Server} */ let server;
/** @type {import('node:http').Server} */ let other;
let base = '';
let otherBase = '';
const seen = []; // paths the "other origin" received

before(async () => {
  other = createServer((req, res) => { seen.push(req.url); res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  otherBase = `http://127.0.0.1:${other.address().port}`;

  server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const html = (body) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(body); };
    if (path.startsWith('/examples/')) {
      try { html(readFileSync(join(examples, path.slice('/examples/'.length)))); } catch { res.writeHead(404).end('nope'); }
    } else if (path === '/logo.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); }
    else if (path === '/loop') { res.writeHead(302, { location: '/loop' }).end(); }
    else if (path === '/away') { res.writeHead(302, { location: `${otherBase}/x.html` }).end(); }
    else if (path === '/boom') { res.writeHead(500).end('boom'); }
    else if (path === '/slow') { /* never answers */ }
    else if (path === '/late') {
      html('<body style="margin:0"><div id="root"></div><script>setTimeout(()=>{document.getElementById("root").innerHTML="<p id=ready style=\\"font-size:20px\\">Loaded later</p>"},600)</script></body>');
    } else if (path === '/ext') {
      html(`<body style="margin:0"><p>Hi</p><img src="${otherBase}/pixel.png" width="10" height="10"><img src="/logo.png" width="10" height="10"></body>`);
    } else if (path === '/app/') {
      html('<body style="margin:0"><a href="/app/about" style="display:block;width:100px;height:30px">About</a></body>');
    } else if (path === '/app/about') {
      html('<body style="margin:0"><a href="/app/" style="display:block;width:100px;height:30px">Home</a></body>');
    } else res.writeHead(404).end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server.close(); other.close(); });

const out = () => mkdtempSync(join(tmpdir(), 'html2lvgl-url-'));
/** Run the CLI, returning { code, stdout, stderr } without throwing. */
async function cliRun(args) {
  try {
    const r = await run('node', [cli, ...args], { encoding: 'utf8' });
    return { code: 0, ...r };
  } catch (e) {
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

test('unit: isUrlInput, urlScreenName, parseInputUrl', () => {
  assert.equal(isUrlInput('http://a/b'), true);
  assert.equal(isUrlInput('examples/a.html'), false);
  assert.equal(isUrlInput('C:\\a.html'), false);
  assert.equal(urlScreenName('http://h/app/Settings.html?x=1'), 'settings');
  assert.equal(urlScreenName('http://h/'), 'index');
  assert.equal(urlScreenName('http://h/app/my-page'), 'my_page');
  assert.throws(() => parseInputUrl('ftp://h/a'), /Only http/);
  assert.throws(() => parseInputUrl('http://u:p@h/a'), /credentials/);
  assert.throws(() => parseInputUrl('http://'), /not a valid URL/);
  assert.match(describeNavigationError(new Error('net::ERR_NAME_NOT_RESOLVED at http://x'), 'http://x', 1), /DNS/);
});

test('unit: normalizeLinks maps root-relative, relative and external links', () => {
  const tree = { attrs: { href: '/app/settings.html' }, children: [
    { attrs: { href: '../home' }, children: [] },
    { attrs: { href: 'https://elsewhere.test/x' }, link: '/docs/', children: [] },
  ] };
  normalizeLinks(tree, new URL('http://h/app/page'));
  assert.equal(tree.attrs.href, '/app/settings.html');
  assert.equal(tree.children[0].attrs.href, '/home');
  assert.equal(tree.children[1].attrs.href, 'https://elsewhere.test/x');
  assert.equal(tree.children[1].link, '/docs/index');
});

test('a URL converts to exactly the same XML as the file', async () => {
  for (const page of ['dashboard', 'monitor']) {
    const fileOut = out();
    const urlOut = out();
    const f = await cliRun([join(examples, `${page}.html`), '-o', fileOut]);
    const u = await cliRun([`${base}/examples/${page}.html`, '-o', urlOut]);
    assert.equal(f.code, 0, f.stderr);
    assert.equal(u.code, 0, u.stderr);
    assert.equal(readFileSync(join(urlOut, `${page}.xml`), 'utf8'), readFileSync(join(fileOut, `${page}.xml`), 'utf8'), `${page}.xml differs`);
  }
});

test('a file:// URL converts like the plain path', async () => {
  const fileOut = out();
  const urlOut = out();
  await cliRun([join(examples, 'dashboard.html'), '-o', fileOut]);
  const u = await cliRun([pathToFileURL(join(examples, 'dashboard.html')).href, '-o', urlOut]);
  assert.equal(u.code, 0, u.stderr);
  assert.equal(readFileSync(join(urlOut, 'dashboard.xml'), 'utf8'), readFileSync(join(fileOut, 'dashboard.xml'), 'utf8'));
});

test('several URLs become linked screens resolved by URL path', async () => {
  const o = out();
  const r = await cliRun([`${base}/app/`, `${base}/app/about`, '-o', o]);
  assert.equal(r.code, 0, r.stderr);
  const files = readdirSync(o);
  assert.ok(files.includes('index.xml') && files.includes('about.xml'), files.join(','));
  assert.match(readFileSync(join(o, 'index.xml'), 'utf8'), /screen_create_event|about/);
  assert.match(readFileSync(join(o, 'about.xml'), 'utf8'), /screen_create_event|index/);
});

test('images are downloaded into assets/ like the file flow copies them', async () => {
  const o = out();
  const r = await cliRun([`${base}/ext`, '-o', o]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(existsSync(join(o, 'assets', 'logo.png')), readdirSync(o).join(','));
});

test('--block-external aborts cross-origin requests and skips their download', async () => {
  seen.length = 0;
  const open = await cliRun([`${base}/ext`, '-o', out()]);
  assert.equal(open.code, 0, open.stderr);
  assert.ok(seen.includes('/pixel.png'), 'without the flag the page loads the other origin');

  seen.length = 0;
  const o = out();
  const blocked = await cliRun([`${base}/ext`, '--block-external', '-o', o]);
  assert.equal(blocked.code, 0, blocked.stderr);
  assert.deepEqual(seen, [], 'no request reached the other origin');
  assert.ok(!existsSync(join(o, 'assets', 'pixel.png')));
  assert.ok(existsSync(join(o, 'assets', 'logo.png')));
});

test('--wait-for waits for content added after load', async () => {
  const o = out();
  const r = await cliRun([`${base}/late`, '--wait-for', '#ready', '-o', o]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(readFileSync(join(o, 'late.xml'), 'utf8'), /Loaded later/);

  const missing = await cliRun([`${base}/late`, '--wait-for', '#nope', '--timeout', '1500', '-o', out()]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /--wait-for "#nope" never became visible/);
  assert.doesNotMatch(missing.stderr, /\n\s+at /);
});

test('--wait-ms delays extraction', async () => {
  const o = out();
  const r = await cliRun([`${base}/late`, '--wait-ms', '1200', '-o', o]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(readFileSync(join(o, 'late.xml'), 'utf8'), /Loaded later/);
});

test('failures name the URL and the fix, with no stack trace', async () => {
  // A port that was just free and is now closed: connection refused.
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const closedPort = probe.address().port;
  await new Promise((r) => probe.close(r));
  const cases = [
    [`${base}/missing`, /answered HTTP 404/],
    [`${base}/boom`, /answered HTTP 500/],
    [`${base}/loop`, /redirects in a loop/],
    [`${base}/away`, /redirected to a different origin/],
    [`${base}/slow`, /timed out after 800 ms.*--timeout/, ['--timeout', '800']],
    [`http://127.0.0.1:${closedPort}/`, /connection refused/],
    ['http://no-such-host.invalid/', /resolve the host|DNS/],
    ['ftp://example.com/a.html', /Only http/],
    ['http://user:pw@127.0.0.1/', /credentials/],
  ];
  for (const [url, pattern, extra = []] of cases) {
    const r = await cliRun([url, ...extra, '-o', out()]);
    assert.equal(r.code, 1, `${url}: expected exit 1`);
    assert.match(r.stderr, pattern, url);
    assert.doesNotMatch(r.stderr, /\n\s+at /, `${url}: stack trace leaked`);
  }
});

test('--watch with a URL is rejected clearly; URL flags need a URL; no mixing', async () => {
  const w = await cliRun([`${base}/examples/dashboard.html`, '--watch']);
  assert.equal(w.code, 1);
  assert.match(w.stderr, /--watch does not support URLs/);

  const f = await cliRun([join(examples, 'dashboard.html'), '--block-external', '-o', out()]);
  assert.equal(f.code, 1);
  assert.match(f.stderr, /only apply to URL inputs/);

  const m = await cliRun([`${base}/examples/dashboard.html`, join(examples, 'monitor.html')]);
  assert.equal(m.code, 1);
  assert.match(m.stderr, /all URLs or all files/);

  const t = await cliRun([`${base}/examples/dashboard.html`, '--timeout', 'abc']);
  assert.equal(t.code, 1);
  assert.match(t.stderr, /invalid --timeout/);
});
