import { z } from 'zod';

/** Bump whenever this schema or the extraction prompt changes — invalidates all cached extractions. */
export const EXTRACTION_PROMPT_VERSION = 'extraction-v1';

export const ExtractionSchema = z.object({
  roleSummary: z.string().max(400),
  requirements: z.array(z.string()).max(25),
  niceToHave: z.array(z.string()).max(15),
  stack: z.array(z.string()).max(30),
  seniority: z.enum(['intern', 'junior', 'mid', 'senior', 'staff', 'lead', 'unknown']),
  yearsExperienceMin: z.number().int().min(0).max(30).nullable(),
  remotePolicy: z.enum(['remote', 'hybrid', 'onsite', 'unknown']),
  locationRestriction: z.string().nullable(),
  matchScore: z.number().int().min(0).max(100),
  matchReasons: z.array(z.string()).max(6),
  gaps: z.array(z.string()).max(8),
  redFlags: z.array(z.string()).max(6),
});

export type ExtractionResult = z.infer<typeof ExtractionSchema>;

export const EXTRACTION_TOOL_NAME = 'record_job_analysis';
export const EXTRACTION_TOOL_DESCRIPTION =
  'Record structured requirements extracted from a job posting and a match score against the owner profile.';

interface ExtractionProfile {
  summary: string;
  yearsExperience: number;
  targetTitles: string[];
  mustHaveSkills: string[];
  dealbreakers: string[];
}

export function buildExtractionSystemPrompt(profile: ExtractionProfile): string {
  return `You extract structured requirements from a job posting and score how well it matches the owner's profile.

Owner profile:
- Summary: ${profile.summary.trim()}
- Years of experience: ${profile.yearsExperience}
- Target titles: ${profile.targetTitles.join(', ') || '(none specified)'}
- Must-have skills: ${profile.mustHaveSkills.join(', ') || '(none specified)'}
- Dealbreakers: ${profile.dealbreakers.join(', ') || '(none specified)'}

Base every judgment only on the posting text below. Do not invent requirements, technologies, or numbers that the text does not state or clearly imply.

Scoring rubric — start at 50 and adjust from there:
- +up to 30 for overlap between the posting's required stack/skills and the owner's profile.
- +up to 10 for seniority / years-of-experience fit.
- +up to 10 for remote/location fit.
- -up to 40 for any dealbreaker match or a hard location restriction the owner cannot satisfy.
- -up to 20 for a large required-experience gap.
Clamp the final score to 0-100. Be conservative: reserve 85+ for near-perfect fits.`;
}

export function buildExtractionUserMessage(
  job: { company: string; title: string; location?: string | null; descriptionText: string },
  maxDescriptionChars: number,
): string {
  const description =
    job.descriptionText.length > maxDescriptionChars
      ? `${job.descriptionText.slice(0, maxDescriptionChars)}…`
      : job.descriptionText;

  return `Company: ${job.company}
Title: ${job.title}
Location: ${job.location ?? '(not specified)'}

Description:
${description}`;
}
