/**
 * Tiny JSON Schema checker for the keywords tests/golden-editor/ir.schema.json
 * uses (type, const, required, properties, additionalProperties,
 * propertyNames.pattern, pattern, items, $ref into #/$defs). Not a general
 * validator; the repo takes no new dependencies. Returns a list of errors.
 */
export function checkSchema(value, schema, root = schema, path = '$') {
  const errors = [];
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o[k], root);
    return checkSchema(value, target, root, path);
  }
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  if ('const' in schema && value !== schema.const) errors.push(`${path}: expected ${JSON.stringify(schema.const)}`);
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.includes(typeOf(value))) return [`${path}: expected ${types.join('|')}, got ${typeOf(value)}`];
  }
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: "${value}" does not match ${schema.pattern}`);
  if (typeOf(value) === 'array' && schema.items) value.forEach((v, i) => errors.push(...checkSchema(v, schema.items, root, `${path}[${i}]`)));
  if (typeOf(value) === 'object') {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(`${path}: missing "${k}"`);
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k];
      if (sub) errors.push(...checkSchema(v, sub, root, `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: unknown field "${k}"`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errors.push(...checkSchema(v, schema.additionalProperties, root, `${path}.${k}`));
      if (schema.propertyNames?.pattern && !new RegExp(schema.propertyNames.pattern).test(k)) errors.push(`${path}: property name "${k}" does not match ${schema.propertyNames.pattern}`);
    }
  }
  return errors;
}
