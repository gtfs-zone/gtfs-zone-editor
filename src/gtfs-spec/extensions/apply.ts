import type { GTFSFieldSpec, GTFSFileSpec, GTFSSpec } from '../types';
import type { GTFSSpecExtension } from './types';

function findFile(spec: GTFSSpec, ext: string, filename: string): GTFSFileSpec {
  const file = spec.files.find((f) => f.filename === filename);
  if (!file) {
    throw new Error(`[SpecExtensions] ${ext}: no file ${filename}`);
  }
  return file;
}

function findField(
  file: GTFSFileSpec,
  ext: string,
  name: string
): GTFSFieldSpec {
  const field = file.fields?.find((f) => f.name === name);
  if (!field) {
    throw new Error(
      `[SpecExtensions] ${ext}: no field ${file.filename} ${name}`
    );
  }
  return field;
}

/**
 * Returns a copy of `base` with each extension applied in order. Files go in
 * first, then fields, enum values and notes, so later kinds can target items
 * an extension adds. Throws when a target is missing or an item already exists.
 */
export function applyExtensions(
  base: GTFSSpec,
  extensions: GTFSSpecExtension[]
): GTFSSpec {
  const spec: GTFSSpec = structuredClone(base);

  for (const ext of extensions) {
    const id = ext.id;

    for (const file of ext.files) {
      if (spec.files.some((f) => f.filename === file.filename)) {
        throw new Error(`[SpecExtensions] ${id}: file ${file.filename} exists`);
      }
      spec.files.push({ ...structuredClone(file), origin: id });
    }

    for (const { file: filename, after, spec: fieldSpec } of ext.fields) {
      const file = findFile(spec, id, filename);
      const fields = (file.fields ??= []);
      if (fields.some((f) => f.name === fieldSpec.name)) {
        throw new Error(
          `[SpecExtensions] ${id}: field ${filename} ${fieldSpec.name} exists`
        );
      }
      const added = { ...structuredClone(fieldSpec), origin: id };
      if (after === undefined) {
        fields.push(added);
      } else {
        const index = fields.indexOf(findField(file, id, after));
        fields.splice(index + 1, 0, added);
      }
    }

    let enumValueCount = 0;
    for (const { file: filename, field: name, values } of ext.enumValues) {
      const field = findField(findFile(spec, id, filename), id, name);
      if (!field.enumValues) {
        throw new Error(
          `[SpecExtensions] ${id}: ${filename} ${name} is not an enum`
        );
      }
      for (const value of values) {
        if (field.enumValues.some((v) => v.value === value.value)) {
          throw new Error(
            `[SpecExtensions] ${id}: ${filename} ${name} value ${value.value} exists`
          );
        }
        field.enumValues.push({ ...value, origin: id });
        enumValueCount++;
      }
    }

    for (const { file: filename, field: name, text } of ext.notes) {
      const file = findFile(spec, id, filename);
      const target = name === undefined ? file : findField(file, id, name);
      const notes = (target.notes ??= []);
      if (notes.some((n) => n.origin === id && n.text === text)) {
        throw new Error(
          `[SpecExtensions] ${id}: duplicate note on ${filename} ${name ?? ''}`
        );
      }
      notes.push({ origin: id, text });
    }

    console.log(
      `[SpecExtensions] ${id}: +${ext.files.length} files, +${ext.fields.length} fields, +${enumValueCount} enum values, +${ext.notes.length} notes`
    );
  }

  return spec;
}
