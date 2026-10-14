import { SERVICE_TEXT_CHARS, SERVICE_ANSWER_BYTES, serializedAnswerBytes } from '../../shared/serviceLimits.mjs';
export const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'radio', 'checkbox', 'email', 'phone', 'file'];
export const fail = (message, status = 400, meta = {}) => { throw Object.assign(new Error(message), { status, meta }); };
export const text = (value, label, max = 2000, required = false) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`${label} is invalid`);
  return value.trim();
};
export function validateDefinition(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Invalid service definition');
  const name = text(body.name, 'Name', 150, true);
  const slug = text(body.slug, 'Identifier', 100, true);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail('Identifier must contain lowercase letters, numbers and hyphens');
  const description = text(body.description, 'Description', 10000, true);
  const instructions = text(body.instructions ?? '', 'Instructions', 10000);
  const { mode, amount, currency } = body.pricing || {};
  // Marketplace prices use major currency units. Require exact two-decimal precision.
  if (!['free', 'fixed'].includes(mode) || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 10000000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001 || (mode === 'free' && amount !== 0) || (mode === 'fixed' && amount <= 0)) fail('Invalid service price');
  try { if (!/^[A-Z]{3}$/.test(currency) || !Intl.supportedValuesOf('currency').includes(currency)) fail('Invalid currency'); } catch { fail('Invalid currency'); }
  if (!Array.isArray(body.fields) || body.fields.length > 50) fail('Provide at most 50 form fields');
  const ids = new Set();
  const fields = body.fields.map(f => {
    if (!f || typeof f !== 'object' || Array.isArray(f) || typeof f.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(f.id) || ['constructor', 'prototype', '__proto__'].includes(f.id) || ids.has(f.id)) fail('Invalid or duplicate field identifier');
    ids.add(f.id);
    if (!FIELD_TYPES.includes(f.type) || typeof f.required !== 'boolean') fail(`Invalid configuration for ${f.id}`);
    const field = { id: f.id, type: f.type, label: text(f.label, 'Field label', 150, true), required: f.required, help: text(f.help ?? '', 'Help', 500) };
    if (['select', 'radio'].includes(f.type)) {
      if (!Array.isArray(f.options) || !f.options.length || f.options.length > 50) fail(`Options required for ${f.id}`);
      field.options = f.options.map(o => text(o, 'Option', 150, true));
      if (new Set(field.options).size !== field.options.length) fail('Duplicate options');
    }
    for (const key of ['min', 'max', 'minLength', 'maxLength']) {
      if (f[key] === undefined || f[key] === '') continue;
      if ((['min', 'max'].includes(key) && f.type !== 'number') || (key.includes('Length') && !['text', 'textarea', 'email', 'phone'].includes(f.type))) fail(`${key} is not supported for ${f.type}`);
      if (typeof f[key] !== 'number' || !Number.isFinite(f[key]) || (key.includes('Length') && (!Number.isInteger(f[key]) || f[key] < 0 || f[key] > SERVICE_TEXT_CHARS))) fail(`Invalid ${key}`);
      field[key] = f[key];
    }
    if (field.min > field.max || field.minLength > field.maxLength) fail('Minimum must not exceed maximum');
    if (f.type === 'file') {
      field.formats = f.formats ?? ['pdf', 'png', 'jpg'];
      if (!Array.isArray(field.formats) || !field.formats.length || field.formats.some(x => !['pdf', 'png', 'jpg'].includes(x)) || new Set(field.formats).size !== field.formats.length) fail('Unsupported file formats');
      field.maxBytes = f.maxBytes ?? 5 * 1024 * 1024;
      if (!Number.isInteger(field.maxBytes) || field.maxBytes < 1 || field.maxBytes > 5 * 1024 * 1024) fail('File limit must be between 1 byte and 5 MB');
    }
    return field;
  });
  if (fields.filter(f => f.type === 'file').length > 10) fail('At most 10 document fields are supported');
  return { name, slug, description, instructions, pricing: { mode, amount, currency }, fields };
}
export function validateAnswers(fields, answers, files = []) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) fail('Answers must be an object');
  if (serializedAnswerBytes(answers) > SERVICE_ANSWER_BYTES) fail('Application answers exceed the 256 KiB total limit. Please shorten your answers.', 413);
  const errors = {};
  const ordinary = fields.filter(f => f.type !== 'file');
  if (Object.keys(answers).some(k => !ordinary.some(f => f.id === k))) fail('Unknown form answer');
  if (files.some(file => !fields.some(f => f.type === 'file' && f.id === file.fieldname))) fail('Unknown document field');
  for (const f of fields) {
    const value = answers[f.id];
    const uploads = files.filter(file => file.fieldname === f.id);
    if (f.type === 'file') {
      if (uploads.length > 1 || (f.required && uploads.length !== 1)) errors[f.id] = 'One document is required';
      for (const file of uploads) if (!f.formats.includes(file.format) || file.sizeBytes > f.maxBytes) errors[f.id] = 'Document format or size is not allowed';
      continue;
    }
    if (value === undefined || value === '' || value === null) { if (f.required) errors[f.id] = 'This field is required'; continue; }
    if (f.type === 'checkbox') { if (typeof value !== 'boolean' || (f.required && !value)) errors[f.id] = 'Please confirm this field'; continue; }
    if (f.type === 'number') { if (typeof value !== 'number' || !Number.isFinite(value) || value < (f.min ?? -Infinity) || value > (f.max ?? Infinity)) errors[f.id] = 'Number is outside the allowed range'; continue; }
    if (typeof value !== 'string' || value.length < (f.minLength ?? 0) || value.length > Math.min(f.maxLength ?? SERVICE_TEXT_CHARS, SERVICE_TEXT_CHARS) || (f.required && !value.trim())) { errors[f.id] = 'Text length is invalid'; continue; }
    if (['select', 'radio'].includes(f.type) && !f.options.includes(value)) errors[f.id] = 'Choose an allowed option';
    if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors[f.id] = 'Enter a valid email';
    if (f.type === 'phone' && !/^\+?[0-9 ()-]{7,20}$/.test(value)) errors[f.id] = 'Enter a valid phone number';
    if (f.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) errors[f.id] = 'Enter a valid date';
  }
  if (Object.keys(errors).length) fail('Please correct the application fields', 400, { fields: errors });
  return answers;
}
