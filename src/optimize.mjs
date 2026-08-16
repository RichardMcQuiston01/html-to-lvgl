/**
 * UI-tree optimization passes, run before conversion.
 *
 * Wrapper collapse: framework-generated HTML nests visually inert wrapper
 * divs; each one would become an lv_obj on the device (RAM + traversal
 * cost). A wrapper collapses into its single child when removing it cannot
 * change appearance or layout:
 *
 * - generic block element (div/section/...), no text, exactly one child
 * - visually inert: no background/gradient/border/shadow, full opacity,
 *   not scrollable, no pressed styles
 * - not a flex/grid container (its layout places the child), and not itself
 *   placed by a flex/grid parent (position comes from absolute coordinates,
 *   which the child carries on its own)
 */
const GENERIC_TAGS = new Set(['div', 'section', 'main', 'article', 'header', 'footer', 'aside', 'nav', 'form', 'fieldset']);

export function optimize(tree) {
  let removed = 0;
  const managed = (node) => node.layout.display === 'flex' || node.layout.display === 'grid';

  function collapse(node, parentIsManaged) {
    node.children = node.children.map((child) => {
      let c = child;
      while (isInertWrapper(c) && !parentIsManaged) {
        c = c.children[0];
        removed++;
      }
      collapse(c, managed(node));
      return c;
    });
  }

  function isInertWrapper(node) {
    const s = node.styles;
    return (
      GENERIC_TAGS.has(node.tag) &&
      !node.text &&
      !node.component && // component boundaries must survive for the componentizer
      node.children.length === 1 &&
      !s.bgColor && !s.gradient && !s.shadow && !s.pressed &&
      s.borderWidth === 0 && s.borderBottomWidth === 0 &&
      s.opacity === 1 && !s.scrollable &&
      !managed(node)
    );
  }

  collapse(tree, managed(tree));
  return { tree, removed };
}
