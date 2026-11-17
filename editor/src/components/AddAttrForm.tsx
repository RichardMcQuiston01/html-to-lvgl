import { useState, type FormEvent } from 'react';
import { attrKeyProblem, parseAttrInput, type AttrValue } from '../lib/sidecar';

interface AddAttrFormProps {
  /** Attribute names used in the page, offered as suggestions. */
  suggestions: readonly string[];
  /** The value an existing attribute has, so a number stays a number. */
  currentValue: (key: string) => AttrValue | undefined;
  onAdd: (key: string, value: AttrValue) => void;
}

export function AddAttrForm({ suggestions, currentValue, onAdd }: AddAttrFormProps) {
  const [key, setKey] = useState<string>('');
  const [value, setValue] = useState<string>('');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const keyProblem = attrKeyProblem(key.trim());
    if (keyProblem !== null) {
      setProblem(keyProblem);
      return;
    }
    const parsed = parseAttrInput(value, currentValue(key.trim()));
    if (!parsed.ok) {
      setProblem(parsed.message);
      return;
    }
    setProblem(null);
    onAdd(key.trim(), parsed.value);
    setKey('');
    setValue('');
  };

  const field = 'rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-800';
  return (
    <form onSubmit={submit} className="mt-2" data-testid="add-attr" aria-label="Add an attribute">
      <div className="flex gap-1">
        <input list="known-attrs" aria-label="New attribute name" placeholder="name" className={`${field} w-1/2 min-w-0`} value={key} onChange={(event) => setKey(event.target.value)} data-testid="add-attr-key" />
        <input aria-label="New attribute value" placeholder="value" className={`${field} min-w-0 flex-1`} value={value} onChange={(event) => setValue(event.target.value)} data-testid="add-attr-value" />
        <button type="submit" className="rounded border border-slate-300 px-2 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800" data-testid="add-attr-submit">
          Add
        </button>
      </div>
      <datalist id="known-attrs">
        {suggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
      {problem !== null && <p role="alert" className="mt-1 text-xs text-rose-700 dark:text-rose-300" data-testid="add-attr-problem">{problem}</p>}
    </form>
  );
}
