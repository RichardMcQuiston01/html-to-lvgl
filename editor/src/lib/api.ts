import type { ApiFailure, ApiResult, IrDocument, RegistryExport, RenderResponse, SidecarOverrides, Size } from './types';

/** Where the preview API is reached: the dev server proxies this to `html2lvgl --preview-api`. */
export const DEFAULT_API_BASE = '/api';

const UNREACHABLE_HINT = 'start it with: html2lvgl --preview-api (default port 8787), or set HTML2LVGL_PREVIEW_URL when starting the editor';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Turn a non-OK response body into a failure, keeping the API's code and its list of problems. */
function failureFromBody(status: number, body: unknown): ApiFailure {
  if (isRecord(body) && typeof body['code'] === 'string') {
    const errors = Array.isArray(body['errors']) ? body['errors'].filter((e): e is string => typeof e === 'string') : [];
    const message = typeof body['message'] === 'string' ? body['message'] : `the preview API answered ${status} (${body['code']})`;
    return { code: body['code'], message, errors, status };
  }
  return { code: 'invalid_response', message: `the preview API answered ${status} with a body that is not an error object`, errors: [], status };
}

/** One request to the preview API. Never throws: every failure comes back as `{ ok: false }`. */
async function call(
  path: string,
  init: RequestInit,
  baseUrl: string,
  fetchFn: typeof fetch,
): Promise<ApiResult<unknown>> {
  let response: Response;
  try {
    response = await fetchFn(`${baseUrl}${path}`, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, failure: { code: 'aborted', message: 'the request was cancelled', errors: [], status: 0 } };
    }
    return {
      ok: false,
      failure: {
        code: 'preview_api_unreachable',
        message: `cannot reach the preview API at ${baseUrl || '/'} (${err instanceof Error ? err.message : String(err)}); ${UNREACHABLE_HINT}`,
        errors: [],
        status: 0,
      },
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // A dev-server proxy with nothing behind it answers 500/502 with text.
    const code = response.status >= 500 ? 'preview_api_unreachable' : 'invalid_response';
    const message =
      code === 'preview_api_unreachable'
        ? `the preview API did not answer (HTTP ${response.status}); ${UNREACHABLE_HINT}`
        : `the preview API answered ${response.status} with a body that is not JSON`;
    return { ok: false, failure: { code, message, errors: [], status: response.status } };
  }
  if (!response.ok) return { ok: false, failure: failureFromBody(response.status, body) };
  return { ok: true, value: body };
}

export interface ApiOptions {
  baseUrl?: string;
  /** For tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

export interface RenderOptions extends ApiOptions {
  /** Overrides applied to the IR before it is rendered (the page's own `.lvgl.json`, edited). */
  sidecar?: SidecarOverrides;
}

/** Render an IR to a picture plus the box of every named widget. */
export async function renderIr(ir: IrDocument, size: Size | undefined, options: RenderOptions = {}): Promise<ApiResult<RenderResponse>> {
  const result = await call(
    '/render?format=json',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ir, ...(size === undefined ? {} : { size }), ...(options.sidecar === undefined ? {} : { sidecar: options.sidecar }) }),
      signal: options.signal ?? null,
    },
    options.baseUrl ?? DEFAULT_API_BASE,
    options.fetchFn ?? fetch,
  );
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || typeof body['png'] !== 'string' || typeof body['width'] !== 'number' || typeof body['height'] !== 'number') {
    return { ok: false, failure: { code: 'invalid_response', message: 'the render response is missing the picture or its size', errors: [], status: 200 } };
  }
  return { ok: true, value: body as unknown as RenderResponse };
}

/** The component registry: what the palette and the property panel are built from. */
export async function fetchRegistry(options: ApiOptions = {}): Promise<ApiResult<RegistryExport>> {
  const result = await call('/registry', { signal: options.signal ?? null }, options.baseUrl ?? DEFAULT_API_BASE, options.fetchFn ?? fetch);
  if (!result.ok) return result;
  return { ok: true, value: result.value as RegistryExport };
}

/** Is the preview API answering? */
export async function checkHealth(options: ApiOptions = {}): Promise<ApiResult<{ ok: boolean }>> {
  const result = await call('/health', { signal: options.signal ?? null }, options.baseUrl ?? DEFAULT_API_BASE, options.fetchFn ?? fetch);
  if (!result.ok) return result;
  return { ok: true, value: { ok: isRecord(result.value) && result.value['ok'] === true } };
}

/** A sidecar read from the workspace. `exists` is false when there is no file yet (not an error). */
export interface StoredSidecar {
  exists: boolean;
  sidecar: SidecarOverrides | null;
}

/** Load `<name>.lvgl.json` from the preview API's workspace. A 501 (`workspace_not_configured`) means saving is off. */
export async function fetchSidecar(name: string, options: ApiOptions = {}): Promise<ApiResult<StoredSidecar>> {
  const result = await call(`/sidecar/${encodeURIComponent(name)}`, { signal: options.signal ?? null }, options.baseUrl ?? DEFAULT_API_BASE, options.fetchFn ?? fetch);
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || typeof body['exists'] !== 'boolean') {
    return { ok: false, failure: { code: 'invalid_response', message: 'the sidecar response does not say whether the file exists', errors: [], status: 200 } };
  }
  return { ok: true, value: { exists: body['exists'], sidecar: body['exists'] ? (body['sidecar'] as SidecarOverrides) : null } };
}

/** Save `<name>.lvgl.json` in the workspace. The API validates it first and lists every problem on failure. */
export async function saveSidecar(name: string, sidecar: SidecarOverrides, options: ApiOptions = {}): Promise<ApiResult<{ file: string }>> {
  const result = await call(
    `/sidecar/${encodeURIComponent(name)}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sidecar }), signal: options.signal ?? null },
    options.baseUrl ?? DEFAULT_API_BASE,
    options.fetchFn ?? fetch,
  );
  if (!result.ok) return result;
  const body = result.value;
  return { ok: true, value: { file: isRecord(body) && typeof body['file'] === 'string' ? body['file'] : `${name}.lvgl.json` } };
}
