import { MasterCv } from '../src/cv/cv.schema';
import { applyFallbacks, validateTailoredCv } from '../src/cv/tailor.validator';
import { TailoredCv } from '../src/cv/tailor.schema';

function makeMasterCv(overrides: Partial<MasterCv> = {}): MasterCv {
  return {
    basics: { name: 'Jane Doe', email: 'jane@example.com', phone: '+1', location: 'Remote', links: [] },
    summary: 'Full-stack developer with 6 years of experience shipping backend systems.',
    skills: [
      { group: 'Languages', items: ['TypeScript', 'Python'] },
      { group: 'Backend', items: ['NestJS', 'PostgreSQL', 'Redis'] },
    ],
    experience: [
      {
        id: 'exp-acme',
        company: 'Acme Ltd',
        title: 'Software Engineer',
        location: 'Remote',
        start: '2022-03',
        end: null,
        bullets: [
          { id: 'exp-acme-1', text: 'Built a queue-based pipeline with BullMQ handling 50k jobs/day.', tags: ['bullmq', 'redis'] },
          { id: 'exp-acme-2', text: 'Migrated the API from REST to GraphQL, reducing client requests.', tags: ['graphql'] },
        ],
      },
    ],
    projects: [
      {
        id: 'proj-x',
        name: 'Project X',
        url: 'https://example.com',
        bullets: [{ id: 'proj-x-1', text: 'Built a CLI tool for internal deploys used by the whole team.', tags: [] }],
      },
    ],
    education: [{ id: 'edu-1', institution: 'University', degree: 'B.Sc. CS', start: '2018', end: '2022' }],
    ...overrides,
  };
}

function makeTailoredCv(overrides: Partial<TailoredCv> = {}): TailoredCv {
  return {
    summary: 'Backend engineer experienced in building scalable pipelines and services.',
    skillGroups: [
      { group: 'Backend', items: ['NestJS', 'PostgreSQL', 'Redis'] },
      { group: 'Languages', items: ['TypeScript', 'Python'] },
    ],
    experience: [
      {
        id: 'exp-acme',
        bullets: [
          { id: 'exp-acme-1', text: 'Built a queue-based pipeline with BullMQ handling 50k jobs/day.' },
          { id: 'exp-acme-2', text: 'Migrated the API from REST to GraphQL, reducing client requests.' },
        ],
      },
    ],
    projects: [{ id: 'proj-x', bullets: [{ id: 'proj-x-1', text: 'Built a CLI tool for internal deploys used by the whole team.' }] }],
    requirementMap: [{ requirement: 'BullMQ experience', evidenceBulletIds: ['exp-acme-1'] }],
    ...overrides,
  };
}

