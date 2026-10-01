import { AppConfig } from '../../src/config/config.schema';

export function makeTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    profile: {
      summary: 'Full-stack developer.',
      yearsExperience: 5,
      targetTitles: ['software engineer'],
      mustHaveSkills: ['typescript'],
      dealbreakers: [],
    },
    sources: {
      greenhouse: [],
      lever: [],
      lever_eu: [],
      ashby: [],
      workable: [],
      recruitee: [],
      bamboohr: [],
      teamtailor: [],
      breezy: [],
      smartrecruiters: [],
      jazzhr: [],
    },
    filters: {
      titleInclude: [],
      titleExclude: [],
      remoteOnly: false,
      locationsAllow: [],
      descriptionExclude: [],
      maxAgeDays: 30,
    },
    llm: {
      extractionModel: 'anthropic/claude-haiku-4-5-20251001',
      tailorModel: 'anthropic/claude-sonnet-5',
      maxDescriptionChars: 12000,
      extractionConcurrency: 3,
    },
    sync: {
      httpConcurrency: 5,
      httpTimeoutMs: 15000,
      httpRetries: 2,
      maxExtractPerRun: 50,
      minScoreToHighlight: 70,
    },
    cv: {
      maxPages: 1,
      maxBulletsPerRole: 5,
      paper: 'A4',
    },
    ...overrides,
  };
}
