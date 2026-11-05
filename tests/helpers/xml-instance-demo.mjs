/**
 * Test-only: a page whose two sections are instances of the hand-written
 * library component spike/subjects/xml/ui_acc_g.xml (props title + subj),
 * each with its own subject. Used to check that the C and C++ emitters turn an
 * xmlComponent node into lv_xml_create with the subject name as a prop, and
 * that the subject is registered so the component can resolve it
 * (spike/subjects/run-c.sh drives the result in real LVGL).
 */
import { declareSubject, withBehavior, xmlComponent } from '../../src/behavior.mjs';
import { convert } from '../../src/convert.mjs';
import { createRegistry } from '../../src/recognize.mjs';
import { node } from './tree.mjs';

const instance = {
  name: 'demo-acc-instance',
  match: (n) => /^acc[ab]$/.test(n.id ?? ''),
  props: {},
  slots: [],
  build: (n) => withBehavior(
    { ...n, ...xmlComponent('ui_acc_g', { title: `Instance ${n.id.slice(3).toUpperCase()}`, subj: { subject: `${n.id}_open` } }) },
    { subjects: [declareSubject(`${n.id}_open`, n.id === 'acca' ? 1 : 0)] },
  ),
};

export function instanceTree() {
  const column = { display: 'flex', flexDirection: 'column', position: 'static', rowGap: 0 };
  return node('body', { w: 320, h: 240, layout: column, styles: { bgColor: [11, 18, 32, 255] } }, [
    node('div', { id: 'acca', w: 320, h: 80 }),
    node('div', { id: 'accb', w: 320, h: 80 }),
    node('p', { text: 'footer', w: 320, h: 20 }),
  ]);
}

export const convertInstances = () => convert(instanceTree(), { name: 'acc_instances', screenMode: true, registry: createRegistry([instance]) });
