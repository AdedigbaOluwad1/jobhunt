import { MasterCv } from './cv.schema';
import { indexMasterCv } from './master-cv-index';
import { TailoredCv } from './tailor.schema';

export interface TailorViolation {
  scope: 'bullet' | 'skills' | 'summary';
  /** bulletId, when scope === 'bullet' */
  id?: string;
  message: string;
}

const NUMBER_PATTERN = /\$?\d[\d,]*(?:\.\d+)?[kKmMbB]?%?/g;
const CAPITALIZED_TERM_PATTERN = /\b[A-Z][A-Za-z0-9+#.]*\b/g;

function extractNumberTokens(text: string): string[] {
  return text.match(NUMBER_PATTERN) ?? [];
}

/**
 * Candidate "technology name" terms — capitalized words, excluding the very
 * first word of the text. Sentence-initial capitalization ("Backend
 * engineer...") is just grammar, not a claim, and would otherwise dominate
 * false positives; a fabricated tech name is rarely the first word of a bullet.
 */
function extractCapitalizedTerms(text: string): string[] {
  const trimmed = text.trim();
  const firstWord = trimmed.split(/\s+/)[0]?.replace(/[.,!?;:]+$/, '');
  const terms = trimmed.match(CAPITALIZED_TERM_PATTERN) ?? [];
  return terms.filter((term) => term !== firstWord);
}

export function validateTailoredCv(tailored: TailoredCv, masterCv: MasterCv): TailorViolation[] {
  const index = indexMasterCv(masterCv);
  const violations: TailorViolation[] = [];

  const checkRoleGroup = (roles: TailoredCv['experience'], expectedParentKind: 'experience' | 'project') => {
    for (const role of roles) {
      for (const bullet of role.bullets) {
        const master = index.bulletById.get(bullet.id);
        if (!master) {
          violations.push({ scope: 'bullet', id: bullet.id, message: `bullet id "${bullet.id}" does not exist in the master CV` });
          continue;
        }
        if (master.parentId !== role.id || master.parentKind !== expectedParentKind) {
          violations.push({ scope: 'bullet', id: bullet.id, message: `bullet "${bullet.id}" belongs to "${master.parentId}", not "${role.id}"` });
          continue;
        }

        const originalNumbers = new Set(extractNumberTokens(master.text));
        const inventedNumbers = extractNumberTokens(bullet.text).filter((n) => !originalNumbers.has(n));
        if (inventedNumbers.length > 0) {
          violations.push({
            scope: 'bullet',
            id: bullet.id,
            message: `bullet "${bullet.id}" introduces number(s) not in the original: ${inventedNumbers.join(', ')}`,
          });
        }

        const originalTextLower = master.text.toLowerCase();
        const tagsLower = new Set(master.tags.map((t) => t.toLowerCase()));
        for (const term of extractCapitalizedTerms(bullet.text)) {
          const termLower = term.toLowerCase();
          if (originalTextLower.includes(termLower)) continue;
          if (index.vocabularyLower.has(termLower) && !tagsLower.has(termLower)) {
            violations.push({
              scope: 'bullet',
              id: bullet.id,
              message: `bullet "${bullet.id}" mentions "${term}", which is not in the original bullet or its tags`,
            });
          } else if (!index.vocabularyLower.has(termLower)) {
            violations.push({
              scope: 'bullet',
              id: bullet.id,
              message: `bullet "${bullet.id}" mentions "${term}", which appears in neither the original bullet nor the master vocabulary (suspicious)`,
            });
          }
        }

        if (bullet.text.length > master.text.length * 1.3) {
          violations.push({ scope: 'bullet', id: bullet.id, message: `bullet "${bullet.id}" is more than 1.3x the length of the original` });
        }
      }
    }
  };

  checkRoleGroup(tailored.experience, 'experience');
  checkRoleGroup(tailored.projects, 'project');

  for (const group of tailored.skillGroups) {
    for (const item of group.items) {
      if (!index.skillItemsLower.has(item.toLowerCase())) {
        violations.push({ scope: 'skills', message: `skill "${item}" is not in the master skills list` });
      }
    }
  }

  const summaryNumbers = extractNumberTokens(tailored.summary);
  if (summaryNumbers.length > 0) {
    violations.push({ scope: 'summary', message: `summary contains number(s): ${summaryNumbers.join(', ')}` });
  }
  for (const term of extractCapitalizedTerms(tailored.summary)) {
    if (!index.vocabularyLower.has(term.toLowerCase())) {
      violations.push({ scope: 'summary', message: `summary mentions "${term}", which is not in the master vocabulary` });
    }
  }

  return violations;
}

/**
 * Applies the spec's fallback rule: a bullet that still violates after one
 * retry reverts to its original master-CV text verbatim; skills not in the
 * master list are dropped; a summary that still violates falls back to the
 * master CV's own default summary.
 */
export function applyFallbacks(tailored: TailoredCv, masterCv: MasterCv, violations: TailorViolation[]): TailoredCv {
  const index = indexMasterCv(masterCv);
  const badBulletIds = new Set(violations.filter((v) => v.scope === 'bullet' && v.id).map((v) => v.id));

  const fixRoles = (roles: TailoredCv['experience']) =>
    roles.map((role) => ({
      ...role,
      bullets: role.bullets.map((bullet) => {
        if (!badBulletIds.has(bullet.id)) return bullet;
        const master = index.bulletById.get(bullet.id);
        return master ? { id: bullet.id, text: master.text } : bullet;
      }),
    }));

  const result: TailoredCv = {
    ...tailored,
    experience: fixRoles(tailored.experience),
    projects: fixRoles(tailored.projects),
  };

  if (violations.some((v) => v.scope === 'skills')) {
    result.skillGroups = tailored.skillGroups
      .map((group) => ({ ...group, items: group.items.filter((item) => index.skillItemsLower.has(item.toLowerCase())) }))
      .filter((group) => group.items.length > 0);
  }

  if (violations.some((v) => v.scope === 'summary')) {
    result.summary = masterCv.summary.trim();
  }

  return result;
}
