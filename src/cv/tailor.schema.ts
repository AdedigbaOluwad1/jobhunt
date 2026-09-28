import { z } from 'zod';
import { MasterCv } from './cv.schema';

export const TailoredCvSchema = z.object({
  summary: z.string().max(600),
  skillGroups: z.array(
    z.object({
      group: z.string(),
      items: z.array(z.string()),
    }),
  ),
  experience: z.array(
    z.object({
      id: z.string(),
      bullets: z.array(
        z.object({
          id: z.string(),
          text: z.string(),
        }),
      ),
    }),
  ),
  projects: z.array(
    z.object({
      id: z.string(),
      bullets: z.array(
        z.object({
          id: z.string(),
          text: z.string(),
        }),
      ),
    }),
  ),
  requirementMap: z.array(
    z.object({
      requirement: z.string(),
      evidenceBulletIds: z.array(z.string()),
    }),
  ),
});

export type TailoredCv = z.infer<typeof TailoredCvSchema>;

export const TAILOR_TOOL_NAME = 'record_tailored_cv';
export const TAILOR_TOOL_DESCRIPTION = 'Record a tailored CV built only from facts in the candidate master CV provided.';

export function buildTailorSystemPrompt(maxBulletsPerRole: number): string {
  return `You tailor a candidate's CV to a specific job by selecting, ordering, and lightly rewording existing bullets from their master CV. You never invent facts.

Rules:
1. Use only facts present in the candidate's master CV given to you.
2. You may select which bullets to include, order them by relevance to the job's requirements (most relevant first), and reword a bullet to mirror the job's terminology — but only if the original bullet already supports the claim.
3. Never add numbers, percentages, technologies, employers, titles, dates, certifications, or responsibilities that are not in the original bullet text or the candidate's master skills list.
4. Include at most ${maxBulletsPerRole} bullets per role or project; drop the least relevant ones first.
5. Summary: 2-3 sentences, third person omitted (CV style, no "I"), mentioning only skills/experience the master CV supports. No numbers in the summary.
6. Skills: only include items from the candidate's master skills list (verbatim); put the groups/items most relevant to this job first.
7. Never mention the target company's name anywhere in the tailored content.
8. Reference every role and bullet by the exact id given to you — never invent a new id.
9. For requirementMap, map each key job requirement to the bullet ids that provide evidence for it (empty array if none).`;
}

export function buildTailorUserMessage(
  job: { company: string; title: string },
  extraction: { requirements: string[]; niceToHave: string[]; stack: string[]; seniority: string } | null,
  masterCv: MasterCv,
): string {
  const jobSection = [
    `Job: ${job.title} at ${job.company}`,
    extraction ? `Seniority: ${extraction.seniority}` : null,
    extraction && extraction.requirements.length ? `Key requirements: ${extraction.requirements.join('; ')}` : null,
    extraction && extraction.niceToHave.length ? `Nice to have: ${extraction.niceToHave.join('; ')}` : null,
    extraction && extraction.stack.length ? `Stack mentioned: ${extraction.stack.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const masterCvPayload = {
    summary: masterCv.summary,
    skills: masterCv.skills,
    experience: masterCv.experience.map((e) => ({
      id: e.id,
      company: e.company,
      title: e.title,
      bullets: e.bullets.map((b) => ({ id: b.id, text: b.text, tags: b.tags })),
    })),
    projects: masterCv.projects.map((p) => ({
      id: p.id,
      name: p.name,
      bullets: p.bullets.map((b) => ({ id: b.id, text: b.text, tags: b.tags })),
    })),
  };

  return `${jobSection}

Candidate's master CV (JSON):
${JSON.stringify(masterCvPayload, null, 2)}

Call ${TAILOR_TOOL_NAME} with the tailored CV.`;
}
