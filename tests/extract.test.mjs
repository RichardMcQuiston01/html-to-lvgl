/**
 * Extraction tests that need a real browser (font-family resolution can't be
 * verified any other way — see the comment in extract.mjs on why
 * document.fonts.check() doesn't work for this).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractPage } from '../src/extract.mjs';

const LIBERATION_SANS = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf';

function findByText(node, text) {
  if (node.text === text) return node;
  for (const child of node.children ?? []) {
    const found = findByText(child, text);
    if (found) return found;
  }
  return null;
}

async function extractHtml(html) {
  const dir = mkdtempSync(join(tmpdir(), 'html2lvgl-extract-'));
  const file = join(dir, 'page.html');
  writeFileSync(file, html);
  return extractPage(file);
}

test('an unavailable named font falls through to the next stack entry, not the first', async () => {
  const tree = await extractHtml(`<!DOCTYPE html><html><body style="margin:0">
    <p style="font-family: 'TotallyFakeFontXYZ123', serif; font-size: 16px;">hi</p>
  </body></html>`);
  const node = findByText(tree, 'hi');
  // getComputedStyle keeps the whole stack ("TotallyFakeFontXYZ123, serif");
  // naively taking the first entry would report the fake name as if it
  // rendered. The generic fallback needs no installed font to verify.
  assert.equal(node.styles.fontFamily, 'serif');
});

test('an available named font in the stack is preferred over the generic fallback', { skip: existsSync(LIBERATION_SANS) ? false : 'Liberation Sans not installed' }, async () => {
  const tree = await extractHtml(`<!DOCTYPE html><html><body style="margin:0">
    <p style="font-family: 'Liberation Sans', sans-serif; font-size: 16px;">hi</p>
  </body></html>`);
  const node = findByText(tree, 'hi');
  assert.equal(node.styles.fontFamily, 'Liberation Sans');
});

test('a :hover/:active rule only applies pressed styles to the branch that carries the pseudo-class', async () => {
  const tree = await extractHtml(`<!DOCTYPE html><html><head><style>
    .btn:hover, .link { background-color: #ff0000; }
  </style></head><body style="margin:0">
    <button class="btn">Go</button>
    <a class="link" href="#">Learn more</a>
  </body></html>`);
  const btn = findByText(tree, 'Go');
  const link = findByText(tree, 'Learn more');
  // Only .btn carries :hover; .link must not inherit a pressed style just
  // because it shares a selector list with a rule that does.
  assert.ok(btn.styles.pressed);
  assert.equal(link.styles.pressed, null);
});

/* ---------------------------------------------- Phase 6: ARIA + hidden */

function walkAll(node, fn) {
  fn(node);
  for (const c of node.children ?? []) walkAll(c, fn);
}

const countNodes = (node) => {
  let n = 0;
  walkAll(node, () => (n += 1));
  return n;
};

test('role, aria, classes and testId are captured; className keeps the first class', async () => {
  const tree = await extractHtml(`<!DOCTYPE html><html><body style="margin:0">
    <button id="b" role="tab" class="one two  three" data-testid="save-btn" aria-expanded="true" aria-controls="panel1">go</button>
    <p>plain</p>
  </body></html>`);
  const b = findByText(tree, 'go');
  assert.equal(b.role, 'tab');
  assert.deepEqual(b.aria, { expanded: 'true', controls: 'panel1' });
  assert.deepEqual(b.classes, ['one', 'two', 'three']);
  assert.equal(b.className, 'one');
  assert.equal(b.testId, 'save-btn');
  assert.equal(b.id, 'b');
  assert.equal(b.hidden, false);

  const p = findByText(tree, 'plain');
  assert.equal(p.role, null);
  assert.deepEqual(p.aria, {});
  assert.deepEqual(p.classes, []);
  assert.equal(p.testId, null);
});

test('classes is an array on SVG elements, whose className is not a string', async () => {
  const tree = await extractHtml(`<!DOCTYPE html><html><body style="margin:0">
    <svg width="20" height="20" class="icon big"><circle cx="5" cy="5" r="4"/></svg>
  </body></html>`);
  const svg = tree.children.find((c) => c.tag === 'svg');
  assert.ok(svg);
  assert.ok(Array.isArray(svg.classes));
});

test('a display:none subtree is kept and every descendant is hidden', async () => {
  const tree = await extractHtml(`<!DOCTYPE html><html><body style="margin:0">
    <p>shown</p>
    <div id="panel" style="display:none"><div><span>deep secret</span></div><p>second</p></div>
  </body></html>`);
  assert.equal(findByText(tree, 'shown').hidden, false);
  const panel = tree.children.find((c) => c.id === 'panel');
  assert.ok(panel, 'the display:none element is kept');
  assert.equal(panel.hidden, true);
  let all = 0;
  walkAll(panel, (n) => {
    all += 1;
    assert.equal(n.hidden, true, `${n.tag} should be hidden`);
  });
  assert.equal(all, 4);
  assert.equal(findByText(tree, 'deep secret').hidden, true);
});

test('a visibility:hidden subtree is kept and hidden, even if a child is visible', async () => {
  const tree = await extractHtml(`<!DOCTYPE html><html><body style="margin:0">
    <div id="v" style="visibility:hidden"><span style="visibility:visible">peek</span><b>gone</b></div>
  </body></html>`);
  const v = tree.children.find((c) => c.id === 'v');
  assert.equal(v.hidden, true);
  walkAll(v, (n) => assert.equal(n.hidden, true));
  assert.ok(findByText(tree, 'gone'));
});

