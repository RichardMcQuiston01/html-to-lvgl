/**
 * React input pipeline. The implementation now lives in the built-in React
 * plugin (src/plugins/react.mjs); this keeps the old entry point working.
 */
import reactPlugin from './plugins/react.mjs';

export async function extractReactPage(jsxPath, options = {}) {
  const loaded = await reactPlugin.load(jsxPath, options);
  await loaded.handle.close();
  return loaded.tree;
}
