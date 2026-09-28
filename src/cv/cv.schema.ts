import { z } from 'zod';

const LinkSchema = z.object({ label: z.string(), url: z.string() }).strict();

const BasicsSchema = z
  .object({
    name: z.string(),
    email: z.string(),
    phone: z.string(),
    location: z.string(),
    links: z.array(LinkSchema).default([]),
  })
  .strict();

const SkillGroupSchema = z.object({ group: z.string(), items: z.array(z.string()) }).strict();

const BulletSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    tags: z.array(z.string()).default([]),
  })
  .strict();

const ExperienceSchema = z
  .object({
    id: z.string(),
    company: z.string(),
    title: z.string(),
    location: z.string().optional(),
    start: z.string(),
    end: z.string().nullable(),
    bullets: z.array(BulletSchema),
  })
  .strict();

const ProjectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    url: z.string().optional(),
    bullets: z.array(BulletSchema),
  })
  .strict();

const EducationSchema = z
  .object({
    id: z.string(),
    institution: z.string(),
    degree: z.string(),
    start: z.string(),
    end: z.string(),
  })
  .strict();

export const MasterCvSchema = z
  .object({
    basics: BasicsSchema,
    summary: z.string(),
    skills: z.array(SkillGroupSchema),
    experience: z.array(ExperienceSchema),
    projects: z.array(ProjectSchema).default([]),
    education: z.array(EducationSchema).default([]),
  })
  .strict()
  .refine(
    (cv) => {
      const ids = [
        ...cv.experience.map((e) => e.id),
        ...cv.projects.map((p) => p.id),
        ...cv.education.map((e) => e.id),
        ...cv.experience.flatMap((e) => e.bullets.map((b) => b.id)),
        ...cv.projects.flatMap((p) => p.bullets.map((b) => b.id)),
      ];
      return new Set(ids).size === ids.length;
    },
    { message: 'every experience/project/education entry and every bullet must have a unique id' },
  );

export type MasterCv = z.infer<typeof MasterCvSchema>;
export type Bullet = z.infer<typeof BulletSchema>;

export function formatMasterCvError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  return `master-cv.yaml is invalid:\n${lines.join('\n')}`;
}
