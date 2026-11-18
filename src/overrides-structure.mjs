/**
 * Structure operations of a sidecar (version 2): adding widgets and moving them
 * to another place in the tree.
 *
 *   "structure": [
 *     { "op": "add",  "name": "note",  "tag": "lv_label", "parent": "card", "index": 2, "attrs": { "text": "Hi" } },
 *     { "op": "move", "name": "start", "parent": "actions", "index": 0 }
 *   ]
 *
 * `parent` is the `name` of the widget that holds it, or `null` for the page
 * itself. `index` is the place among the parent's children: for a move, in the
 * list after the widget has been taken out of its old place; a number past the
 * end means the end. Operations apply in order, each to the tree the ones
 * before it produced, and before the per-widget `nodes` overrides, so those can
 * change an added widget's attributes or remove it.
 *
 * This module is pure (no file system, no Node APIs): the converter and the
 * editor both import it, so the editor shows exactly the tree the converter
 * will build.
 */

/** The operations a structure list may hold. */
export const STRUCTURE_OPS = ['add', 'move'];

/** A widget name: letters, digits and underscores, not starting with a digit (it becomes a C identifier). */
export const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** An LVGL widget tag as the converter writes it. */
export const TAG_PATTERN = /^lv_[a-z0-9_]+$/;

/** The widgets that can hold other widgets. */
export const CONTAINER_TAGS = ['view', 'lv_obj', 'lv_button'];