describe('validateTailoredCv', () => {
  it('finds no violations for a faithful, unmodified tailoring', () => {
    const violations = validateTailoredCv(makeTailoredCv(), makeMasterCv());
    expect(violations).toEqual([]);
  });

  it('allows a light reword that stays within length and reuses only original facts', () => {
    const tailored = makeTailoredCv({
      experience: [
        {
          id: 'exp-acme',
          bullets: [{ id: 'exp-acme-1', text: 'Built a BullMQ-based queue pipeline processing 50k jobs/day.' }],
        },
      ],
    });
    const violations = validateTailoredCv(tailored, makeMasterCv());
    expect(violations).toEqual([]);
  });

  it('flags an invented number not present in the original bullet', () => {
    const tailored = makeTailoredCv({
      experience: [
        { id: 'exp-acme', bullets: [{ id: 'exp-acme-1', text: 'Built a queue-based pipeline with BullMQ handling 500k jobs/day.' }] },
      ],
    });
    const violations = validateTailoredCv(tailored, makeMasterCv());
    expect(violations).toContainEqual(expect.objectContaining({ scope: 'bullet', id: 'exp-acme-1', message: expect.stringContaining('500k') }));
  });

  it('flags a fabricated technology from the master vocabulary not present in the original bullet', () => {
    const tailored = makeTailoredCv({
      experience: [
        {
          id: 'exp-acme',
          bullets: [{ id: 'exp-acme-1', text: 'Built a queue-based pipeline with BullMQ and PostgreSQL handling 50k jobs/day.' }],
        },
      ],
    });
    const violations = validateTailoredCv(tailored, makeMasterCv());
    expect(violations).toContainEqual(expect.objectContaining({ scope: 'bullet', id: 'exp-acme-1', message: expect.stringContaining('PostgreSQL') }));
  });

  it('flags a suspicious invented technology not in the master vocabulary at all', () => {
    const tailored = makeTailoredCv({
      experience: [
        { id: 'exp-acme', bullets: [{ id: 'exp-acme-1', text: 'Built a queue-based pipeline with BullMQ and Kubernetes handling 50k jobs/day.' }] },
      ],
    });
    const violations = validateTailoredCv(tailored, makeMasterCv());
    expect(violations).toContainEqual(expect.objectContaining({ scope: 'bullet', id: 'exp-acme-1', message: expect.stringContaining('Kubernetes') }));
  });

  it('flags a bullet id that does not exist in the master CV', () => {
    const tailored = makeTailoredCv({
      experience: [{ id: 'exp-acme', bullets: [{ id: 'exp-acme-999', text: 'Invented bullet that was never in the master CV.' }] }],
    });
    const violations = validateTailoredCv(tailored, makeMasterCv());
    expect(violations).toContainEqual(expect.objectContaining({ scope: 'bullet', id: 'exp-acme-999', message: expect.stringContaining('does not exist') }));
  });

  it('flags a bullet referenced under the wrong role/experience id', () => {
    const tailored = makeTailoredCv({
      experience: [
        // exp-acme-1 actually belongs to exp-acme, not proj-x
        { id: 'proj-x', bullets: [{ id: 'exp-acme-1', text: 'Built a queue-based pipeline with BullMQ handling 50k jobs/day.' }] },
      ],
    });
    const violations = validateTailoredCv(tailored, makeMasterCv());
    expect(violations).toContainEqual(expect.objectContaining({ scope: 'bullet', id: 'exp-acme-1', message: expect.stringContaining('belongs to') }));
  });

  it('flags a reworded bullet more than 1.3x the original length', () => {
    const original = 'Built a queue-based pipeline with BullMQ handling 50k jobs/day.';
    const tooLong = original + ' '.repeat(1) + 'Also did many other related things across the whole team and organization over multiple years.';
    const tailored = makeTailoredCv({ experience: [{ id: 'exp-acme', bullets: [{ id: 'exp-acme-1', text: tooLong }] }] });
    const violations = validateTailoredCv(tailored, makeMasterCv());
    expect(violations).toContainEqual(expect.objectContaining({ scope: 'bullet', id: 'exp-acme-1', message: expect.stringContaining('1.3x') }));
  });

  it('flags a skill not present in the master skills list', () => {
    const tailored = makeTailoredCv({ skillGroups: [{ group: 'Backend', items: ['NestJS', 'Kafka'] }] });
    const violations = validateTailoredCv(tailored, makeMasterCv());
    expect(violations).toContainEqual(expect.objectContaining({ scope: 'skills', message: expect.stringContaining('Kafka') }));
  });

  it('flags a number in the summary', () => {
    const tailored = makeTailoredCv({ summary: 'Backend engineer who cut latency by 40% across services.' });
    const violations = validateTailoredCv(tailored, makeMasterCv());
    expect(violations).toContainEqual(expect.objectContaining({ scope: 'summary', message: expect.stringContaining('40%') }));
  });

  it('flags a technology in the summary that is not in the master vocabulary', () => {
    const tailored = makeTailoredCv({ summary: 'Backend engineer experienced with Kubernetes and distributed systems.' });
    const violations = validateTailoredCv(tailored, makeMasterCv());
    expect(violations).toContainEqual(expect.objectContaining({ scope: 'summary', message: expect.stringContaining('Kubernetes') }));
  });

  it('does not flag master-vocabulary terms that already appear in the summary context legitimately', () => {
    const tailored = makeTailoredCv({ summary: 'Backend engineer experienced with TypeScript and PostgreSQL.' });
    const violations = validateTailoredCv(tailored, makeMasterCv());
    expect(violations.filter((v) => v.scope === 'summary')).toEqual([]);
  });
});

describe('applyFallbacks', () => {
  it('reverts only the offending bullet to its original master text', () => {
    const masterCv = makeMasterCv();
    const tailored = makeTailoredCv({
      experience: [
        {
          id: 'exp-acme',
          bullets: [
            { id: 'exp-acme-1', text: 'Built a queue-based pipeline with BullMQ handling 500k jobs/day.' },
            { id: 'exp-acme-2', text: 'Migrated the API from REST to GraphQL, reducing client requests.' },
          ],
        },
      ],
    });
    const violations = validateTailoredCv(tailored, masterCv);
    const fixed = applyFallbacks(tailored, masterCv, violations);

    expect(fixed.experience[0].bullets[0].text).toBe(masterCv.experience[0].bullets[0].text);
    // the untouched, valid bullet is left exactly as the model wrote it
    expect(fixed.experience[0].bullets[1].text).toBe('Migrated the API from REST to GraphQL, reducing client requests.');
    expect(validateTailoredCv(fixed, masterCv)).toEqual([]);
  });

  it('drops only the offending skill item, keeping valid ones', () => {
    const masterCv = makeMasterCv();
    const tailored = makeTailoredCv({ skillGroups: [{ group: 'Backend', items: ['NestJS', 'Kafka'] }] });
    const violations = validateTailoredCv(tailored, masterCv);
    const fixed = applyFallbacks(tailored, masterCv, violations);

    expect(fixed.skillGroups).toEqual([{ group: 'Backend', items: ['NestJS'] }]);
  });

  it('falls back the summary to the master CV default when it still violates', () => {
    const masterCv = makeMasterCv();
    const tailored = makeTailoredCv({ summary: 'Backend engineer who cut latency by 40%.' });
    const violations = validateTailoredCv(tailored, masterCv);
    const fixed = applyFallbacks(tailored, masterCv, violations);

    expect(fixed.summary).toBe(masterCv.summary.trim());
  });

  it('leaves a fully valid tailoring completely untouched', () => {
    const masterCv = makeMasterCv();
    const tailored = makeTailoredCv();
    const fixed = applyFallbacks(tailored, masterCv, []);
    expect(fixed).toEqual(tailored);
  });
});
