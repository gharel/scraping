import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeConfig, serializeConfig, validateConfig } from '../../site/assets/js/shared/config.js';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_CONFIG_FILE = path.join(ROOT_DIR, 'config', 'veille.json');

export async function readConfig(file = DEFAULT_CONFIG_FILE) {
  let raw;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Configuration illisible (${file}) : ${error.message}`);
  }
  const config = normalizeConfig(raw);
  return { config, errors: validateConfig(config) };
}

export async function writeConfig(config, file = DEFAULT_CONFIG_FILE) {
  const normalized = normalizeConfig(config);
  const errors = validateConfig(normalized);
  if (errors.length) {
    const error = new Error(errors.join('\n'));
    error.validation = errors;
    throw error;
  }
  await writeFile(file, serializeConfig(normalized), 'utf8');
  return normalized;
}
