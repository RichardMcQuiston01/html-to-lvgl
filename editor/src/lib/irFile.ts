import type { IrDocument } from './types';

export type ParseResult = { ok: true; ir: IrDocument } | { ok: false; errors: string[] };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Check the shape of one tree node, adding a line per problem. Stops at the first broken node so a deep tree gives a short list. */
function checkNode(node: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(node)) {
    problems.push(`${path} must be an object`);
    return;
  }
  if (typeof node['tag'] !== 'string') problems.push(`${path}.tag must be a string`);
  if (!isPlainObject(node['attrs'])) problems.push(`${path}.attrs must be an object`);
  const children = node['children'];
  if (!Array.isArray(children)) {
    problems.push(`${path}.children must be an array`);
    return;
  }
  if (problems.length > 0) return;
  children.forEach((child, index) => checkNode(child, `${path}.children[${index}]`, problems));
}

/**
 * Read IR from file text. This is a quick check that the file is the right
 * kind and the editor can walk it; the preview API runs the full validation
 * (unique names, attribute rules) when it renders, and its list of problems is
 * shown to the person.
 */
export function parseIrText(text: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (!isPlainObject(value)) return { ok: false, errors: ['the file must contain a JSON object'] };
  if (value['format'] !== 'html2lvgl-ir') {
    return { ok: false, errors: [`not an html2lvgl IR file: "format" is ${JSON.stringify(value['format'])}, expected "html2lvgl-ir" (create one with: html2lvgl page.html --export-ir ir.json)`] };
  }
  if (value['irVersion'] !== 1) {
    return { ok: false, errors: [`this editor reads irVersion 1, but the file has irVersion ${JSON.stringify(value['irVersion'])}`] };
  }
  const problems: string[] = [];
  if (typeof value['name'] !== 'string') problems.push('"name" must be a string');
  checkNode(value['view'], 'view', problems);
  if (problems.length > 0) return { ok: false, errors: problems };
  return { ok: true, ir: value as unknown as IrDocument };
}

/** The size the page is designed for: the root view's width and height, else a default. */
export function designSize(ir: IrDocument, fallback: { width: number; height: number }): { width: number; height: number } {
  const width = Number(ir.view.attrs['width']);
  const height = Number(ir.view.attrs['height']);
  if (Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0) return { width, height };
  return { ...fallback };
}
