import { describe, expect, it } from 'vitest';
import { designSize, parseIrText } from '../src/lib/irFile';
import dashboardText from '../../tests/golden-editor/ir_dashboard.json?raw';

describe('parseIrText', () => {
  it('accepts the committed dashboard IR', () => {
    const result = parseIrText(dashboardText);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ir.name).toBe('dashboard');
  });

  it('explains what is wrong with each kind of bad file', () => {
    const cases: [string, RegExp][] = [
      ['{nope', /not valid JSON/],
      ['[]', /JSON object/],
      ['{"format":"something-else"}', /not an html2lvgl IR file.*--export-ir/],
      ['{"format":"html2lvgl-ir","irVersion":2}', /irVersion 1.*irVersion 2/],
      ['{"format":"html2lvgl-ir","irVersion":1,"view":{}}', /"name" must be a string/],
      ['{"format":"html2lvgl-ir","irVersion":1,"name":"x","view":{"tag":"view","attrs":{},"children":[5]}}', /view\.children\[0\] must be an object/],
    ];
    for (const [text, message] of cases) {
      const result = parseIrText(text);
      expect(result.ok, text).toBe(false);
      if (!result.ok) expect(result.errors.join(' '), text).toMatch(message);
    }
  });
});

describe('designSize', () => {
  const ir = (attrs: Record<string, string | number>) =>
    ({ view: { tag: 'view', attrs, children: [] } }) as unknown as Parameters<typeof designSize>[0];

  it('uses the root view size when it has one', () => {
    expect(designSize(ir({ width: 480, height: 320 }), { width: 320, height: 240 })).toEqual({ width: 480, height: 320 });
  });

  it('falls back when the root has no usable size', () => {
    expect(designSize(ir({}), { width: 320, height: 240 })).toEqual({ width: 320, height: 240 });
    expect(designSize(ir({ width: '100%', height: 10 }), { width: 320, height: 240 })).toEqual({ width: 320, height: 240 });
  });
});
