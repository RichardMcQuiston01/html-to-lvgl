/**
 * ARIA trigger/target linking: pair every element that controls another
 * (`aria-controls="panel1"`, usually with `aria-expanded`) with the element
 * whose `id` it names. Accordion, Drawer, Modal and Menu all need this.
 *
 * Phase 6, lane D fills this in. Until then it returns no links, so nothing
 * recognizes a disclosure pattern yet and conversion output is unchanged.
 *
 * The contract, which recognize() relies on:
 *   - Input: the whole UiNode tree (hidden nodes included), already annotated
 *     with keys (see annotateKeys in src/recognize.mjs).
 *   - Output: a Map from a node's `key` to
 *     `{ controls: string[], controlledBy: string[] }`, holding other nodes'
 *     keys. A trigger lists its targets in `controls`; a target lists its
 *     triggers in `controlledBy`. Nodes with no links are absent.
 *   - Pure, no throwing on odd input: an `aria-controls` that names a missing
 *     id is simply not linked.
 */

/**
 * @param {import('./recognize.mjs').UiNode} tree
 * @returns {Map<string, { controls: string[], controlledBy: string[] }>}
 */
export function linkAria(tree) {
  void tree;
  return new Map();
}
