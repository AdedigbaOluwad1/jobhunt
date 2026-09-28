import { MasterCv } from './cv.schema';
import { TailoredCv } from './tailor.schema';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateRange(start: string, end: string | null): string {
  return `${start} – ${end ?? 'Present'}`;
}

/**
 * Single-column, system-fonts, no icons/tables/images: ATS parsers read this
 * shape most reliably. Basics/education/dates/titles/company names are taken
 * straight from the master CV, never from the model.
 */
export function renderCvHtml(masterCv: MasterCv, tailored: TailoredCv): string {
  const { basics, education } = masterCv;

  const bulletsById = <T extends { id: string; bullets: { id: string; text: string }[] }>(role: T) =>
    role.bullets.map((b) => `<li>${escapeHtml(b.text)}</li>`).join('');

  const experienceHtml = tailored.experience
    .map((tailoredRole) => {
      const master = masterCv.experience.find((e) => e.id === tailoredRole.id);
      if (!master || tailoredRole.bullets.length === 0) return '';
      return `
        <section class="entry">
          <div class="entry-header">
            <span class="entry-title">${escapeHtml(master.title)} — ${escapeHtml(master.company)}</span>
            <span class="entry-dates">${formatDateRange(master.start, master.end)}</span>
          </div>
          <ul>${bulletsById(tailoredRole)}</ul>
        </section>`;
    })
    .join('');

  const projectsHtml = tailored.projects
    .map((tailoredProject) => {
      const master = masterCv.projects.find((p) => p.id === tailoredProject.id);
      if (!master || tailoredProject.bullets.length === 0) return '';
      return `
        <section class="entry">
          <div class="entry-header">
            <span class="entry-title">${escapeHtml(master.name)}</span>
          </div>
          <ul>${bulletsById(tailoredProject)}</ul>
        </section>`;
    })
    .join('');

  const educationHtml = education
    .map(
      (edu) => `
        <section class="entry">
          <div class="entry-header">
            <span class="entry-title">${escapeHtml(edu.degree)} — ${escapeHtml(edu.institution)}</span>
            <span class="entry-dates">${formatDateRange(edu.start, edu.end)}</span>
          </div>
        </section>`,
    )
    .join('');

  const skillsHtml = tailored.skillGroups
    .map((group) => `<div class="skill-group"><strong>${escapeHtml(group.group)}:</strong> ${escapeHtml(group.items.join(', '))}</div>`)
    .join('');

  const linksHtml = basics.links.map((link) => `<span>${escapeHtml(link.label)}: ${escapeHtml(link.url)}</span>`).join(' · ');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; font-size: 10.5pt; line-height: 1.4; margin: 0; }
  h1 { font-size: 18pt; margin: 0 0 2pt 0; }
  .contact { font-size: 9pt; color: #444; margin-bottom: 10pt; }
  .summary { margin-bottom: 12pt; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.5pt; border-bottom: 1px solid #999; margin: 14pt 0 6pt 0; padding-bottom: 2pt; }
  .entry { margin-bottom: 8pt; }
  .entry-header { display: flex; justify-content: space-between; font-weight: bold; }
  .entry-dates { font-weight: normal; color: #444; }
  ul { margin: 4pt 0 0 16pt; padding: 0; }
  li { margin-bottom: 2pt; }
  .skill-group { margin-bottom: 3pt; }
</style>
</head>
<body>
  <h1>${escapeHtml(basics.name)}</h1>
  <div class="contact">${escapeHtml(basics.email)} · ${escapeHtml(basics.phone)} · ${escapeHtml(basics.location)}${linksHtml ? ` · ${linksHtml}` : ''}</div>
  <div class="summary">${escapeHtml(tailored.summary)}</div>

  ${skillsHtml ? `<h2>Skills</h2>${skillsHtml}` : ''}
  ${experienceHtml ? `<h2>Experience</h2>${experienceHtml}` : ''}
  ${projectsHtml ? `<h2>Projects</h2>${projectsHtml}` : ''}
  ${educationHtml ? `<h2>Education</h2>${educationHtml}` : ''}
</body>
</html>`;
}
