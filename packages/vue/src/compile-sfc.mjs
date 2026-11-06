/**
 * An esbuild plugin that compiles Vue single-file components (.vue) with
 * @vue/compiler-sfc, so the bundle contains plain JavaScript and the page
 * needs no runtime template compiler.
 *
 * Handled: <template>, <script>, <script setup> (JavaScript or TypeScript),
 * and <style> / <style scoped> in plain CSS. Anything the plugin cannot
 * compile (a preprocessor such as lang="scss", <style module>, src= imports)
 * is reported as a build error naming the file and block, never skipped
 * silently, because a missing stylesheet would change the converted layout.
 *
 * Two extras for html2lvgl:
 *  - every template element gets a `data-lv-line` attribute holding its line
 *    in the .vue file, so sourceOf() and TODO.txt can point at the source;
 *  - `__file` is set on each component (Vue sets it itself only in its own
 *    build tooling), so component boundaries and source files are readable
 *    at runtime.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, relative, isAbsolute, sep } from 'node:path';
import { createRequire } from 'node:module';

/** Vue's AST constants (NodeTypes), inlined to avoid a second compiler-core import. */
const NODE_ELEMENT = 1;
const NODE_ATTRIBUTE = 6;
const TAG_ELEMENT = 0;

/**
 * Load @vue/compiler-sfc from the project that owns the .vue file, then from
 * this package, so the user's own Vue version compiles their templates.
 *
 * @param {string} fromDir
 */
function loadCompiler(fromDir) {
  for (const base of [fromDir, import.meta.url]) {
    try {
      const req = createRequire(base.startsWith('file:') ? base : `${base}/noop.js`);
      return req('@vue/compiler-sfc');
    } catch { /* try the next location */ }
  }
  throw new Error(
    'cannot find @vue/compiler-sfc; install it next to your .vue files: npm install --save-dev vue @vue/compiler-sfc',
  );
}

/**
 * @typedef {object} CompilerError
 * @property {string} message
 * @property {{ start?: { line: number, column: number }, source?: string }} [loc]
 */

/**
 * Turn compiler errors into esbuild messages that point into the .vue file.
 *
 * @param {Array<CompilerError | string>} errors
 * @param {string} file
 * @param {number} lineOffset  Lines to add to a block-relative line.
 * @param {string} where       What was being compiled, such as "template".
 */
function toMessages(errors, file, lineOffset, where) {
  return errors.map((e) => {
    const err = typeof e === 'string' ? { message: e } : e;
    const start = err.loc?.start;
    return {
      text: `Vue ${where}: ${err.message}`,
      location: start
        ? { file, line: start.line + lineOffset, column: Math.max(0, start.column - 1), lineText: err.loc?.source }
        : { file },
    };
  });
}

/**
 * The path stored in `__file`: relative to the working directory with forward
 * slashes when inside it (readable in TODO.txt), absolute otherwise.
 *
 * @param {string} file
 */
export function displayPath(file) {
  const rel = relative(process.cwd(), file);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : file;
}

/**
 * @param {object} options
 * @param {string[]} options.styles  Collects compiled CSS, in import order.
 * @returns {import('esbuild').Plugin}
 */
