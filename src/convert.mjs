/**
 * UI-tree → LVGL XML conversion (pure; no browser, no filesystem).
 *
 * Input is the JSON tree produced by extract.mjs. Output is LVGL XML for the
 * v9.4 lv_xml runtime plus warnings and an asset manifest.
 *
 * Layout strategy (Phase 1):
 * - CSS flex containers map to LVGL flex (`flex_flow`, `style_flex_*`,
 *   `pad_row`/`pad_column` from gap, real padding); their in-flow children
 *   carry no x/y and keep `flex_grow` and margins.
 * - Everything else uses absolute positioning from Chromium's resolved
 *   layout (the html-to-figma baseline).
 * - `position: absolute` children inside a flex parent get `ignore_layout`
 *   plus coordinates, mirroring CSS out-of-flow behavior.
 *
 * Text strategy: labels use real LVGL Montserrat metrics (src/fonts.mjs).
 * Start from the largest font not exceeding the CSS size; if the text would
 * overflow its box, try one size smaller; if it still overflows, let the
 * label auto-size and report a warning.
 */
import { builtinFonts } from './fonts.mjs';
import { el, render } from './emit-xml.mjs';
import { optimize } from './optimize.mjs';
import { createDiagnostics } from './diagnostics.mjs';
import { recognize, defaultRegistry } from './recognize.mjs';
import { checkTouchTargets } from './touch-targets.mjs';
import { sanitize, ownName } from './names.mjs';
import { hasBehavior, qualifyBehavior, behaviorElements, globalsXml, animationsElement } from './behavior.mjs';

