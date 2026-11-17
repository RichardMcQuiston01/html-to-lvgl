import type { Html2LvglIR, Node as IrNode } from '../generated/ir';
import type { Html2LvglRegistryExport } from '../generated/registry';
import type { Html2LvglSidecarOverrides } from '../generated/sidecar';

export type { IrNode };
export type IrDocument = Html2LvglIR;
export type RegistryExport = Html2LvglRegistryExport;
export type SidecarOverrides = Html2LvglSidecarOverrides;

/** Final screen rectangle of one named widget, as the render program reports it (`--boxes`). */
export interface WidgetBox {
  /** The IR node's `name` attribute. */
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Nesting depth in the LVGL tree; deeper boxes are drawn on top of shallower ones. */
  depth: number;
  hidden: boolean;
}

export interface RenderDiagnostic {
  level: 'info' | 'warning' | 'error';
  message: string;
}

/** The body of `POST /render?format=json`. */
export interface RenderResponse {
  ok: true;
  width: number;
  height: number;
  cached: boolean;
  diagnostics: RenderDiagnostic[];
  /** Null when the render program predates `--boxes`; canvas selection is then unavailable. */
  boxes: WidgetBox[] | null;
  /** Base64 PNG. */
  png: string;
}

/** Why a call to the preview API failed, in terms a person can act on. */
export interface ApiFailure {
  /** The API's stable error code, or `preview_api_unreachable` / `invalid_response` for failures before one exists. */
  code: string;
  message: string;
  /** Every problem when the API listed several (invalid IR). */
  errors: string[];
  /** HTTP status, or 0 when no response arrived. */
  status: number;
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; failure: ApiFailure };

export interface Size {
  width: number;
  height: number;
}
