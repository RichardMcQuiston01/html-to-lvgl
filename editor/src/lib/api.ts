import type { ApiFailure, ApiResult, IrDocument, RegistryExport, RenderResponse, Size } from './types';

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

/** Render an IR to a picture plus the box of every named widget. */
export async function renderIr(ir: IrDocument, size: Size | undefined, options: ApiOptions = {}): Promise<ApiResult<RenderResponse>> {
  const result = await call(
    '/render?format=json',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(size === undefined ? { ir } : { ir, size }),
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
