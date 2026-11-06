/**
 * Hand-built extractor-shaped nodes for the Phase 9 component tests. `aria`
 * keys are WITHOUT the `aria-` prefix, `classes` is the full class list.
 */
import { createDiagnostics } from '../../src/diagnostics.mjs';

export function styles(extra = {}) {
  return {
    bgColor: null, color: [10, 20, 30, 255], borderColor: null, borderWidth: 0, borderSide: null,
    borderBottomColor: null, borderBottomWidth: 0, radius: 0, fontSize: 14, fontFamily: 'Roboto', fontWeight: 400, fontItalic: false,
    textAlign: 'start', opacity: 1, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0,
    gradient: null, shadow: null, scrollable: false, pressed: null, ...extra,
  };
}

export function layout(extra = {}) {
  return {
    display: 'block', flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'normal',
    alignItems: 'normal', rowGap: 0, columnGap: 0, flexGrow: 0,
    marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, position: 'static',
    gridColumns: null, gridRows: null, gridColumnStart: 'auto', gridColumnEnd: 'auto',
    gridRowStart: 'auto', gridRowEnd: 'auto', ...extra,
  };
}

export const node = (tag, extra = {}) => ({
  tag, id: null, className: null, lvName: null, widget: null, component: null, link: null,
  x: 0, y: 0, w: 40, h: 20, text: null, attrs: {}, styles: styles(), layout: layout(), children: [], key: 'k',
  ...extra,
});

export const ctx = (extra = {}) => ({ diagnostics: createDiagnostics(), parent: null, byId: new Map(), ...extra });

/** A body that convert() takes as the page root. */
export const page = (...children) => node('body', { w: 320, h: 240, layout: layout({ display: 'flex', flexDirection: 'column' }), children });
