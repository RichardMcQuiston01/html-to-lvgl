import { nodeLabel, nodeName } from '../lib/irTree';
import type { IrNode, WidgetBox } from '../lib/types';

interface PropertiesPanelProps {
  node: IrNode | null;
  box: WidgetBox | null;
  boxesAvailable: boolean;
}

const formatValue = (value: string | number | boolean | null): string => (value === null ? 'null' : String(value));

export function PropertiesPanel({ node, box, boxesAvailable }: PropertiesPanelProps) {
  if (node === null) {
    return <p className="p-3 text-sm text-slate-500" data-testid="properties-empty">Select a widget in the tree or on the canvas.</p>;
  }
  const attrs = Object.entries(node.attrs);
  const name = nodeName(node);
  return (
    <section aria-label="Properties" className="p-3 text-sm" data-testid="properties">
      <h2 className="font-semibold" data-testid="properties-title">{nodeLabel(node)}</h2>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-slate-500">tag</dt>
        <dd>{node.tag}</dd>
        <dt className="text-slate-500">children</dt>
        <dd>{node.children.length}</dd>
        <dt className="text-slate-500">on screen</dt>
        <dd data-testid="properties-box">
          {box !== null
            ? `x ${box.x}, y ${box.y}, ${box.width}×${box.height}${box.hidden ? ' (hidden)' : ''}`
            : name === null
              ? 'not reported: this node has no name'
              : boxesAvailable
                ? 'not reported for this node'
                : 'unavailable: rebuild the render program (html2lvgl --build-render --rebuild)'}
        </dd>
      </dl>
      <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Attributes</h3>
      {attrs.length === 0 ? (
        <p className="text-xs text-slate-500">None.</p>
      ) : (
        <table className="mt-1 w-full text-xs">
          <tbody>
            {attrs.map(([key, value]) => (
              <tr key={key} className="border-t border-slate-100 dark:border-slate-800">
                <th scope="row" className="py-0.5 pr-3 text-left font-normal text-slate-500">{key}</th>
                <td className="break-all py-0.5 font-mono">{formatValue(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
