/**
 * A small JSON Schema validator for the subset the repo's own schemas use
 * (no dependency is added for it): $ref to "#/$defs/...", type (one or a
 * list), const, enum, properties, required, additionalProperties: false,
 * items, minItems, uniqueItems, minLength and pattern. An unknown keyword
 * throws, so a schema cannot silently use something this does not check.
 */
const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', '$defs']);
const KEYWORDS = new Set([...ANNOTATIONS, '$ref', 'type', 'const', 'enum', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'uniqueItems', 'minLength', 'pattern']);

/** @param {unknown} v */
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

/**
 * @param {unknown} value
 * @param {Record<string, any>} schema  The schema to check against.
 * @param {Record<string, any>} [root]  The document `$ref`s resolve in.
 * @param {string} [path]
 * @returns {string[]}  One line per violation; empty when valid.
 */
export function validateJsonSchema(value, schema, root = schema, path = '$') {
  for (const key of Object.keys(schema)) if (!KEYWORDS.has(key)) throw new Error(`json-schema helper: unsupported keyword "${key}"`);
  /** @type {string[]} */
  const errors = [];
  if (schema.$ref !== undefined) {
    const target = String(schema.$ref).replace(/^#\//, '').split('/').reduce((n, k) => n?.[k], root);
    if (!target) throw new Error(`json-schema helper: cannot resolve ${schema.$ref}`);
    return validateJsonSchema(value, target, root, path);
  }
  const actual = typeOf(value);
  if (schema.type !== undefined) {
    const allowed = [].concat(schema.type);
    if (!allowed.some((t) => t === actual || (t === 'number' && actual === 'integer'))) errors.push(`${path}: expected ${allowed.join(' or ')}, got ${actual}`);
  }
  if ('const' in schema && value !== schema.const) errors.push(`${path}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => e === value)) errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  }
  if (actual === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (value);
    for (const key of schema.required ?? []) if (!(key in obj)) errors.push(`${path}: missing "${key}"`);
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in obj) errors.push(...validateJsonSchema(obj[key], sub, root, `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) if (!(key in (schema.properties ?? {}))) errors.push(`${path}: unexpected property "${key}"`);
    }
  }
  if (actual === 'array') {
    const arr = /** @type {unknown[]} */ (value);
    if (schema.minItems !== undefined && arr.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.uniqueItems && new Set(arr.map((v) => JSON.stringify(v))).size !== arr.length) errors.push(`${path}: items are not unique`);
    if (schema.items) arr.forEach((item, i) => errors.push(...validateJsonSchema(item, schema.items, root, `${path}[${i}]`)));
  }
  return errors;
}
