/**
 * Icon: a `@mui/icons-material` icon becomes an LVGL symbol when LVGL has one.
 *
 * The core can only turn an SVG into a named, empty placeholder
 * (ICON_PLACEHOLDER) because the path data says nothing about which icon it
 * is. Material UI icons are different: React knows the component (`DeleteIcon`)
 * and the SVG carries `data-testid="DeleteIcon"`, so the icon's name is known
 * and many of them have a counterpart among LVGL's built-in symbols (the Font
 * Awesome subset in every Montserrat size): Delete is LV_SYMBOL_TRASH, Add is
 * LV_SYMBOL_PLUS, Settings is LV_SYMBOL_SETTINGS.
 *
 * Signals (only for an icon with a known symbol; any other icon stays the
 * core's placeholder, so nothing is lost):
 *   0.95  a name in SYMBOLS, from the React component (`DeleteIcon`) or the
 *         `data-testid`. This is above the core's 0.9 for any `<svg>`, so it
 *         wins, and below ARIA's 1.
 *
 * build() returns one `lv_label` holding the symbol, centered in the box the
 * icon had, in the size and color the page painted. It sets the font itself:
 * a symbol exists only in the built-in Montserrat fonts, so a page converted
 * with --font-map still draws its icons.
 *
 * Variants (`DeleteOutline`, `DeleteOutlined`, `DeleteRounded`, `DeleteSharp`, `DeleteTwoTone`)
 * map to the same symbol. LVGL's symbols are solid; the weight differs.
 */
import { backdropOf, chainOf, hexOf, snake, solid, withName } from './shared.mjs';

/** @typedef {import('./shared.mjs').UiNode} UiNode */

/** Material icon name (no variant suffix) to the LVGL symbol it is drawn as. */
export const SYMBOLS = Object.freeze({
  Add: ['PLUS', ''], AddCircle: ['PLUS', ''], Remove: ['MINUS', ''],
  Check: ['OK', ''], Done: ['OK', ''], CheckCircle: ['OK', ''],
  Close: ['CLOSE', ''], Clear: ['CLOSE', ''], Cancel: ['CLOSE', ''],
  Delete: ['TRASH', ''], DeleteForever: ['TRASH', ''],
  Edit: ['EDIT', ''], Create: ['EDIT', ''],
  Settings: ['SETTINGS', ''], Home: ['HOME', ''],
  Menu: ['BARS', ''], Dehaze: ['BARS', ''],
  Refresh: ['REFRESH', ''], Sync: ['REFRESH', ''], Autorenew: ['REFRESH', ''],
  Download: ['DOWNLOAD', ''], FileDownload: ['DOWNLOAD', ''],
  Upload: ['UPLOAD', ''], FileUpload: ['UPLOAD', ''],
  Warning: ['WARNING', ''], ReportProblem: ['WARNING', ''], ErrorOutline: ['WARNING', ''],
  Notifications: ['BELL', ''], NotificationsActive: ['BELL', ''],
  Email: ['ENVELOPE', ''], Mail: ['ENVELOPE', ''],
  Visibility: ['EYE_OPEN', ''], VisibilityOff: ['EYE_CLOSE', ''],
  PlayArrow: ['PLAY', ''], Pause: ['PAUSE', ''], Stop: ['STOP', ''],
  SkipNext: ['NEXT', ''], SkipPrevious: ['PREV', ''], Eject: ['EJECT', ''],
  ChevronLeft: ['LEFT', ''], KeyboardArrowLeft: ['LEFT', ''], NavigateBefore: ['LEFT', ''], ArrowBackIos: ['LEFT', ''],
  ChevronRight: ['RIGHT', ''], KeyboardArrowRight: ['RIGHT', ''], NavigateNext: ['RIGHT', ''], ArrowForwardIos: ['RIGHT', ''],
  ExpandMore: ['DOWN', ''], KeyboardArrowDown: ['DOWN', ''], ArrowDropDown: ['DOWN', ''],
  ExpandLess: ['UP', ''], KeyboardArrowUp: ['UP', ''], ArrowDropUp: ['UP', ''],
  VolumeUp: ['VOLUME_MAX', ''], VolumeDown: ['VOLUME_MID', ''], VolumeOff: ['MUTE', ''], VolumeMute: ['MUTE', ''],
  Image: ['IMAGE', ''], Photo: ['IMAGE', ''],
  Save: ['SAVE', ''], ContentCopy: ['COPY', ''], ContentCut: ['CUT', ''], ContentPaste: ['PASTE', ''],
  Folder: ['DIRECTORY', ''], InsertDriveFile: ['FILE', ''], Description: ['FILE', ''],
  Wifi: ['WIFI', ''], Bluetooth: ['BLUETOOTH', ''], Usb: ['USB', ''], SdCard: ['SD_CARD', ''],
  BatteryFull: ['BATTERY_FULL', ''], BatteryAlert: ['BATTERY_EMPTY', ''],
  LocationOn: ['GPS', ''], Call: ['CALL', ''], Phone: ['CALL', ''],
  Keyboard: ['KEYBOARD', ''], Backspace: ['BACKSPACE', ''], KeyboardReturn: ['NEW_LINE', ''],
  PowerSettingsNew: ['POWER', ''], Shuffle: ['SHUFFLE', ''], Loop: ['LOOP', ''], Repeat: ['LOOP', ''],
  Videocam: ['VIDEO', ''], Movie: ['VIDEO', ''], MusicNote: ['AUDIO', ''], Audiotrack: ['AUDIO', ''],
  Opacity: ['TINT', ''], WaterDrop: ['TINT', ''], List: ['LIST', ''], FormatListBulleted: ['LIST', ''],
  Storage: ['DRIVE', ''], FlashOn: ['CHARGE', ''],
});

