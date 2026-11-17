import dashboard from '../../tests/golden-editor/ir_dashboard.json';
import type { IrDocument } from './lib/types';

/** The committed dashboard IR, so the editor opens with something to look at. */
export const EXAMPLE_IR = dashboard as unknown as IrDocument;
export const EXAMPLE_FILE_NAME = 'ir_dashboard.json (example)';
