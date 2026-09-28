import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ConfigSchema } from '../src/config/config.schema';
import { makeTestConfig } from './helpers/fake-config';

describe('ConfigSchema', () => {
  it('accepts the shipped config.example.yaml template as-is', () => {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'templates', 'config.example.yaml'), 'utf8');
    const result = ConfigSchema.safeParse(parseYaml(raw));
    expect(result.success).toBe(true);
  });

  it('accepts a valid config', () => {
    const result = ConfigSchema.safeParse(makeTestConfig());
    expect(result.success).toBe(true);
  });

  it('rejects an unknown top-level key (typo protection)', () => {
    const result = ConfigSchema.safeParse({ ...makeTestConfig(), extra: true });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown nested key', () => {
    const config = makeTestConfig();
    const result = ConfigSchema.safeParse({ ...config, filters: { ...config.filters, typoField: 'x' } });
    expect(result.success).toBe(false);
  });

  it('rejects the wrong type for an array field', () => {
    const config = makeTestConfig();
    const result = ConfigSchema.safeParse({ ...config, filters: { ...config.filters, titleInclude: 'not-an-array' } });
    expect(result.success).toBe(false);
  });

  it('rejects a missing required field', () => {
    const config = makeTestConfig() as Record<string, unknown>;
    delete config.profile;
    const result = ConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});