test('a zero-size element is kept and hidden', async () => {
  const tree = await extractHtml(`<!DOCTYPE html><html><body style="margin:0">
    <p>shown</p><div id="z" style="width:0;height:0;overflow:hidden"><span>tiny</span></div>
  </body></html>`);
  const z = tree.children.find((c) => c.id === 'z');
  assert.equal(z.hidden, true);
  assert.equal(findByText(tree, 'tiny').hidden, true);
});

test('data-lv-ignore still drops the element entirely, hidden or not', async () => {
  const tree = await extractHtml(`<!DOCTYPE html><html><body style="margin:0">
    <div id="a" data-lv-ignore><span>ignored</span></div>
    <div id="b" data-lv-ignore style="display:none"><span>ignored too</span></div>
    <div id="c" style="display:none"><span data-lv-ignore>inner</span><i>kept</i></div>
    <script>1</script><style>p{}</style>
  </body></html>`);
  assert.equal(findByText(tree, 'ignored'), null);
  assert.equal(findByText(tree, 'ignored too'), null);
  assert.equal(findByText(tree, 'inner'), null);
  assert.ok(findByText(tree, 'kept'));
  assert.ok(!tree.children.some((c) => c.id === 'a' || c.id === 'b'));
  assert.ok(!tree.children.some((c) => c.tag === 'script' || c.tag === 'style'));
});

test('a hidden page root yields no tree, as before', async () => {
  const tree = await extractHtml(`<!DOCTYPE html><html><body style="display:none"><p>x</p></body></html>`);
  assert.equal(tree, null);
});

test('hidden subtrees are bounded in depth', async () => {
  const depth = 30;
  const html = `<!DOCTYPE html><html><body style="margin:0"><p>shown</p><div id="deep" style="display:none">${'<div>'.repeat(depth)}x${'</div>'.repeat(depth)}</div></body></html>`;
  const tree = await extractHtml(html);
  const deep = tree.children.find((c) => c.id === 'deep');
  let levels = 0;
  let n = deep;
  while (n.children.length) {
    n = n.children[0];
    levels += 1;
  }
  assert.equal(levels, 12, 'descent stops 12 levels below the hidden root');
});

test('hidden subtrees are bounded in total node count', async () => {
  const html = `<!DOCTYPE html><html><body style="margin:0"><p>shown</p><div style="display:none">${'<span>a</span>'.repeat(3000)}</div></body></html>`;
  const tree = await extractHtml(html);
  const total = countNodes(tree);
  assert.ok(total <= 2000 + 2, `kept ${total} nodes`);
  assert.ok(total >= 1900, 'but still keeps a useful amount');
});

test('a page with hidden content converts to the same XML as one without', async () => {
  const { convert } = await import('../src/convert.mjs');
  const { planFonts } = await import('../src/fonts-build.mjs');
  const visible = `<h1 style="font-size:20px">Title</h1><button style="padding:8px">Go</button>`;
  const hiddenStuff = `
    <div style="display:none"><p style="font-family:'Zzz Font'">secret text</p></div>
    <div style="visibility:hidden;position:absolute"><button>nope</button></div>
    <div role="region" aria-hidden="true" style="width:0;height:0"><span>tiny</span></div>`;
  const page = (extra) => `<!DOCTYPE html><html><body style="margin:0">${visible}${extra}</body></html>`;
  const without = await extractHtml(page(''));
  const withHidden = await extractHtml(page(hiddenStuff));
  assert.ok(countNodes(withHidden) > countNodes(without), 'the hidden nodes are in the raw tree');
  assert.equal(convert(withHidden).xml, convert(without).xml);
  assert.deepEqual(planFonts(withHidden), planFonts(without), 'font planning ignores hidden text');
});

test('a multi-layer box-shadow keeps its largest layer', async () => {
  const tree = await extractHtml(`<!DOCTYPE html><html><body style="margin:0">
    <div id="a" style="width:80px;height:40px;box-shadow: 0 2px 1px -1px rgba(0,0,0,.2), 0 1px 1px 0 rgba(0,0,0,.14), 0 6px 18px 2px rgba(0,0,0,.12), inset 0 0 40px 0 rgba(0,0,0,.5)">x</div>
  </body></html>`);
  const node = findByText(tree, 'x');
  assert.equal(node.styles.shadow.blur, 18);
  assert.equal(node.styles.shadow.y, 6);
  assert.equal(node.styles.shadow.spread, 2);
});

test('a percentage border radius resolves against the box', async () => {
  const tree = await extractHtml(`<!DOCTYPE html><html><body style="margin:0">
    <div style="width:40px;height:40px;border-radius:50%">c</div>
    <div style="width:80px;height:32px;border-radius:25%">p</div>
  </body></html>`);
  assert.equal(findByText(tree, 'c').styles.radius, 20);
  assert.equal(findByText(tree, 'p').styles.radius, 8);
});

test('an elliptical border radius uses its horizontal value in its own unit', async () => {
  const tree = await extractHtml(`<!DOCTYPE html><html><body style="margin:0">
    <div style="width:40px;height:40px;border-top-left-radius:12px 50%">m</div>
    <div style="width:40px;height:40px;border-top-left-radius:50% 12px">n</div>
  </body></html>`);
  assert.equal(findByText(tree, 'm').styles.radius, 12);
  assert.equal(findByText(tree, 'n').styles.radius, 20);
});
