/**
 * ARIA trigger/target linking: pair every element that controls another
 * (`aria-controls="panel1"`, usually with `aria-expanded`) with the element
 * whose `id` it names. Accordion, Drawer, Modal and Menu all need this.
 *
 * The contract, which recognize() relies on:
 *   - Input: the whole UiNode tree (hidden nodes included), already annotated
 *     with keys (see annotateKeys in src/recognize.mjs). Nodes without a key
 *     are ignored.
 *   - Output: a Map from a node's `key` to
 *     `{ controls: string[], controlledBy: string[],
 *        labelledBy?: string[], describedBy?: string[] }`, holding other
 *     nodes' keys. A trigger lists its targets in `controls`; a target lists
 *     its triggers in `controlledBy`. Nodes with no links are absent.
 *   - `aria-owns` is read exactly like `aria-controls` and adds to the same
 *     lists.
 *   - `labelledBy` / `describedBy` are optional and appear only on a node
 *     whose own `aria.labelledby` / `aria.describedby` names existing nodes:
 *     they hold those nodes' keys (a dialog's title and body).
 *   - Ids are searched across ALL nodes, hidden ones included. When several
 *     nodes share an id, the first in document order wins. A node never links
 *     to itself. Absent `aria` is treated as none.
 *   - Order is deterministic: `controls` follows the order the ids are listed
 *     (aria-controls first, then aria-owns); `controlledBy` follows the
 *     document order of the triggers. Duplicates are removed.
 *   - Pure, no throwing on odd input: an id that names no node is simply not
 *     linked. For `aria-controls` it is also reported as ARIA_TARGET_MISSING
 *     when the optional `diagnostics` collector is given.
 */

/**
 * @typedef {object} AriaLinks
 * @property {string[]} controls
 * @property {string[]} controlledBy
 * @property {string[]} [labelledBy]
 * @property {string[]} [describedBy]
 */

/** @param {unknown} value @returns {string[]} */
function ids(value) {
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : [];
}

/**
 * @param {import('./recognize.mjs').UiNode} tree
 * @param {{ diagnostics?: { add: (entry: object) => unknown } }} [options]
 * @returns {Map<string, AriaLinks>}
 */
export function linkAria(tree, { diagnostics } = {}) {
  /** @type {import('./recognize.mjs').UiNode[]} */
  const nodes = [];
  /** @type {Map<string, import('./recognize.mjs').UiNode>} */
  const byId = new Map();
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    nodes.push(n);
    if (typeof n.id === 'string' && n.id && !byId.has(n.id)) byId.set(n.id, n);
    for (const child of n.children ?? []) walk(child);
  })(tree);

  /** @type {Map<string, AriaLinks>} */
  const links = new Map();
  /** @param {string} key */
  const entry = (key) => {
    let e = links.get(key);
    if (!e) links.set(key, (e = { controls: [], controlledBy: [] }));
    return e;
  };
  /** @param {string[]} list @param {string} value */
  const push = (list, value) => { if (!list.includes(value)) list.push(value); };

  for (const trigger of nodes) {
    const key = trigger.key;
    const aria = trigger.aria;
    if (!key || !aria || typeof aria !== 'object') continue;

    const sources = [['controls', ids(aria.controls)], ['owns', ids(aria.owns)]];
    for (const [kind, list] of sources) {
      for (const id of list) {
        const target = byId.get(id);
        if (!target) {
          if (kind === 'controls') {
            diagnostics?.add({
              code: 'ARIA_TARGET_MISSING',
              message: `aria-controls="${id}" on ${trigger.tag}${trigger.id ? `#${trigger.id}` : ''} names no element in the page, so the control is not linked to anything.`,
              fix: `Add an element with id="${id}", or fix the aria-controls value to name an existing id.`,
              source: { selector: key },
            });
          }
          continue;
        }
        if (target === trigger || !target.key) continue;
        push(entry(key).controls, target.key);
        push(entry(target.key).controlledBy, key);
      }
    }

    for (const [field, out] of [['labelledby', 'labelledBy'], ['describedby', 'describedBy']]) {
      for (const id of ids(aria[field])) {
        const other = byId.get(id);
        if (!other || !other.key || other === trigger) continue;
        const e = entry(key);
        push((e[out] ??= []), other.key);
      }
    }
  }
  return links;
}