export function vueSfcPlugin({ styles }) {
  return {
    name: 'html2lvgl-vue-sfc',
    setup(build) {
      build.onLoad({ filter: /\.vue$/ }, async (args) => {
        const source = await readFile(args.path, 'utf8');
        const dir = dirname(args.path);
        let sfc;
        try {
          sfc = loadCompiler(dir);
        } catch (err) {
          return { errors: [{ text: err instanceof Error ? err.message : String(err), location: { file: args.path } }] };
        }
        const { parse, compileScript, compileTemplate, compileStyleAsync } = sfc;

        const { descriptor, errors: parseErrors } = parse(source, { filename: args.path });
        if (parseErrors.length) {
          return { errors: toMessages(parseErrors, args.path, 0, 'single-file component syntax') };
        }

        const unsupported = [];
        if (descriptor.template?.src) unsupported.push('<template src="..."> is not supported; put the template in the .vue file');
        if (descriptor.script?.src) unsupported.push('<script src="..."> is not supported; put the script in the .vue file');
        if (descriptor.template?.lang && descriptor.template.lang !== 'html') {
          unsupported.push(`<template lang="${descriptor.template.lang}"> is not supported; use plain HTML templates`);
        }
        for (const style of descriptor.styles) {
          if (style.src) unsupported.push('<style src="..."> is not supported; put the CSS in the .vue file');
          if (style.lang && style.lang !== 'css') {
            unsupported.push(`<style lang="${style.lang}"> is not supported (no preprocessor is run); write plain CSS or precompile it`);
          }
          if (style.module) unsupported.push('<style module> is not supported; use scoped or plain styles');
        }
        if (unsupported.length) {
          return { errors: unsupported.map((text) => ({ text: `Vue SFC: ${text}`, location: { file: args.path } })) };
        }

        const id = createHash('sha256').update(displayPath(args.path)).digest('hex').slice(0, 8);
        const scopeId = `data-v-${id}`;
        const hasScoped = descriptor.styles.some((s) => s.scoped);
        const scriptLang = descriptor.scriptSetup?.lang ?? descriptor.script?.lang ?? 'js';
        const isTS = scriptLang === 'ts' || scriptLang === 'tsx';

        let code = 'const __sfc__ = {};\n';
        /** @type {Record<string, string> | undefined} */
        let bindings;
        if (descriptor.script || descriptor.scriptSetup) {
          try {
            const compiled = compileScript(descriptor, { id, inlineTemplate: false, genDefaultAs: '__sfc__' });
            code = compiled.content + '\n';
            bindings = compiled.bindings;
          } catch (err) {
            const e = /** @type {any} */ (err);
            const lineOffset = (descriptor.scriptSetup ?? descriptor.script)?.loc.start.line - 1;
            return { errors: toMessages([{ message: e.message, loc: e.loc }], args.path, lineOffset || 0, 'script') };
          }
        }

        if (descriptor.template) {
          const tplStart = descriptor.template.loc.start.line;
          const stampLine = (/** @type {any} */ node) => {
            // Component tags (tagType 1) are not DOM elements; only real
            // elements carry the line, which stays on the rendered DOM node.
            if (node.type !== NODE_ELEMENT || node.tagType !== TAG_ELEMENT) return;
            const line = String(tplStart + node.loc.start.line - 1);
            node.props.push({
              type: NODE_ATTRIBUTE,
              name: 'data-lv-line',
              nameLoc: node.loc,
              value: { type: 2, content: line, loc: node.loc },
              loc: node.loc,
            });
          };
          const tpl = compileTemplate({
            source: descriptor.template.content,
            filename: args.path,
            id,
            scoped: hasScoped,
            isProd: false,
            compilerOptions: {
              bindingMetadata: bindings,
              nodeTransforms: [stampLine],
              ...(isTS ? { expressionPlugins: ['typescript'] } : {}),
            },
          });
          if (tpl.errors.length) {
            return { errors: toMessages(tpl.errors, args.path, tplStart - 1, 'template') };
          }
          code += tpl.code + '\n__sfc__.render = render;\n';
        }

        code += `__sfc__.__file = ${JSON.stringify(displayPath(args.path))};\n`;
        code += `if (!__sfc__.__name) __sfc__.__name = ${JSON.stringify(basename(args.path, '.vue'))};\n`;
        if (hasScoped) code += `__sfc__.__scopeId = ${JSON.stringify(scopeId)};\n`;
        code += 'export default __sfc__;\n';

        for (const style of descriptor.styles) {
          const result = await compileStyleAsync({
            source: style.content,
            filename: args.path,
            id: scopeId,
            scoped: style.scoped,
          });
          if (result.errors.length) {
            return { errors: toMessages(result.errors, args.path, style.loc.start.line - 1, 'style') };
          }
          styles.push(result.code);
        }

        return { contents: code, loader: isTS ? 'ts' : 'js', resolveDir: dir };
      });
    },
  };
}
