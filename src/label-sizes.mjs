/**
 * Consistent sizes for sibling labels.
 *
 * Why: the browser lays text out in Helvetica/Roboto, LVGL's built-in
 * Montserrat runs wider, so a label whose own text overflows its browser box
 * used to step down one size on its own. Two labels with the SAME CSS font
 * size then rendered at different LVGL sizes depending on their text length
 * (a stepper: "Cart" and "Delivery" at montserrat_10, "Pay" at 12 and clipped
 * at the screen edge).
 *
 * Design (chosen by measurement, 41 pages of examples/ + each package examples dir,
 * Chromium vs LVGL fidelity, "inconsistent" = a group of labels sharing
 * CSS size, family, weight and style that rendered at more than one size):
 *
 *   design                            mean fidelity  steps  inconsistent groups
 *                                                          (per parent / page)
 *   before: per-label step-down       94.602         21     1 / 5
 *   nominal size, no step-down        94.597         0      0 / 0, 22 labels overflow
 *   per parent, all must fit          94.602         21     1 / 5   (same as before)
 *   per grandparent, all must fit     94.605         25     0 / 4   (misses steppers)
 *   page-wide, all must fit, <=1 step 94.603         30     0 / 0   <- chosen
 *   page-wide, summed widths fit      94.603         30     0 / 0   (same, more complex)
 *   page-wide, 15% overflow allowed   94.600         6      0 / 0, 16 labels overflow
 *
 * Fidelity barely moves because these labels are small; the deciding factors
 * are consistency and overflow. Per-parent grouping cannot see siblings that
 * live in different wrappers (each stepper step is its own box), so the group
 * is page-wide. Capping at one step below the nominal size means a group never
 * shrinks more than its worst label already did on its own before.
 *
 * Only labels that fitText can resize take part: built-in fonts (a converted
 * font is already the exact CSS size and cannot step down), single line, and
 * not flex-managed (managed labels auto-size and never step down).
 */

/** px of acceptable overflow before stepping down. */
export const FIT_TOLERANCE = 2;

/** True when `text` set in `font` fits a browser box `width` px wide. */
export const fitsBox = (font, text, width) => font.measure(text) <= width + FIT_TOLERANCE;

/**
 * Group key: labels share one LVGL size only if they share every property
 * that picks the browser's font. Different CSS sizes may legitimately differ.
 */
function groupKey(node, nominal) {
  const s = node.styles;
  return `${s.fontSize}|${nominal.name}|${s.fontFamily}|${s.fontWeight}|${s.fontItalic ? 1 : 0}`;
}

/**
 * Walk the tree and set `fitFont` on every label that belongs to a group.
 *
 * @param {object} tree  Optimized UI tree (mutated: `fitFont` is added).
 * @param {object} options
 * @param {{ for: (styles: object) => any }} options.fonts  Font registry.
 * @param {(node: object) => string} options.displayText  Text as rendered (text-transform applied).
 * @param {(node: object, parent: object) => boolean} options.isManaged  True when a flex/grid parent places and sizes the label.
 * @returns {number} How many labels got a font that differs from their nominal one.
 */
export function assignLabelFonts(tree, { fonts, displayText, isManaged }) {
  /** @type {Map<string, {nominal: any, labels: {node: object, text: string}[]}>} */
  const groups = new Map();
  (function walk(parent) {
    for (const node of parent.children ?? []) {
      if (node.text && !node.xmlComponent && !node.tabview && !node.native) {
        const nominal = fonts.for(node.styles);
        const multiline = node.h >= node.styles.fontSize * 2;
        // Custom fonts have no smaller variant: nothing to keep consistent.
        if (!multiline && !isManaged(node, parent) && nominal.stepDown()) {
          const key = groupKey(node, nominal);
          const group = groups.get(key) ?? groups.set(key, { nominal, labels: [] }).get(key);
          group.labels.push({ node, text: displayText(node) });
        }
      }
      walk(node);
    }
  })(tree);

  let changed = 0;
  for (const { nominal, labels } of groups.values()) {
    let font = nominal;
    const smaller = nominal.stepDown();
    // Step down once, and only if some label actually gains from it: it
    // overflows at the nominal size but fits at the smaller one.
    const gains = labels.some(({ node, text }) => !fitsBox(nominal, text, node.w) && fitsBox(smaller, text, node.w));
    if (gains) font = smaller;
    for (const { node } of labels) node.fitFont = font;
    if (font !== nominal) changed += labels.length;
  }
  return changed;
}