const TEXT_TAGS = new Set(['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'a', 'div', 'em', 'strong', 'small', 'b', 'i']);
const UNSUPPORTED_TAGS = new Set(['canvas', 'svg', 'video', 'iframe', 'audio', 'object', 'embed']);
const FIT_TOLERANCE = 2; // px of acceptable overflow before stepping down

const JUSTIFY = {
  'flex-start': 'start', start: 'start', left: 'start', normal: 'start', stretch: 'start',
  center: 'center',
  'flex-end': 'end', end: 'end', right: 'end',
  'space-between': 'space_between', 'space-around': 'space_around', 'space-evenly': 'space_evenly',
};

/**
 * @param screens  Set of sibling screen names. When provided, <a href> links
 *                 pointing at one — or any element carrying
 *                 data-lv-link="<page>" — become navigation buttons.
 * @param registry  Component definitions to recognize before conversion
 *                 (see src/recognize.mjs). Defaults to the built-in set.
 * @param minTouchTarget  Smallest pressable size in px before TOUCH_TARGET_SMALL
 *                 is reported (default 30; 0 turns the check off).
 * @param screenMode  Wrap the output in <screen> instead of <component>, so
 *                 LVGL registers it as a loadable screen.
 */
export function convert(input, { name = 'page', screens = null, screenMode = false, fonts = builtinFonts(), registry = defaultRegistry, minTouchTarget = 30 } = {}) {
  const diagnostics = createDiagnostics();
  // Recognition runs first, so a component can rewrite its part of the tree
  // before the optimizer collapses wrappers or the emitter maps tags.
  const { tree: recognizedTree } = recognize(structuredClone(input), { registry, diagnostics });
  // Info-only and read-only: reports pressables under minTouchTarget px (0 = off).
  checkTouchTargets(recognizedTree, {
    diagnostics,
    minSize: minTouchTarget,
    isLinkLive: (n) => Boolean(screens && resolveScreen(n.link || (n.tag === 'a' ? n.attrs?.href : null), screens)),
  });
  const { tree, removed } = optimize(recognizedTree);
  const ctx = { diagnostics, assets: [], names: new Map(), collapsed: removed, screens, fonts, page: name, subjects: new Map(), usedSubjects: new Map(), timelines: new Map() };
  hoistOverlays(tree);
  markOverhangAndClip(tree);

  const rootAttrs = {
    width: tree.w,
    height: tree.h,
    ...boxStyles(tree, ctx, { transparentDefault: false }),
    ...containerLayout(tree, ctx),
    scrollable: 'false',
    ...textStyles(tree, ctx.fonts.for(tree.styles)),
  };
  pinBarsOnTop(tree);
  const view = el('view', rootAttrs, tree.children.map((c) => emit(c, tree, ctx)).filter(Boolean));
  const timelines = [...ctx.timelines.values()];
  const animations = animationsElement(timelines);
  const xml = pageXml(view, { screenMode, animations });
  const subjects = [...ctx.subjects.values()];
  reportUndeclaredSubjects(ctx);
  return { xml, view, animations, timelines, subjects, globalsXml: globalsXml(subjects), warnings: diagnostics.list().filter((d) => d.code !== 'TOUCH_TARGET_SMALL').map((d) => d.message), diagnostics, assets: ctx.assets, name, collapsed: ctx.collapsed };
}

/**
 * The page document: `<screen>` or `<component>` around the optional
 * `<animations>` block (timelines, see src/behavior.mjs) and the `<view>`.
 * Anything that re-renders a changed view must go through here, or the
 * timelines are lost.
 * @param {{ tag: string }} view
 * @param {{ screenMode?: boolean, animations?: { tag: string } | null }} [options]
 */
export function pageXml(view, { screenMode = false, animations = null } = {}) {
  const wrapper = screenMode ? 'screen' : 'component';
  const parts = [animations ? render(animations, 1) : null, render(view, 1)].filter(Boolean);
  return `<${wrapper}>\n${parts.join('\n')}\n</${wrapper}>\n`;
}

/* ---------------------------------------------------------------- helpers */

function uid(ctx, node, fallback) {
  const base = ownName(node) ?? sanitize(fallback || node.tag);
  // A numbered name can collide with a base another node already used (a
  // widget called "icon_menu_2" next to two "icon_menu"), so keep counting
  // until the final name is unused, and record it so later bases see it too.
  let n = ctx.names.get(base) ?? 0;
  let name;
  do {
    n += 1;
    name = n === 1 ? base : `${base}_${n}`;
  } while (n > 1 && ctx.names.has(name));
  ctx.names.set(base, n);
  if (!ctx.names.has(name)) ctx.names.set(name, 1);
  return name;
}

/** Where a node came from in the source page, as precisely as the tree allows. */
export function sourceOf(node) {
  // node.key is the stable key from recognize(): `name:x`, `#x`, or a path
  // like body/div[0]/button[1]. It is unique within the page, so prefer it.
  if (node.key) return { selector: node.key };
  const selector = node.lvName ? `[data-lv-name="${node.lvName}"]` : node.id ? `#${node.id}` : `<${node.tag}>`;
  return { selector };
}

const hex = ([r, g, b]) => '0x' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

const isFlex = (node) => node.layout && node.layout.display === 'flex' && node.children.length > 0;

const isGrid = (node) => node.layout && node.layout.display === 'grid' && node.children.length > 0;

const isManaged = (node) => isFlex(node) || isGrid(node);

const outOfFlow = (node) => node.layout && (node.layout.position === 'absolute' || node.layout.position === 'fixed' || isPinnedBar(node));

/**
 * A recognized app bar that stays put while the page scrolls: position fixed
 * or sticky. LVGL has no sticky, so both become a floating object (see
 * LV_OBJ_FLAG_FLOATING: ignores layout and is not moved when the parent
 * scrolls). A sticky bar therefore is out of flow too, like a fixed one.
 */
const isPinnedBar = (node) =>
  node.recognized?.component === 'appbar' && (node.layout?.position === 'fixed' || node.layout?.position === 'sticky');

/**
 * Move each pinned app bar to the end of its parent's children. Browsers
 * paint a fixed or sticky bar over later content; LVGL paints later siblings
 * over earlier ones, so a bar kept in document order would be covered by the
 * content that scrolls beneath it.
 */
function pinBarsOnTop(node) {
  for (const child of node.children) pinBarsOnTop(child);
  if (node.children.some(isPinnedBar)) {
    // Overlays (modal, drawer) stay above the bars: they dim everything.
    const rest = node.children.filter((c) => !isPinnedBar(c) && !c.overlay);
    node.children = [...rest, ...node.children.filter(isPinnedBar), ...node.children.filter((c) => c.overlay && !isPinnedBar(c))];
  }
}

/**
 * Move every overlay (a node a component marked `overlay: true`, such as a
 * Modal's backdrop or a Drawer's panel) to the end of the screen's children,
 * after its `overlayBefore` companions (a Drawer's scrim). LVGL draws later
 * siblings over earlier ones and an overlay is sized to the whole screen, so
 * it must be a direct, last child of the screen root, whatever box the
 * dialog sat in on the page (browsers portal it to the body for the same
 * reason). Overlays nested in overlays are lifted too, in document order.
 * @param {object} root
 */
function hoistOverlays(root) {
  const lifted = [];
  const pending = [root];
  while (pending.length) {
    const node = pending.shift();
    node.children = node.children.filter((child) => {
      if (!child.overlay) return true;
      lifted.push(...(child.overlayBefore ?? []), child);
      pending.push(child);
      return false;
    });
    pending.push(...node.children);
  }
  root.children.push(...lifted);
}

/**
 * Grid cell position/span from computed grid-column/row-start/end. Explicit
 * line numbers are honored; auto-placed items fall back to row-major order
 * (Chromium reports "auto" for them).
 */
function gridCell(node, parent, autoIndex) {
  const cols = parent.layout.gridColumns.length;
  const place = (start, end, fallbackPos) => {
    let pos = fallbackPos;
    let span = 1;
    if (/^\d+$/.test(start)) pos = Number(start) - 1;
    const spanMatch = /^span (\d+)$/.exec(end);
    if (spanMatch) span = Number(spanMatch[1]);
    else if (/^\d+$/.test(end)) span = Math.max(1, Number(end) - 1 - pos);
    return { pos, span };
  };
  const col = place(node.layout.gridColumnStart, node.layout.gridColumnEnd, autoIndex % cols);
  const row = place(node.layout.gridRowStart, node.layout.gridRowEnd, Math.floor(autoIndex / cols));
  return {
    style_grid_cell_column_pos: col.pos,
    style_grid_cell_row_pos: row.pos,
    ...(col.span > 1 ? { style_grid_cell_column_span: col.span } : {}),
    ...(row.span > 1 ? { style_grid_cell_row_span: row.span } : {}),
  };
}

/** Position/size attributes for a child, honoring the parent's layout mode. */
function placement(node, parent, { size = true, gridIndex = 0 } = {}) {
  const attrs = {};
  const managed = isManaged(parent) && !outOfFlow(node);
  if (!managed) {
    // Coordinates are relative to the parent's content origin. Absolute
    // containers always emit pad 0, so only the border offsets the origin.
    // Managed parents emit real padding, so subtract it for out-of-flow children.
    const padX = isManaged(parent) ? parent.styles.padLeft : 0;
    const padY = isManaged(parent) ? parent.styles.padTop : 0;
    attrs.x = node.x - parent.x - parent.styles.borderWidth - padX;
    attrs.y = node.y - parent.y - parent.styles.borderWidth - padY;
    if (isManaged(parent)) attrs.ignore_layout = 'true';
  } else {
    if (isGrid(parent)) Object.assign(attrs, gridCell(node, parent, gridIndex));
    if (node.layout.flexGrow > 0) attrs.flex_grow = Math.round(node.layout.flexGrow);
    for (const [css, lv] of [['marginLeft', 'style_margin_left'], ['marginRight', 'style_margin_right'], ['marginTop', 'style_margin_top'], ['marginBottom', 'style_margin_bottom']]) {
      if ((node.layout[css] || 0) !== 0) attrs[lv] = node.layout[css]; // negative margins pull the box over its neighbor
    }
  }
  if (isPinnedBar(node) || node.overlay) attrs.floating = 'true';
  // A component parked the node off-screen for a slide-in (Drawer); see
  // `styleTranslate` in src/components/overlay.mjs.
  if (node.styleTranslate?.x) attrs.style_translate_x = node.styleTranslate.x;
  if (node.styleTranslate?.y) attrs.style_translate_y = node.styleTranslate.y;
  if (size) {
    attrs.width = node.w;
    // A component sets layout.heightContent on a box whose height must follow its
    // children (an accordion item), or siblings would not reflow when a child hides.
    attrs.height = node.layout?.heightContent ? 'content' : node.h;
  }
  return attrs;
}

/**
 * Smallest overhang (px) worth acting on. Chromium reports rounded geometry,
 * so a child can poke out by one pixel purely from rounding.
 */
const OVERHANG_TOLERANCE = 1;

/** Opacity of the invisible outline that gives a box an extended-draw size. LVGL counts it when above LV_OPA_MIN (2). */
const EXT_DRAW_OPA = 3;

/**
 * Work out, bottom up, which boxes must let children draw outside them, and
 * which rounded boxes clip an image to their corners. Writes
 * `styles.overflowVisible`, `styles.extDraw` (px the drawing reaches beyond
 * the box) and `styles.clipCorner` on the nodes.
 *
 * LVGL clips a child to its parent unless the parent has the
 * `overflow_visible` flag, and then only up to the parent's extended-draw size
 * (an outline or shadow with opacity above 2). Every ancestor the child
 * leaves has to allow it, so each box reports how far everything below it
 * reaches and the parent combines those extents. A box the browser itself
 * clips (overflow hidden/auto) stops the extent: what it hides stays hidden.
 *
 * @param {object} node
 * @param {number[]} [surface]  Opaque color behind the node.
 * @returns {{left: number, top: number, right: number, bottom: number}}  Drawn extent in page px.
 */
function markOverhangAndClip(node, surface = [255, 255, 255]) {
  const s = node.styles;
  // The nearest opaque background behind this box, used to hide the outline.
  const behind = s.bgColor && s.bgColor[3] === 255 ? s.bgColor : surface;
  const box = { left: node.x, top: node.y, right: node.x + node.w, bottom: node.y + node.h };
  const extent = { ...box };
  for (const child of node.children) {
    if (child.hidden) continue;
    const c = markOverhangAndClip(child, behind);
    extent.left = Math.min(extent.left, c.left);
    extent.top = Math.min(extent.top, c.top);
    extent.right = Math.max(extent.right, c.right);
    extent.bottom = Math.max(extent.bottom, c.bottom);
  }
  const clipsInBrowser = s.overflowHidden === true || s.scrollable === true;
  const reach = Math.max(box.left - extent.left, box.top - extent.top, extent.right - box.right, extent.bottom - box.bottom);
  if (!clipsInBrowser && reach > OVERHANG_TOLERANCE) {
    s.overflowVisible = true;
    s.extDraw = Math.max(s.extDraw ?? 0, reach);
    s.extDrawColor = surface;
  } else if (s.overflowVisible) {
    s.extDraw = Math.max(s.extDraw ?? 0, 1); // a component asked for it with no measurable reach
    s.extDrawColor ??= surface;
  }
  // Rounded corners crop a photo only when the browser crops it too.
  if (!s.clipCorner && s.overflowHidden === true && s.radius > 0 && hasImageBelow(node)) s.clipCorner = true;
  return clipsInBrowser ? box : extent;
}

/** @param {object} node */
const hasImageBelow = (node) => node.children.some((c) => !c.hidden && (c.tag === 'img' || hasImageBelow(c)));

/**
 * The one border LVGL can draw for a box: a single width and color, on all
 * sides or on one. Returns null for no border. The extractor puts a lone
 * left, right or top edge in borderWidth/borderColor and names it in
 * borderSide; otherwise borderWidth is the frame and borderBottom* a bottom rule.
 * @param {object} s  node.styles
 * @returns {{width: number, color: number[], side: 'full' | 'top' | 'bottom' | 'left' | 'right'} | null}
 */
function borderOf(s) {
  if (s.borderWidth > 0 && s.borderColor) return { width: s.borderWidth, color: s.borderColor, side: s.borderSide ?? 'full' };
  if (s.borderBottomWidth > 0 && s.borderBottomColor) return { width: s.borderBottomWidth, color: s.borderBottomColor, side: 'bottom' };
  return null;
}

/** CSS text-transform applied to label text (the browser applies it to innerText only). */
export function applyTextTransform(text, transform) {
  if (!text) return text;
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  // capitalize: first letter of each word, skipping punctuation in front of it
  if (transform === 'capitalize') return text.replace(/(^|\s)([^\p{L}\p{N}\s]*)(\p{L})/gu, (_, gap, punct, letter) => gap + punct + letter.toUpperCase());
  return text;
}

/** Shared visual styles for boxes (containers, buttons, inputs). */
function boxStyles(node, ctx, { transparentDefault = true, pad = null } = {}) {
  const s = node.styles;
  const attrs = {};
  if (s.bgColor) {
    attrs.style_bg_color = hex(s.bgColor);
    if (s.bgColor[3] < 255) attrs.style_bg_opa = s.bgColor[3];
  } else if (transparentDefault) {
    attrs.style_bg_opa = '0';
  }
  const border = borderOf(s);
  if (border) {
    attrs.style_border_width = border.width;
    attrs.style_border_color = hex(border.color);
    if (border.color[3] < 255) attrs.style_border_opa = border.color[3];
    if (border.side !== 'full') attrs.style_border_side = border.side;
  } else {
    attrs.style_border_width = 0;
  }
  if (s.gradient) {
    // Two-stop CSS linear-gradient; bg_color/bg_grad_color take its place.
    attrs.style_bg_color = hex(s.gradient.from);
    attrs.style_bg_grad_color = hex(s.gradient.to);
    attrs.style_bg_grad_dir = s.gradient.dir;
    delete attrs.style_bg_opa;
  }
  attrs.style_radius = s.radius;
  if (s.shadow) {
    attrs.style_shadow_color = hex(s.shadow.color);
    attrs.style_shadow_opa = s.shadow.color[3];
    attrs.style_shadow_width = s.shadow.blur;
    if (s.shadow.x) attrs.style_shadow_offset_x = s.shadow.x;
    if (s.shadow.y) attrs.style_shadow_offset_y = s.shadow.y;
    if (s.shadow.spread) attrs.style_shadow_spread = s.shadow.spread;
  } else {
    attrs.style_shadow_width = 0;
  }
  if (pad !== null) {
    attrs.style_pad_all = pad;
  } else if (isManaged(node)) {
    // Managed children flow inside the content area, so real padding matters.
    attrs.style_pad_left = s.padLeft;
    attrs.style_pad_right = s.padRight;
    attrs.style_pad_top = s.padTop;
    attrs.style_pad_bottom = s.padBottom;
  } else {
    // Absolute children carry their own offsets; padding must not shift them.
    attrs.style_pad_all = 0;
  }
  if (s.opacity < 1) attrs.style_opa = Math.round(s.opacity * 255);
  if (s.clipCorner) attrs.style_clip_corner = 'true';
  if (s.overflowVisible) {
    // Children may draw outside this box, as far as the extended-draw size
    // reaches; a near-transparent outline supplies that size.
    attrs.overflow_visible = 'true';
    attrs.style_outline_width = s.extDraw ?? 1;
    attrs.style_outline_opa = EXT_DRAW_OPA;
    // Same color as what is behind the box, so the outline is not visible at all.
    attrs.style_outline_color = hex(s.extDrawColor ?? [0, 0, 0]);
  }
  if (s.pressed) {
    if (s.pressed.bgColor) attrs['style_bg_color:pressed'] = hex(s.pressed.bgColor);
    if (s.pressed.color) attrs['style_text_color:pressed'] = hex(s.pressed.color);
  }
  return attrs;
}

/** Layout attributes for a flex or grid container node (empty otherwise). */
function containerLayout(node, ctx) {
  if (isGrid(node)) {
    const l = node.layout;
    // Computed grid templates are resolved px tracks at the target
    // resolution; emitting them verbatim reproduces the browser's geometry.
    // Gaps are always explicit — LVGL themes default pad_row/pad_column to
    // a nonzero value, which would add phantom spacing for CSS gap: 0.
    return {
      style_layout: 'grid',
      style_grid_column_dsc_array: l.gridColumns.join(' '),
      style_grid_row_dsc_array: l.gridRows.join(' '),
      style_pad_row: l.rowGap,
      style_pad_column: l.columnGap,
    };
  }
  if (!isFlex(node)) return {};
  const l = node.layout;
  const dir = l.flexDirection.startsWith('column') ? 'column' : 'row';
  const rev = l.flexDirection.endsWith('reverse') ? '_reverse' : '';
  const wrap = l.flexWrap === 'wrap' ? '_wrap' : '';
  const attrs = { flex_flow: `${dir}${wrap}${rev}` };
  const main = JUSTIFY[l.justifyContent];
  const cross = JUSTIFY[l.alignItems];
  if (l.alignItems === 'baseline' && ctx) {
    // LVGL flex aligns by box edges only; there is no baseline mode.
    ctx.diagnostics.add({
      code: 'BASELINE_ALIGN_UNSUPPORTED',
      message: 'align-items: baseline has no LVGL equivalent; items are aligned to the track start instead',
      fix: 'If the items need to line up on their text baseline, nudge them with style_translate_y on the affected children in the generated file, or change align-items to center in the CSS.',
      source: sourceOf(node),
    });
  }
  if (main && main !== 'start') attrs.style_flex_main_place = main;
  if (cross && cross !== 'start') {
    // LVGL flex tracks are content-sized, unlike CSS lines which fill the
    // container — align the track too so items center visually.
    attrs.style_flex_cross_place = cross;
    attrs.style_flex_track_place = cross;
  }
  // Always explicit: LVGL themes default pad_row/pad_column to a nonzero
  // value, which would add phantom spacing for CSS gap: 0.
  attrs.style_pad_row = l.rowGap;
  attrs.style_pad_column = l.columnGap;
  return attrs;
}

function textStyles(node, font) {
  const s = node.styles;
  const attrs = { style_text_font: font.name };
  if (s.color) {
    attrs.style_text_color = hex(s.color);
    if (s.color[3] < 255) attrs.style_text_opa = s.color[3];
  }
  if (s.textAlign === 'center') attrs.style_text_align = 'center';
  else if (s.textAlign === 'right') attrs.style_text_align = 'right';
  return attrs;
}

/**
 * Choose the font for a text node and decide label sizing.
 * Returns { font, width } where width is null for an auto-sized label.
 *
 * A label's width is a hard wrap boundary in LVGL, so a kept width must never
 * be smaller than the measured text — flex-managed and left-aligned labels
 * simply auto-size, and centered labels get max(box, measured).
 */
function fitText(node, ctx, { managed = false } = {}) {
  let font = ctx.fonts.for(node.styles);
  if (!node.text) return { font, width: managed ? null : node.w };

  const multiline = node.h >= node.styles.fontSize * 2;
  if (multiline) return { font, width: node.w }; // keep box, let LVGL wrap

  if (managed) return { font, width: null }; // flex places and sizes it

  // Absolute placement: honor the browser box. A converted font is already
  // the exact CSS size so it measures like the browser did; a built-in
  // substitute may run wider, and can try one size smaller.
  if (font.measure(node.text) > node.w + FIT_TOLERANCE) {
    const smaller = font.stepDown();
    if (smaller && smaller.measure(node.text) <= node.w + FIT_TOLERANCE) font = smaller;
  }
  const centered = node.styles.textAlign === 'center' || node.styles.textAlign === 'right';
  if (centered) return { font, width: Math.max(node.w, font.measure(node.text)) };
  return { font, width: null }; // auto-size; keeps left edge, avoids clipping
}

/* ------------------------------------------------------------------ emit */

function emit(node, parent, ctx, index = 0) {
  if (UNSUPPORTED_TAGS.has(node.tag)) {
    ctx.diagnostics.add({
      code: 'TAG_UNSUPPORTED',
      message: `<${node.tag}> is not supported; skipped`,
      fix: `Rebuild this <${node.tag}> by hand in LVGL (for example with lv_image or lv_obj children), or replace it with supported elements in the HTML.`,
      source: sourceOf(node),
    });
    return null;
  }

  // The browser applies text-transform when it renders; the extracted text is raw.
  const transform = node.styles.textTransform;
  if (node.text && transform && transform !== 'none') node = { ...node, text: applyTextTransform(node.text, transform) };
  const out = node.xmlComponent ? emitLibraryComponent(node, parent, ctx, index) : emitByTag(node, parent, ctx, index);
  if (out && hasBehavior(node)) applyBehavior(node, out, ctx);
  // Carry component boundaries (React fiber walk or data-lv-component)
  // through to the element tree for the componentizer.
  if (out && node.component) out.meta = { component: node.component };
  return out;
}

/**
 * Behavior (src/behavior.mjs): register the node's subjects, append its event
 * and bind elements, and keep the final-named behavior on `meta.behavior` for
 * the C/C++/MicroPython emitters. A library component instance gets only the
 * subject registration: its own XML holds the events and binds.
 */
function applyBehavior(node, out, ctx) {
  if (!node.behavior) return;
  const behavior = qualifyBehavior(node.behavior, ctx.page);
  for (const decl of behavior.subjects) {
    const known = ctx.subjects.get(decl.name);
    if (known && known.initial !== decl.initial) {
      ctx.diagnostics.add({
        code: 'BEHAVIOR_SUBJECT_CONFLICT',
        message: `subject ${decl.name} is declared twice with different initial values (${known.initial} and ${decl.initial}); keeping ${known.initial}`,
        fix: 'Declare each subject once, or give the two widgets different data-lv-name values so their subjects differ.',
        source: sourceOf(node),
      });
    } else if (!known) ctx.subjects.set(decl.name, decl);
  }
  for (const ref of [...behavior.events, ...behavior.binds]) {
    if (ref.subject !== undefined && !ctx.usedSubjects.has(ref.subject)) ctx.usedSubjects.set(ref.subject, node);
  }
  // A timeline's animations default to the widget that declares them, found
  // by its final emitted name at run time.
  for (const timeline of behavior.timelines) {
    for (const animation of timeline.animations) animation.target ??= out.attrs.name;
    const known = ctx.timelines.get(timeline.name);
    if (known && JSON.stringify(known) !== JSON.stringify(timeline)) {
      ctx.diagnostics.add({
        code: 'BEHAVIOR_TIMELINE_CONFLICT',
        message: `timeline ${timeline.name} is declared twice with different animations; keeping the first`,
        fix: 'Give each timeline a unique name (derive it from the widget key, as subjectFor() does for subjects).',
        source: sourceOf(node),
      });
    } else if (!known) ctx.timelines.set(timeline.name, timeline);
  }
  if (node.xmlComponent) return;
  out.children.push(...behaviorElements(behavior));
  out.meta = { ...out.meta, behavior };
}

/** Every subject used by an event or bind must be declared somewhere on the page. */
function reportUndeclaredSubjects(ctx) {
  for (const [name, node] of ctx.usedSubjects) {
    if (ctx.subjects.has(name)) continue;
    ctx.diagnostics.add({
      code: 'BEHAVIOR_SUBJECT_UNDECLARED',
      message: `subject ${name} is used but never declared, so globals.xml will not define it`,
      fix: 'Declare the subject with declareSubject() in the same component definition that attaches the event or bind.',
      source: sourceOf(node),
    });
  }
}

/**
 * A node that stands for an instance of a library XML component
 * (node.xmlComponent, see src/behavior.mjs). Its children are not emitted.
 */
function emitLibraryComponent(node, parent, ctx, index) {
  const { tag, props } = node.xmlComponent;
  const attrs = {};
  for (const [key, value] of Object.entries(props)) {
    attrs[key] = value !== null && typeof value === 'object' && 'subject' in value ? `${sanitize(ctx.page)}_${value.subject}` : value;
  }
  return el(tag, { name: uid(ctx, node, tag), ...placement(node, parent, { gridIndex: index }), ...attrs });
}

function emitByTag(node, parent, ctx, index) {
  // data-lv-widget overrides tag-based and heuristic classification
  if (node.widget) {
    const forced = emitForced(node, parent, ctx, index);
    if (forced) return forced;
    ctx.diagnostics.add({
      code: 'WIDGET_UNSUPPORTED',
      message: `data-lv-widget="${node.widget}" is not a supported widget; using the default mapping`,
      fix: 'Fix the spelling of data-lv-widget on this element, or remove the attribute to accept the default mapping. See FEATURES.md for the supported values.',
      source: sourceOf(node),
    });
  }

  // <a href> pointing at a sibling screen, or an explicit data-lv-link
  // override on any element (a <button> that isn't semantically an anchor,
  // a clickable card <div>, ...), becomes a navigation button. An explicit
  // data-lv-link wins over the element's own href, same as other overrides.
  if (ctx.screens) {
    const href = node.link || (node.tag === 'a' ? node.attrs.href : null);
    const target = resolveScreen(href, ctx.screens);
    if (target) return emitLink(node, parent, ctx, index, target);
    if (node.link) {
      ctx.diagnostics.add({
        code: 'LINK_TARGET_UNKNOWN',
        message: `data-lv-link="${node.link}" does not match any of the pages being converted together; ignoring`,
        fix: `Pass the page "${node.link}" to html2lvgl together with the other pages, or correct the data-lv-link value to the name of a page in this run.`,
        source: sourceOf(node),
      });
    }
  }

  if (node.tag === 'button') return emitButton(node, parent, ctx, index);
  if (node.tag === 'input') return emitInput(node, parent, ctx, index);
  if (node.tag === 'select') return emitDropdown(node, parent, ctx, index);
  if (node.tag === 'img') return emitImage(node, parent, ctx, index);
  if (node.tag === 'progress') return emitBar(node, parent, ctx, index);
  if (node.tag === 'table') return emitTable(node, parent, ctx, index);

  if (node.text && node.children.length === 0 && TEXT_TAGS.has(node.tag)) {
    return emitText(node, parent, ctx, index);
  }
  return emitContainer(node, parent, ctx, index);
}

/**
 * Honor data-lv-widget. Widgets backed by <input> reuse emitInput with a
 * synthesized `type`; emitInput consults node.widget for the switch vs
 * checkbox decision instead of its aspect-ratio heuristic.
 */
function emitForced(node, parent, ctx, index) {
  switch (node.widget) {
    case 'button': return emitButton(node, parent, ctx, index);
    case 'label': return emitText(node, parent, ctx, index);
    case 'dropdown': return emitDropdown(node, parent, ctx, index);
    case 'bar': return emitBar(node, parent, ctx, index);
    case 'table': return emitTable(node, parent, ctx, index);
    case 'image': return emitImage(node, parent, ctx, index);
    case 'switch':
    case 'checkbox':
    case 'slider':
    case 'textarea': {
      const type = { switch: 'checkbox', checkbox: 'checkbox', slider: 'range', textarea: 'text' }[node.widget];
      return emitInput({ ...node, attrs: { ...node.attrs, type } }, parent, ctx, index);
    }
    default: return null;
  }
}

function emitContainer(node, parent, ctx, index) {
  const children = node.children.map((c, i) => emit(c, node, ctx, i)).filter(Boolean);
  // The widget is named before its own text label, so a name the author chose
  // (data-lv-name, id, class) lands on the widget, not on its label.
  const name = uid(ctx, node, 'box');
  if (node.text) {
    const { font } = fitText(node, ctx);
    children.unshift(el('lv_label', { name: uid(ctx, node, 'label'), text: node.text, ...textStyles(node, font) }));
  }
  return el('lv_obj', {
    name,
    ...placement(node, parent, { gridIndex: index }),
    ...boxStyles(node, ctx),
    ...containerLayout(node, ctx),
    scrollable: node.styles.scrollable ? 'true' : 'false',
  }, children);
}

function emitText(node, parent, ctx, index) {
  const s = node.styles;
  const managed = isManaged(parent) && !outOfFlow(node);
  const { font, width } = fitText(node, ctx, { managed });

  const padded = s.padLeft > 0 || s.padRight > 0 || s.padTop > 0 || s.padBottom > 0;
  if (s.bgColor || borderOf(s) || padded) {
    // Decorated or padded text block (title bar, badge, card body): a box that
    // owns the decoration and padding, plus a label placed inside it. A bare
    // label has no padding of its own, so the text would slide to the edge.
    // Two lines of text need about 2.4 font heights, and the text must be about
    // as wide as the box or the browser would not have wrapped it. A tall box
    // with a short title (a 32px header bar) is one line. Width alone is
    // unreliable because the browser's font is not the LVGL one, hence 0.8.
    const contentWidth = Math.max(1, node.w - s.padLeft - s.padRight);
    const multiline = node.h - s.padTop - s.padBottom >= s.fontSize * 2.2 && font.measure(node.text) > contentWidth * 0.8;
    // Named before the label, so an author's name lands on the box (see emitContainer).
    const boxName = uid(ctx, node, 'box');
    const labelName = uid(ctx, node, 'label');
    /** @type {Record<string, string | number>} */
    let where;
    if (multiline) {
      // Keep the content width so LVGL wraps where the browser did.
      where = { align: 'top_left', ...(s.padLeft ? { x: s.padLeft } : {}), ...(s.padTop ? { y: s.padTop } : {}), width: contentWidth };
    } else {
      // Single line: vertical centering matches the browser's line box, unless the padding is lopsided.
      const even = s.padTop === s.padBottom;
      const center = s.textAlign === 'center';
      where = {
        align: center ? (even ? 'center' : 'top_mid') : even ? 'left_mid' : 'top_left',
        ...(!center && s.padLeft ? { x: s.padLeft } : {}),
        ...(!even ? { y: s.padTop } : {}),
      };
    }
    const label = { name: labelName, ...where, text: node.text, ...textStyles(node, font) };
    return el('lv_obj', {
      name: boxName,
      ...placement(node, parent, { gridIndex: index }),
      ...boxStyles(node, ctx, { pad: 0 }),
      scrollable: 'false',
    }, [el('lv_label', label)]);
  }

  const attrs = {
    name: uid(ctx, node, 'label'),
    ...placement(node, parent, { size: false, gridIndex: index }),
    ...(width !== null ? { width } : {}),
    text: node.text,
    ...textStyles(node, font),
  };
  return el('lv_label', attrs);
}

/**
 * Where a button's label sits. A browser centers button text unless the page
 * says text-align: left/right (an accordion header does), and the button's
 * padding then insets the text from that edge; honoring both keeps the label
 * where the browser draws it. Only for <button>: an <a> defaults to start-aligned
 * text without meaning it, so links keep centering.
 */
function buttonLabelPlacement(node) {
  const { textAlign, padLeft, padRight } = node.styles;
  if (textAlign === 'left' || textAlign === 'start') return { align: 'left_mid', ...(padLeft > 0 ? { x: padLeft } : {}) };
  if (textAlign === 'right' || textAlign === 'end') return { align: 'right_mid', ...(padRight > 0 ? { x: -padRight } : {}) };
  return { align: 'center' };
}

function emitButton(node, parent, ctx, index) {
  const children = node.children.map((c) => emit(c, node, ctx)).filter(Boolean);
  // Name the button before its label: see emitContainer.
  const name = uid(ctx, node, 'button');
  if (node.text) {
    const { font } = fitText(node, ctx);
    children.unshift(el('lv_label', {
      name: uid(ctx, node, 'label'),
      ...buttonLabelPlacement(node),
      text: node.text,
      ...textStyles(node, font),
    }));
  }
  return el('lv_button', {
    name,
    ...placement(node, parent, { gridIndex: index }),
    ...boxStyles(node, ctx, { pad: 0 }),
  }, children);
}

/**
 * Resolve an href (or a data-lv-link value, same shape) against the set of
 * screens being converted. "./settings.html#top" -> "settings" when that
 * screen exists.
 */
function resolveScreen(href, screens) {
  if (!href) return null;
  const path = href.split(/[?#]/)[0];
  if (!path || /^[a-z]+:/i.test(path)) return null; // external / mailto: / etc.
  const file = path.split('/').pop() ?? '';
  const target = sanitize(file.replace(/\.[a-z]+$/i, ''));
  return screens.has(target) ? target : null;
}

/**
 * A link to another screen: an lv_button whose click creates and loads the
 * target. screen_create_event (rather than screen_load_event) instantiates
 * the screen on demand, so navigation works before it has ever been visited.
 */
function emitLink(node, parent, ctx, index, screen) {
  const children = node.children.map((c, i) => emit(c, node, ctx, i)).filter(Boolean);
  // Name the button before its label: see emitContainer.
  const name = uid(ctx, node, `to_${screen}`);
  if (node.text) {
    const { font } = fitText(node, ctx);
    children.unshift(el('lv_label', {
      name: uid(ctx, node, 'label'),
      align: 'center',
      text: node.text,
      ...textStyles(node, font),
    }));
  }
  children.push(el('screen_create_event', { screen }));
  return el('lv_button', {
    name,
    ...placement(node, parent, { gridIndex: index }),
    ...boxStyles(node, ctx, { pad: 0 }),
  }, children);
}

function emitInput(node, parent, ctx, index) {
  const t = node.attrs.type;

  if (t === 'range') {
    // Browsers draw a thin track inside the input's box; approximate with a
    // slim slider vertically centered in the original rect.
    const trackH = 8;
    const place = placement(node, parent, { size: false, gridIndex: index });
    if (place.y !== undefined) place.y += Math.round((node.h - trackH) / 2);
    else place.style_margin_top = (place.style_margin_top ?? 0) + Math.round((node.h - trackH) / 2);
    return el('lv_slider', {
      name: uid(ctx, node, 'slider'),
      ...place,
      width: node.w,
      height: trackH,
      min_value: node.attrs.min ?? 0,
      max_value: node.attrs.max ?? 100,
      value: node.attrs.value ?? 0,
    });
  }

  if (t === 'checkbox') {
    // A wide, styled checkbox is almost always meant as a toggle, unless
    // data-lv-widget says otherwise.
    const widget =
      node.widget === 'switch' ? 'lv_switch'
      : node.widget === 'checkbox' ? 'lv_checkbox'
      : node.w >= node.h * 1.5 ? 'lv_switch' : 'lv_checkbox';
    return el(widget, {
      name: uid(ctx, node, widget === 'lv_switch' ? 'switch' : 'checkbox'),
      ...placement(node, parent, { size: widget === 'lv_switch', gridIndex: index }),
      ...(widget === 'lv_checkbox' ? { text: '' } : {}),
      ...(node.attrs.checked ? { checked: 'true' } : {}),
    });
  }

  const { font } = fitText({ ...node, text: node.attrs.placeholder ?? node.attrs.value ?? '' }, ctx);
  // <input type=text> is a single line; <textarea> and an explicit
  // data-lv-widget="textarea" mean a multi-line box.
  const oneLine = node.widget !== 'textarea' && node.tag !== 'textarea';
  return el('lv_textarea', {
    name: uid(ctx, node, 'textarea'),
    ...placement(node, parent, { gridIndex: index }),
    one_line: oneLine ? 'true' : 'false',
    ...(node.attrs.placeholder ? { placeholder_text: node.attrs.placeholder } : {}),
    ...(node.attrs.value ? { text: node.attrs.value } : {}),
    ...(t === 'password' ? { password_mode: 'true' } : {}),
    ...boxStyles(node, ctx, { transparentDefault: false, pad: 8 }),
    style_pad_hor: node.styles.padLeft || 8,
    ...textStyles(node, font),
  });
}

/** Background, border and corner radius of a dropdown, from the element it replaces. */
function dropdownBoxStyles(node) {
  const s = node.styles;
  const border = borderOf(s);
  return {
    ...(s.bgColor ? { style_bg_color: hex(s.bgColor), ...(s.bgColor[3] < 255 ? { style_bg_opa: s.bgColor[3] } : {}) } : { style_bg_opa: '0' }),
    style_border_width: border ? border.width : 0,
    ...(border ? { style_border_color: hex(border.color), ...(border.color[3] < 255 ? { style_border_opa: border.color[3] } : {}) } : {}),
    style_radius: s.radius,
    style_shadow_width: 0,
    ...(s.padLeft > 0 ? { style_pad_left: s.padLeft } : {}),
  };
}

function emitDropdown(node, parent, ctx, index) {
  return el('lv_dropdown', {
    name: uid(ctx, node, 'dropdown'),
    ...placement(node, parent, { gridIndex: index }),
    options: (node.attrs.options ?? []).join('\n'),
    ...(node.attrs.selectedIndex > 0 ? { selected: node.attrs.selectedIndex } : {}),
    // A recognized Select (src/components/select.mjs) takes its box from the
    // page; any other dropdown keeps LVGL's default theme.
    ...(node.recognized?.component === 'select' ? dropdownBoxStyles(node) : {}),
    ...textStyles(node, ctx.fonts.for(node.styles)),
  });
}

function emitImage(node, parent, ctx, index) {
  const src = node.attrs.src ?? '';
  const assetName = sanitize(src.split('/').pop()?.replace(/\.[a-z]+$/i, '') || 'image');
  ctx.assets.push({ src, name: assetName });
  const imageName = uid(ctx, node, assetName);
  ctx.diagnostics.add({
    code: 'IMAGE_REGISTER',
    message: `<img src="${src}">: register image "${assetName}" with lv_xml_register_image() after converting it with LVGL's image converter`,
    fix: `Convert ${src} with LVGL's image converter, then call lv_xml_register_image(NULL, "${assetName}", <image data>) before creating this screen.`,
    source: sourceOf(node),
    output: { widget: imageName },
  });
  return el('lv_image', {
    name: imageName,
    ...placement(node, parent, { gridIndex: index }),
    src: assetName,
  });
}

function emitBar(node, parent, ctx, index) {
  return el('lv_bar', {
    name: uid(ctx, node, 'bar'),
    ...placement(node, parent, { gridIndex: index }),
    min_value: 0,
    // <progress> defaults to max=1 per HTML; a div forced to a bar with
    // data-lv-widget has no such convention, so use a percentage range.
    max_value: node.attrs.max ?? (node.tag === 'progress' ? 1 : 100),
    value: node.attrs.value ?? 0,
  });
}

function emitTable(node, parent, ctx, index) {
  const cells = node.attrs.cells ?? [];
  const columnCount = Math.max(0, ...cells.map((r) => r.length));
  const children = [];
  (node.attrs.columnWidths ?? []).forEach((w, column) => {
    children.push(el('lv_table-column', { column, width: w }));
  });
  cells.forEach((rowCells, row) => {
    rowCells.forEach((value, column) => {
      children.push(el('lv_table-cell', { row, column, value }));
    });
  });
  return el('lv_table', {
    name: uid(ctx, node, 'table'),
    ...placement(node, parent, { gridIndex: index }),
    column_count: columnCount,
    row_count: cells.length,
    ...textStyles(node, ctx.fonts.for(node.styles)),
  }, children);
}
