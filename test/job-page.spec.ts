import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalizeUrl, parseJobPage } from '../src/jobs/job-page';

const readFixture = (file: string) => fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8');

describe('parseJobPage', () => {
  it('reads a schema.org JobPosting from JSON-LD', () => {
    const parsed = parseJobPage(readFixture('jazzhr-palmpay-detail.html'));

    expect(parsed.title).toBe('Field Verification Officer');
    expect(parsed.company).toBe('PALMPAY LIMITED');
    expect(parsed.location).toBe('Ukum, Ore, Benue, Ondo');
    expect(parsed.employmentType).toBe('FULL_TIME');
    expect(parsed.postedAt).toEqual(new Date('2026-09-01'));
    expect(parsed.descriptionHtml).toContain('on-site');
  });

  it('finds a JobPosting nested in @graph and detects telecommute roles', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@graph': [
        { '@type': 'WebSite', name: 'Acme' },
        {
          '@type': ['JobPosting'],
          title: 'Backend Engineer',
          description: '<p>Build things</p>',
          hiringOrganization: { name: 'Acme' },
          jobLocationType: 'TELECOMMUTE',
          jobLocation: [
            { address: { addressLocality: 'Lagos', addressCountry: { name: 'Nigeria' } } },
            { address: 'Accra, Ghana' },
          ],
        },
      ],
    })}</script>`;

    const parsed = parseJobPage(html);

    expect(parsed.title).toBe('Backend Engineer');
    expect(parsed.company).toBe('Acme');
    expect(parsed.remote).toBe(true);
    expect(parsed.location).toBe('Lagos, Nigeria / Accra, Ghana');
  });

  it('ignores malformed JSON-LD and falls back to meta tags and page text', () => {
    const html = `<html><head>
      <script type="application/ld+json">{ not json</script>
      <meta property="og:title" content="Platform Engineer &amp; SRE">
      <meta content="Opay" property="og:site_name">
      </head><body><nav>Menu Home</nav><main><h1>Platform Engineer</h1><p>Own our infrastructure.</p></main>
      <footer>Copyright</footer></body></html>`;

    const parsed = parseJobPage(html);

    expect(parsed.title).toBe('Platform Engineer & SRE');
    expect(parsed.company).toBe('Opay');
    expect(parsed.descriptionText).toContain('Own our infrastructure.');
    expect(parsed.descriptionText).not.toContain('Menu Home');
    expect(parsed.descriptionText).not.toContain('Copyright');
  });

  it('falls back to the first heading when there is no og:title', () => {
    expect(parseJobPage('<body><h1> Data <b>Engineer</b> </h1></body>').title).toBe('Data Engineer');
  });
});

describe('canonicalizeUrl', () => {
  it('drops fragments, tracking params and trailing slashes but keeps meaningful params', () => {
    const url = canonicalizeUrl('https://careers.example.com/jobs/123/?utm_source=x&gh_jid=99&fbclid=abc#apply');

    expect(url.href).toBe('https://careers.example.com/jobs/123?gh_jid=99');
  });

  it('rejects non-http URLs and garbage', () => {
    expect(() => canonicalizeUrl('not a url')).toThrow(/not a valid URL/);
    expect(() => canonicalizeUrl('ftp://example.com/job')).toThrow(/http/);
  });
});
