import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert } from '../src/convert.mjs';
import { applyOverrides } from '../src/overrides.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';

const styles = {
  bgColor: [239, 239, 239, 255], color: [0, 0, 0, 255], borderColor: [0, 0, 0, 255], borderWidth: 1,
  borderBottomColor: null, borderBottomWidth: 0, radius: 0, fontSize: 14, fontFamily: 'sans-serif',
  fontWeight: 400, fontItalic: false, textAlign: 'center', opacity: 1, padLeft: 0, padRight: 0, padTop: 0,
  padBottom: 0, gradient: null, shadow: null, scrollable: false, pressed: null,
};
const layout = { display: 'block', position: 'static', flexGrow: 0 };

/** A node in the shape extract.mjs produces. */
function node(tag, extra = {}, children = []) {
  return {
    tag, id: null, className: null, component: null, widget: null, lvName: null, link: null,
    x: 0, y: 0, w: 100, h: 30, text: null, attrs: {}, styles: { ...styles }, layout: { ...layout },
    children, ...extra,
  };
}
const page = (...children) => node('body', { w: 320, h: 240, bgColor: null }, children);

/** The `name` attribute of every element of one tag, in document order. */
const namesOf = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}\\s[^>]*?name="([^"]*)"`, 'g'))].map((m) => m[1]);

test('a button named by the author keeps that name; its label gets the suffix', () => {
  const { xml } = convert(page(node('button', { lvName: 'save', text: 'Save' })));
  assert.deepEqual(namesOf(xml, 'lv_button'), ['save']);
  assert.deepEqual(namesOf(xml, 'lv_label'), ['save_2']);
});

test('the same holds for an id and for a class', () => {
  const byId = convert(page(node('button', { id: 'ok', text: 'OK' }))).xml;
  assert.deepEqual(namesOf(byId, 'lv_button'), ['ok']);
  const byClass = convert(page(node('button', { className: 'primary', text: 'Go' }))).xml;
  assert.deepEqual(namesOf(byClass, 'lv_button'), ['primary']);
});

test('a container with its own text keeps the author-chosen name, like a decorated text block', () => {
  // emitContainer is used for a div that has child elements as well as text
  const plain = { ...styles, bgColor: null, borderWidth: 0 };
  const child = node('span', { text: 'child', w: 40, styles: plain });
  const box = node('div', { lvName: 'panel', text: 'Hello', styles: plain }, [child]);
  const { xml } = convert(page(box));
  assert.deepEqual(namesOf(xml, 'lv_obj'), ['panel']);
  assert.deepEqual(namesOf(xml, 'lv_label'), ['panel_2', 'label']);
});

test('a navigation button keeps the author-chosen name', () => {
  const link = node('button', { lvName: 'to_settings_btn', link: 'settings.html', text: 'Settings' });
  const { xml } = convert(page(link), { screens: new Set(['home', 'settings']), screenMode: true });
  assert.deepEqual(namesOf(xml, 'lv_button'), ['to_settings_btn']);
  assert.match(xml, /screen_create_event screen="settings"/);
});

test('without an author-chosen name nothing changes: the button is "button" and its label "label"', () => {
  const { xml } = convert(page(node('button', { text: 'Plain' })));
  assert.deepEqual(namesOf(xml, 'lv_button'), ['button']);
  assert.deepEqual(namesOf(xml, 'lv_label'), ['label']);
});

test('a sidecar override aimed at a named button changes the button, not its label', () => {
  const { view } = convert(page(node('button', { lvName: 'save', text: 'Save' })));
  const diagnostics = createDiagnostics();
  const out = applyOverrides(view, { version: 1, nodes: { save: { attrs: { width: 150 } } } }, { diagnostics });
  const find = (n, tag) => (n.tag === tag ? [n] : (n.children ?? []).flatMap((c) => find(c, tag)));
  const [button] = find(out, 'lv_button');
  const [label] = find(out, 'lv_label');
  assert.equal(button.attrs.width, 150);
  assert.notEqual(label.attrs.width, 150);
  assert.equal(diagnostics.list().length, 0);
});

test('a name that collides with another node\'s numbered name is still unique', () => {
  const { xml } = convert(page(
    node('div', { lvName: 'item_2' }),
    node('div', { lvName: 'item' }),
    node('div', { lvName: 'item' }),
  ));
  const names = namesOf(xml, 'lv_obj');
  assert.equal(new Set(names).size, names.length, names.join(','));
});
