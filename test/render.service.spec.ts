import { PDFParse } from 'pdf-parse';
import { MasterCv } from '../src/cv/cv.schema';
import { renderCvHtml } from '../src/cv/cv-template';
import { RenderService } from '../src/cv/render.service';
import { TailoredCv } from '../src/cv/tailor.schema';

function makeMasterCv(bulletCount: number): MasterCv {
  return {
    basics: { name: 'Jane Doe', email: 'jane@example.com', phone: '+1 555-0100', location: 'Remote', links: [] },
    summary: 'Backend engineer with a focus on distributed systems and developer tooling.',
    skills: [{ group: 'Backend', items: ['TypeScript', 'NestJS', 'PostgreSQL'] }],
    experience: [
      {
        id: 'exp-1',
        company: 'Acme Ltd',
        title: 'Senior Backend Engineer',
        location: 'Remote',
        start: '2020-01',
        end: null,
        bullets: Array.from({ length: bulletCount }, (_, i) => ({
          id: `exp-1-${i}`,
          text: `Owned a significant backend initiative number ${i}, improving reliability and shipping velocity for the team across multiple quarters.`,
          tags: [],
        })),
      },
    ],
    projects: [],
    education: [{ id: 'edu-1', institution: 'State University', degree: 'B.Sc. Computer Science', start: '2016', end: '2020' }],
  };
}

function makeTailoredCv(masterCv: MasterCv): TailoredCv {
  return {
    summary: 'Backend engineer with a focus on distributed systems and developer tooling.',
    skillGroups: masterCv.skills,
    experience: [{ id: 'exp-1', bullets: masterCv.experience[0].bullets.map((b) => ({ id: b.id, text: b.text })) }],
    projects: [],
    requirementMap: [],
  };
}

describe('RenderService', () => {
  const renderService = new RenderService();

  afterAll(async () => {
    await renderService.onModuleDestroy();
  });

  it('renders a real, text-selectable PDF whose content matches the tailored CV', async () => {
    const masterCv = makeMasterCv(3);
    const tailoredCv = makeTailoredCv(masterCv);
    const html = renderCvHtml(masterCv, tailoredCv);

    const pdf = await renderService.renderPdf(html, 'A4');
    expect(pdf.length).toBeGreaterThan(500);

    const parser = new PDFParse({ data: pdf });
    const result = await parser.getText();
    await parser.destroy();

    expect(result.text).toContain('Jane Doe');
    expect(result.text).toContain('Senior Backend Engineer');
    expect(result.text).toContain('Owned a significant backend initiative number 0');
    expect(result.text).toContain('State University');
  }, 20_000);

  it('counts pages that match what a real PDF viewer would show', async () => {
    const shortCv = makeMasterCv(2);
    const shortHtml = renderCvHtml(shortCv, makeTailoredCv(shortCv));
    const shortPdf = await renderService.renderPdf(shortHtml, 'A4');
    expect(renderService.countPages(shortPdf)).toBe(1);

    const longCv = makeMasterCv(40);
    const longHtml = renderCvHtml(longCv, makeTailoredCv(longCv));
    const longPdf = await renderService.renderPdf(longHtml, 'A4');
    const parser = new PDFParse({ data: longPdf });
    const result = await parser.getText();
    await parser.destroy();

    expect(renderService.countPages(longPdf)).toBe(result.pages.length);
    expect(renderService.countPages(longPdf)).toBeGreaterThan(1);
  }, 20_000);
});
