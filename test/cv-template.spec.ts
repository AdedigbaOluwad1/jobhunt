import { MasterCv } from '../src/cv/cv.schema';
import { renderCvHtml } from '../src/cv/cv-template';
import { TailoredCv } from '../src/cv/tailor.schema';

function makeMasterCv(): MasterCv {
  return {
    basics: {
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+1 555-0100',
      location: 'Remote',
      links: [{ label: 'GitHub', url: 'https://github.com/janedoe' }],
    },
    summary: 'Default summary.',
    skills: [
      { group: 'Languages', items: ['TypeScript', 'Python'] },
      { group: 'Backend', items: ['NestJS'] },
    ],
    experience: [
      {
        id: 'exp-1',
        company: 'Acme & Co <Ltd>',
        title: 'Senior Engineer',
        location: 'Remote',
        start: '2022-03',
        end: null,
        bullets: [
          { id: 'exp-1-1', text: 'Shipped a pipeline handling 50k jobs/day.', tags: [] },
          { id: 'exp-1-2', text: 'Bullet that gets dropped by tailoring.', tags: [] },
        ],
      },
    ],
    projects: [{ id: 'proj-1', name: 'Side Project', url: 'https://example.com', bullets: [{ id: 'proj-1-1', text: 'Built a tool.', tags: [] }] }],
    education: [{ id: 'edu-1', institution: 'State University', degree: 'B.Sc. Computer Science', start: '2018', end: '2022' }],
  };
}

function makeTailoredCv(): TailoredCv {
  return {
    summary: 'Backend engineer focused on scalable pipelines.',
    skillGroups: [{ group: 'Backend', items: ['NestJS'] }],
    experience: [{ id: 'exp-1', bullets: [{ id: 'exp-1-1', text: 'Shipped a pipeline handling 50k jobs/day.' }] }],
    projects: [{ id: 'proj-1', bullets: [{ id: 'proj-1-1', text: 'Built a tool.' }] }],
    requirementMap: [],
  };
}

describe('renderCvHtml', () => {
  it('produces a single-column layout with no tables, images, or icon markup', () => {
    const html = renderCvHtml(makeMasterCv(), makeTailoredCv());
    expect(html).not.toMatch(/<table/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<header/i);
    expect(html).not.toMatch(/<footer/i);
    expect(html).not.toMatch(/font-family:.*(FontAwesome|icon)/i);
  });

  it('copies basics, dates, company, and education from the master CV verbatim (not from the model)', () => {
    const html = renderCvHtml(makeMasterCv(), makeTailoredCv());
    expect(html).toContain('Jane Doe');
    expect(html).toContain('jane@example.com');
    expect(html).toContain('Senior Engineer');
    expect(html).toContain('2022-03');
    expect(html).toContain('State University');
    expect(html).toContain('B.Sc. Computer Science');
  });

  it('only renders bullets present in the tailored CV, dropping the rest', () => {
    const html = renderCvHtml(makeMasterCv(), makeTailoredCv());
    expect(html).toContain('Shipped a pipeline handling 50k jobs/day.');
    expect(html).not.toContain('Bullet that gets dropped by tailoring.');
  });

  it('HTML-escapes special characters instead of injecting raw markup', () => {
    const html = renderCvHtml(makeMasterCv(), makeTailoredCv());
    expect(html).toContain('Acme &amp; Co &lt;Ltd&gt;');
    expect(html).not.toContain('Acme & Co <Ltd>');
  });

  it('omits a role entirely when tailoring drops all of its bullets', () => {
    const tailored = makeTailoredCv();
    tailored.projects = [{ id: 'proj-1', bullets: [] }];
    const html = renderCvHtml(makeMasterCv(), tailored);
    expect(html).not.toContain('Side Project');
  });
});