/** Can a widget with this tag have children? */
export const acceptsChildren = (tag) => CONTAINER_TAGS.includes(tag);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const describe = (v) => (v === undefined ? 'undefined' : Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

const COMMON_KEYS = new Set(['op', 'name', 'parent', 'index']);
const ADD_KEYS = new Set([...COMMON_KEYS, 'tag', 'attrs']);

/**
 * Check a structure list. Reports every problem at once.
 *
 * @param {unknown} structure
 * @returns {string[]}  One line per problem; empty when valid.
 */
export function validateStructure(structure) {
  if (!Array.isArray(structure)) return [`"structure" must be an array, got ${describe(structure)}`];
  const errors = [];
  structure.forEach((op, i) => {
    const at = `structure[${i}]`;
    if (!isPlainObject(op)) {
      errors.push(`${at} must be an object, got ${describe(op)}`);
      return;
    }
    if (!STRUCTURE_OPS.includes(op.op)) {
      errors.push(`${at}.op must be one of ${STRUCTURE_OPS.map((o) => `"${o}"`).join(', ')}, got ${JSON.stringify(op.op) ?? 'nothing'}`);
      return;
    }
    const allowed = op.op === 'add' ? ADD_KEYS : COMMON_KEYS;
    for (const key of Object.keys(op)) {
      if (!allowed.has(key)) errors.push(`${at} has the unknown key "${key}" (a ${op.op} takes ${[...allowed].join(', ')})`);
    }
    if (typeof op.name !== 'string' || !NAME_PATTERN.test(op.name)) {
      errors.push(`${at}.name must be a widget name (letters, digits and underscores, not starting with a digit), got ${JSON.stringify(op.name) ?? 'nothing'}`);
    }
    if (op.parent !== null && (typeof op.parent !== 'string' || !NAME_PATTERN.test(op.parent))) {
      errors.push(`${at}.parent must be the name of a widget, or null for the page, got ${JSON.stringify(op.parent) ?? 'nothing'}`);
    }
    if (!Number.isInteger(op.index) || op.index < 0) {
      errors.push(`${at}.index must be a whole number, 0 or more, got ${JSON.stringify(op.index) ?? 'nothing'}`);
    }
    if (op.op === 'add') {
      if (typeof op.tag !== 'string' || !TAG_PATTERN.test(op.tag)) {
        errors.push(`${at}.tag must be an LVGL widget tag such as "lv_label", got ${JSON.stringify(op.tag) ?? 'nothing'}`);
      }
      if ('attrs' in op) {
        if (!isPlainObject(op.attrs)) {
          errors.push(`${at}.attrs must be an object, got ${describe(op.attrs)}`);
        } else {
          for (const [key, v] of Object.entries(op.attrs)) {
            if (key === 'name') errors.push(`${at}.attrs.name is not allowed: the name is the "name" of the add`);
            else if (!['string', 'number', 'boolean'].includes(typeof v)) {
              errors.push(`${at}.attrs.${key} must be a string, number or boolean, got ${describe(v)}`);
            }
          }
        }
      }
    }
  });
  return errors;
}

const nameOf = (node) => (typeof node.attrs?.name === 'string' ? node.attrs.name : null);

/** Depth-first search by `name`: the node and the list it sits in. */
function find(root, name) {
  const visit = (node, siblings, position) => {
    if (nameOf(node) === name) return { node, siblings, position };
    for (let i = 0; i < node.children.length; i += 1) {
      const found = visit(node.children[i], node.children, i);
      if (found) return found;
    }
    return null;
  };
  return visit(root, null, -1);
}

const contains = (node, target) => node === target || node.children.some((child) => contains(child, target));

/** The widget a `parent` names; null means the page itself. */
const findParent = (root, parent) => (parent === null ? { node: root } : find(root, parent));

/**
 * Apply a structure list to a view tree and return the new tree; the input is
 * not mutated. A problem becomes a diagnostic and that one operation is
 * skipped, so one stale name does not lose the rest of the sidecar.
 *
 * @param {{ tag: string, attrs: object, children: object[] }} view
 * @param {unknown[]} structure  Already validated with validateStructure().
 * @param {{ diagnostics?: { add(d: object): unknown } | null, file?: string }} [options]
 */
export function applyStructure(view, structure, { diagnostics = null, file } = {}) {
  const root = structuredClone(view);
  const source = file ? { file } : null;
  const skip = (op, index, why, fix) => {
    diagnostics?.add({
      code: 'OVERRIDE_STRUCTURE_INVALID',
      message: `structure[${index}] (${op.op} "${op.name}") was skipped: ${why}.`,
      fix: fix ?? 'Fix or delete this operation in the sidecar file. Names come from data-lv-name, id or class; put data-lv-name on anything an operation targets, because class-derived names with a numeric suffix shift when siblings change.',
      source,
      output: { widget: op.name },
    });
  };

  structure.forEach((op, index) => {
    const target = findParent(root, op.parent);
    if (op.op === 'add') {
      if (find(root, op.name)) return skip(op, index, `a widget named "${op.name}" already exists`, 'Choose another name for the new widget.');
      if (!target) return skip(op, index, `no widget named "${op.parent}" to add it to`);
      if (!acceptsChildren(target.node.tag)) return skip(op, index, `${op.parent ?? 'the page'} is a ${target.node.tag}, which cannot hold other widgets`);
      const attrs = { name: op.name };
      for (const [key, v] of Object.entries(op.attrs ?? {})) attrs[key] = typeof v === 'boolean' ? String(v) : v;
      const children = target.node.children;
      children.splice(Math.min(op.index, children.length), 0, { tag: op.tag, attrs, children: [] });
      return undefined;
    }
    // move
    const moving = find(root, op.name);
    if (!moving) return skip(op, index, `no widget named "${op.name}"`);
    if (moving.siblings === null) return skip(op, index, 'the page itself cannot be moved');
    if (!target) return skip(op, index, `no widget named "${op.parent}" to move it into`);
    if (contains(moving.node, target.node)) return skip(op, index, `"${op.parent ?? 'the page'}" is inside "${op.name}", so it cannot move there`);
    if (!acceptsChildren(target.node.tag)) return skip(op, index, `${op.parent ?? 'the page'} is a ${target.node.tag}, which cannot hold other widgets`);
    moving.siblings.splice(moving.position, 1);
    const children = target.node.children;
    children.splice(Math.min(op.index, children.length), 0, moving.node);
    return undefined;
  });
  return root;
}