const VARIANT_SUFFIX = /(Outlined|Outline|Rounded|Sharp|TwoTone)$/;

/** Built-in Montserrat sizes that carry the symbols, with their line heights. */
const SYMBOL_FONTS = [[12, 15], [14, 16], [16, 18], [18, 21], [20, 22], [22, 24], [24, 27], [28, 30], [32, 35], [36, 40], [40, 44], [48, 52]];

/**
 * The Material icon name of an SVG, from its `data-testid` or its React
 * component, without the trailing "Icon" and variant.
 * @param {UiNode} node
 * @returns {string | null}
 */
export function iconNameOf(node) {
  const candidates = [node.testId, ...chainOf(node).map((c) => c.name)];
  for (const c of candidates) {
    if (typeof c !== 'string' || !/[a-z]Icon$/.test(c)) continue;
    const name = c.replace(/Icon$/, '').replace(VARIANT_SUFFIX, '');
    if (name in SYMBOLS) return name;
  }
  return null;
}

/**
 * The largest built-in font whose line fits an icon box of this size: the
 * glyph is about as tall as the font's size.
 * @param {number} box
 * @returns {{ size: number, lineHeight: number }}
 */
function fontFor(box) {
  const fits = SYMBOL_FONTS.filter(([, lh]) => lh <= box + 2);
  const [size, lineHeight] = fits.length ? fits[fits.length - 1] : SYMBOL_FONTS[0];
  return { size, lineHeight };
}

/** @type {import('../../../src/recognize.mjs').ComponentDef} */
const icon = {
  name: 'mui-icon',
  match(node) {
    if (node.hidden || node.native || node.tag !== 'svg') return false;
    return iconNameOf(node) ? 0.95 : false;
  },
  props: {
    icon: { type: 'string', default: '' },
    symbol: { type: 'string', default: '' },
  },
  slots: [],
  build(node, ctx) {
    const name = /** @type {string} */ (iconNameOf(node));
    const [symbolName, glyph] = SYMBOLS[name];
    const { size, lineHeight } = fontFor(Math.min(node.w, node.h));
    const color = solid(node.styles.color, backdropOf(ctx, node)) ?? [0, 0, 0];
    const out = withName({
      ...node,
      // convert() skips any <svg> before it looks at `native`, so the node
      // becomes a plain span (the core's own icon placeholder does the same).
      tag: 'span',
      widget: null,
      children: [],
      native: {
        tag: 'lv_label',
        attrs: {
          text: glyph,
          style_text_font: `montserrat_${size}`,
          style_text_color: hexOf(color),
          style_text_align: 'center',
          style_pad_top: Math.max(0, Math.floor((node.h - lineHeight) / 2)),
        },
      },
    }, `icon_${snake(name)}`);
    out.recognized = { component: 'mui-icon', props: { icon: name, symbol: `LV_SYMBOL_${symbolName}` } };
    return out;
  },
};

export default icon;
