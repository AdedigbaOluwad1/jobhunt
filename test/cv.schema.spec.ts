import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { MasterCvSchema } from '../src/cv/cv.schema';

function validCv(): Record<string, unknown> {
  return {
    basics: { name: 'Jane Doe', email: 'jane@example.com', phone: '+1', location: 'Remote', links: [] },
    summary: 'A summary.',
    skills: [{ group: 'Languages', items: ['TypeScript'] }],
    experience: [
      {
        id: 'exp-1',
        company: 'Acme',
        title: 'Engineer',
        start: '2020-01',
        end: null,
        bullets: [{ id: 'exp-1-1', text: 'Did a thing.', tags: [] }],
      },
    ],
    projects: [],
    education: [],
  };
}

describe('MasterCvSchema', () => {
  it('accepts the shipped master-cv.example.yaml template as-is', () => {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'templates', 'master-cv.example.yaml'), 'utf8');
    const result = MasterCvSchema.safeParse(parseYaml(raw));
    expect(result.success).toBe(true);
  });

  it('accepts a minimal valid CV', () => {
    expect(MasterCvSchema.safeParse(validCv()).success).toBe(true);
  });

  it('rejects an unknown top-level key', () => {
    const result = MasterCvSchema.safeParse({ ...validCv(), extra: true });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate bullet ids across different roles', () => {
    const cv = validCv();
    cv.projects = [{ id: 'proj-1', name: 'Side Project', bullets: [{ id: 'exp-1-1', text: 'Reused id.', tags: [] }] }];
    const result = MasterCvSchema.safeParse(cv);
    expect(result.success).toBe(false);
  });

  it('rejects a duplicate experience id', () => {
    const cv = validCv();
    (cv.experience as Record<string, unknown>[]).push({ ...(cv.experience as Record<string, unknown>[])[0] });
    const result = MasterCvSchema.safeParse(cv);
    expect(result.success).toBe(false);
  });
});
