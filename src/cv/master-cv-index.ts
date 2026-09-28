import { Bullet, MasterCv } from './cv.schema';

export interface IndexedBullet extends Bullet {
  parentId: string;
  parentKind: 'experience' | 'project';
}

export interface MasterCvIndex {
  bulletById: Map<string, IndexedBullet>;
  experienceIds: Set<string>;
  projectIds: Set<string>;
  /** Lowercased skills.items — the strict "skills subset" check. */
  skillItemsLower: Set<string>;
  /** Lowercased skills.items + all bullet tags — what a reworded bullet's technology terms are allowed to reference. */
  vocabularyLower: Set<string>;
}

export function indexMasterCv(masterCv: MasterCv): MasterCvIndex {
  const bulletById = new Map<string, IndexedBullet>();
  const vocabularyLower = new Set<string>();

  for (const group of masterCv.skills) {
    for (const item of group.items) vocabularyLower.add(item.toLowerCase());
  }

  const indexBullets = (parentId: string, parentKind: 'experience' | 'project', bullets: Bullet[]) => {
    for (const bullet of bullets) {
      bulletById.set(bullet.id, { ...bullet, parentId, parentKind });
      for (const tag of bullet.tags) vocabularyLower.add(tag.toLowerCase());
    }
  };

  for (const exp of masterCv.experience) indexBullets(exp.id, 'experience', exp.bullets);
  for (const proj of masterCv.projects) indexBullets(proj.id, 'project', proj.bullets);

  return {
    bulletById,
    experienceIds: new Set(masterCv.experience.map((e) => e.id)),
    projectIds: new Set(masterCv.projects.map((p) => p.id)),
    skillItemsLower: new Set(masterCv.skills.flatMap((g) => g.items.map((i) => i.toLowerCase()))),
    vocabularyLower,
  };
}
