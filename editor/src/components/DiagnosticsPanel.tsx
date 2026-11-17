import type { ApiFailure, RenderDiagnostic } from '../lib/types';

interface DiagnosticsPanelProps {
  diagnostics: readonly RenderDiagnostic[];
  failure: ApiFailure | null;
  parseErrors: readonly string[];
}

const LEVEL_CLASS: Record<RenderDiagnostic['level'], string> = {
  info: 'text-sky-700 dark:text-sky-300',
  warning: 'text-amber-700 dark:text-amber-300',
  error: 'text-rose-700 dark:text-rose-300',
};

export function DiagnosticsPanel({ diagnostics, failure, parseErrors }: DiagnosticsPanelProps) {
  const empty = diagnostics.length === 0 && failure === null && parseErrors.length === 0;
  return (
    <section aria-label="Diagnostics" className="p-3 text-xs" data-testid="diagnostics">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Diagnostics</h2>
      {empty && <p className="mt-1 text-slate-500">Nothing to report.</p>}
      {parseErrors.length > 0 && (
        <ul className="mt-1 space-y-1">
          {parseErrors.map((message) => (
            <li key={message} className={LEVEL_CLASS.error} data-testid="parse-error">{message}</li>
          ))}
        </ul>
      )}
      {failure !== null && (
        <div className="mt-1" data-testid="render-failure">
          <p className={LEVEL_CLASS.error}>
            <span className="font-mono">{failure.code}</span>: {failure.message}
          </p>
          {failure.errors.length > 0 && (
            <ul className="ml-4 mt-1 list-disc">
              {failure.errors.map((error) => (
                <li key={error} className={LEVEL_CLASS.error}>{error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {diagnostics.length > 0 && (
        <ul className="mt-1 space-y-1">
          {diagnostics.map((item) => (
            <li key={`${item.level}:${item.message}`} className={LEVEL_CLASS[item.level]}>
              <span className="font-mono uppercase">{item.level}</span> {item.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
