import { describe, expect, it } from 'vitest';
import { checkHealth, fetchRegistry, fetchSidecar, renderIr, saveSidecar } from '../src/lib/api';
import type { IrDocument } from '../src/lib/types';

const ir = { format: 'html2lvgl-ir', irVersion: 1, name: 'x', view: { tag: 'view', attrs: {}, children: [] } } as unknown as IrDocument;

/** A fetch that answers with a fixed response and records the request. */
function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.url = url;
    if (init !== undefined) seen.init = init;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

describe('renderIr', () => {
  it('posts the IR (and size) and returns the render', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const body = { ok: true, width: 320, height: 240, cached: false, diagnostics: [], boxes: [], png: 'AAAA' };
    const result = await renderIr(ir, { width: 320, height: 240 }, { fetchFn: fakeFetch(200, body, seen) });
    expect(result).toEqual({ ok: true, value: body });
    expect(seen.url).toBe('/api/render?format=json');
    expect(JSON.parse(String(seen.init?.body))).toEqual({ ir, size: { width: 320, height: 240 } });
  });

  it('keeps the API error code and every listed problem', async () => {
    const body = { ok: false, code: 'invalid_ir', message: 'invalid IR: 2 problems', errors: ['a', 'b'] };
    const result = await renderIr(ir, undefined, { fetchFn: fakeFetch(422, body) });
    expect(result).toEqual({ ok: false, failure: { code: 'invalid_ir', message: 'invalid IR: 2 problems', errors: ['a', 'b'], status: 422 } });
  });

  it('says how to start the preview API when nothing answers', async () => {
    const refuse = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const result = await renderIr(ir, undefined, { fetchFn: refuse });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('preview_api_unreachable');
      expect(result.failure.message).toMatch(/html2lvgl --preview-api/);
    }
  });

  it('treats a proxy error page as unreachable, not as a broken response', async () => {
    const result = await renderIr(ir, undefined, { fetchFn: fakeFetch(502, 'Bad Gateway') });
    expect(result.ok === false && result.failure.code).toBe('preview_api_unreachable');
  });

  it('rejects a render response without a picture', async () => {
    const result = await renderIr(ir, undefined, { fetchFn: fakeFetch(200, { ok: true }) });
    expect(result.ok === false && result.failure.code).toBe('invalid_response');
  });

  it('reports a cancelled request as aborted', async () => {
    const abort = (async () => { throw new DOMException('x', 'AbortError'); }) as unknown as typeof fetch;
    const result = await renderIr(ir, undefined, { fetchFn: abort });
    expect(result.ok === false && result.failure.code).toBe('aborted');
  });
});

describe('fetchRegistry and checkHealth', () => {
  it('fetch the registry and the health', async () => {
    expect(await fetchRegistry({ fetchFn: fakeFetch(200, { schemaVersion: 1, components: [], widgets: [] }) })).toMatchObject({ ok: true });
    expect(await checkHealth({ fetchFn: fakeFetch(200, { ok: true }) })).toEqual({ ok: true, value: { ok: true } });
  });
});

describe('sidecar calls', () => {
  const sidecar = { version: 1 as const, nodes: { card: { attrs: { width: 200 } } } };

  it('renderIr sends the sidecar only when there is one', async () => {
    const seen: { init?: RequestInit } = {};
    const body = { ok: true, width: 1, height: 1, cached: false, diagnostics: [], boxes: [], png: 'A' };
    await renderIr(ir, undefined, { sidecar, fetchFn: fakeFetch(200, body, seen) });
    expect(JSON.parse(String(seen.init?.body))).toEqual({ ir, sidecar });
    await renderIr(ir, undefined, { fetchFn: fakeFetch(200, body, seen) });
    expect(JSON.parse(String(seen.init?.body))).toEqual({ ir });
  });

  it('fetchSidecar returns the stored sidecar, or null when there is no file yet', async () => {
    const seen: { url?: string } = {};
    expect(await fetchSidecar('my page', { fetchFn: fakeFetch(200, { ok: true, exists: true, sidecar }, seen) })).toEqual({ ok: true, value: { exists: true, sidecar } });
    expect(seen.url).toBe('/api/sidecar/my%20page');
    expect(await fetchSidecar('p', { fetchFn: fakeFetch(200, { ok: true, exists: false, sidecar: null }) })).toEqual({ ok: true, value: { exists: false, sidecar: null } });
  });

  it('fetchSidecar passes on workspace_not_configured so the editor can turn saving off', async () => {
    const body = { ok: false, code: 'workspace_not_configured', message: 'start with --workspace' };
    const result = await fetchSidecar('p', { fetchFn: fakeFetch(501, body) });
    expect(result.ok === false && result.failure.code).toBe('workspace_not_configured');
  });

  it('saveSidecar PUTs the sidecar and keeps the API problems on failure', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    expect(await saveSidecar('page', sidecar, { fetchFn: fakeFetch(200, { ok: true, file: 'page.lvgl.json', bytes: 9 }, seen) })).toEqual({ ok: true, value: { file: 'page.lvgl.json' } });
    expect(seen.init?.method).toBe('PUT');
    expect(JSON.parse(String(seen.init?.body))).toEqual({ sidecar });
    const bad = { ok: false, code: 'sidecar_invalid', message: 'not a valid sidecar', errors: ['nodes.card.remove must be a boolean'] };
    const result = await saveSidecar('page', sidecar, { fetchFn: fakeFetch(422, bad) });
    expect(result.ok === false && result.failure.errors).toEqual(['nodes.card.remove must be a boolean']);
  });
});
