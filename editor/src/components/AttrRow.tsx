import { useState, type KeyboardEvent } from 'react';
import { cssToHex, hexToCss, isColorKey, parseAttrInput, type AttrValue, type EffectiveAttr } from '../lib/sidecar';

interface AttrRowProps {
  attr: EffectiveAttr;
  /** Node attributes can be edited only when the node has a name (the sidecar addresses nodes by name). */
  editable: boolean;
  onCommit: (value: AttrValue) => void;
  /** Forget the override: the page's own value shows again. */
  onReset: () => void;
  /** Remove the attribute (the sidecar stores null). */
  onRemove: () => void;
}

const buttonClass = 'rounded px-1 text-xs text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-slate-700 dark:hover:text-slate-100';

/** One attribute: its name, an input typed to its value, and reset or remove. A change is committed on Enter or when the field loses focus, not on every keystroke, so one edit is one undo step. */
export function AttrRow({ attr, editable, onCommit, onReset, onRemove }: AttrRowProps) {
  const shown = attr.value === undefined ? '' : String(attr.value);
  const [draft, setDraft] = useState<string>(shown);
  const [problem, setProblem] = useState<string | null>(null);
  const removed = attr.overridden && attr.value === undefined;
  const locked = !editable || attr.key === 'name';
  const reference = attr.value ?? attr.base;

  const commit = (text: string): void => {
    if (text === shown) {
      setProblem(null);
      return;
    }
    const parsed = parseAttrInput(text, reference);
    if (!parsed.ok) {
      setProblem(parsed.message);
      return;
    }
    setProblem(null);
    onCommit(parsed.value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>): void => {
    if (event.key === 'Enter') commit(draft);
    if (event.key === 'Escape') {
      setDraft(shown);
      setProblem(null);
    }
  };

  const testId = `attr-${attr.key}`;
  const rowClass = `border-t border-slate-100 dark:border-slate-800 ${attr.overridden ? 'bg-amber-50 dark:bg-amber-950/40' : ''}`;
  const colorCss = isColorKey(attr.key) ? hexToCss(attr.value) : null;

  return (
    <tr className={rowClass} data-testid={`${testId}-row`} data-overridden={attr.overridden}>
      <th scope="row" className={`break-all py-0.5 pr-2 text-left align-top font-normal ${removed ? 'text-slate-400 line-through' : 'text-slate-500'}`}>
        {attr.key}
      </th>
      <td className="py-0.5 align-top">
        {removed ? (
          <span className="font-mono text-slate-400" data-testid={`${testId}-removed`}>removed</span>
        ) : locked ? (
          <span className="break-all font-mono">{shown}</span>
        ) : typeof reference === 'boolean' ? (
          <select
            aria-label={attr.key}
            data-testid={testId}
            className="rounded border border-slate-300 bg-white px-1 font-mono dark:border-slate-600 dark:bg-slate-800"
            value={shown}
            onChange={(event) => onCommit(event.target.value === 'true')}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : (
          <span className="flex w-full items-center gap-1">
            {colorCss !== null && (
              <input
                type="color"
                aria-label={`${attr.key} colour picker`}
                data-testid={`${testId}-picker`}
                className="h-5 w-6 shrink-0 cursor-pointer border-0 bg-transparent p-0"
                value={colorCss}
                onChange={(event) => onCommit(cssToHex(event.target.value))}
              />
            )}
            <input
              type="text"
              aria-label={attr.key}
              aria-invalid={problem !== null}
              data-testid={testId}
              className={`min-w-0 flex-1 rounded border bg-white px-1 font-mono dark:bg-slate-800 ${problem === null ? 'border-slate-300 dark:border-slate-600' : 'border-rose-500'}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => commit(draft)}
              onKeyDown={onKeyDown}
            />
          </span>
        )}
        {problem !== null && (
          <p role="alert" className="mt-0.5 text-rose-700 dark:text-rose-300" data-testid={`${testId}-problem`}>{problem}</p>
        )}
        {attr.overridden && !removed && attr.base !== undefined && (
          <p className="mt-0.5 text-slate-400" data-testid={`${testId}-was`}>page: {String(attr.base)}</p>
        )}
      </td>
      <td className="whitespace-nowrap py-0.5 pl-1 text-right align-top">
        {attr.overridden && (
          <button type="button" className={buttonClass} title="Reset to the page's value" aria-label={`Reset ${attr.key}`} data-testid={`${testId}-reset`} onClick={onReset}>
            ↺
          </button>
        )}
        {!locked && !removed && (
          <button type="button" className={buttonClass} title="Remove this attribute" aria-label={`Remove ${attr.key}`} data-testid={`${testId}-remove`} onClick={onRemove}>
            ✕
          </button>
        )}
      </td>
    </tr>
  );
}
