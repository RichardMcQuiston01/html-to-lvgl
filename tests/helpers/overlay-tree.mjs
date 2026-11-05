/** Hand-built extractor-shaped pages for the Modal and Drawer tests (320x240). */
import { node } from './tree.mjs';

const fixed = { position: 'fixed' };

/** A page body: an opener row, then the given overlay nodes. */
export function page(children, extra = {}) {
  return node('body', { key: 'body', w: 320, h: 240, layout: { display: 'flex', flexDirection: 'column' }, ...extra }, children);
}

export const button = (text, extra = {}) => node('button', { text, w: 60, h: 30, ...extra });

/** A centered dialog box with a title and two buttons. */
export function dialog(extra = {}) {
  return node('div', {
    id: 'dlg', role: 'dialog', aria: { modal: 'true', labelledby: 'dlg-title' },
    x: 40, y: 60, w: 240, h: 120, layout: fixed,
    styles: { bgColor: [255, 255, 255, 255], radius: 8 },
    ...extra,
  }, [
    node('h2', { id: 'dlg-title', text: 'Delete this item?', x: 56, y: 74, w: 150, h: 20 }),
    button('Cancel', { x: 100, y: 140 }),
    button('Delete', { x: 170, y: 140 }),
  ]);
}

/** A side panel docked to the given edge. */
export function panel(edge = 'left', extra = {}) {
  const box = {
    left: { x: 0, y: 0, w: 200, h: 240 },
    right: { x: 120, y: 0, w: 200, h: 240 },
    top: { x: 0, y: 0, w: 320, h: 100 },
    bottom: { x: 0, y: 140, w: 320, h: 100 },
  }[edge];
  return node('div', {
    id: 'nav', role: 'dialog', aria: { modal: 'true' }, ...box, layout: fixed,
    styles: { bgColor: [255, 255, 255, 255] },
    ...extra,
  }, [node('p', { text: 'Menu', ...box, h: 20 }), button('Close', { x: box.x + 10, y: box.y + 60 })]);
}

/** An opener button that controls `id`. */
export const opener = (id, extra = {}) => button('Open', { id: 'open', aria: { controls: id, haspopup: 'dialog' }, ...extra });
