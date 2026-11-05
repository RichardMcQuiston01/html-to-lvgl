/** Minimal UiNode builders shared by the behavior tests and the fixture script. */
export const styles = {
  bgColor: null, color: [0, 0, 0, 255], borderColor: null, borderWidth: 0, borderBottomColor: null,
  borderBottomWidth: 0, radius: 0, fontSize: 16, fontFamily: 'sans-serif', fontWeight: 400, fontItalic: false,
  textAlign: 'start', opacity: 1, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0, gradient: null,
  shadow: null, scrollable: false, pressed: null,
};
export const layout = { display: 'block', position: 'static', flexGrow: 0 };

export function node(tag, extra = {}, children = []) {
  const { styles: s = {}, layout: l = {}, ...rest } = extra;
  return {
    tag, id: null, className: null, component: null, widget: null, lvName: null, link: null,
    role: null, aria: {}, classes: [], testId: null, hidden: false,
    x: 0, y: 0, w: 100, h: 20, text: null, attrs: {}, styles: { ...styles, ...s }, layout: { ...layout, ...l },
    children, ...rest,
  };
}
