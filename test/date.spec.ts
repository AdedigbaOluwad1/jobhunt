import { isoWeekKey } from '../src/common/date';

describe('isoWeekKey', () => {
  it('matches known ISO week reference dates', () => {
    expect(isoWeekKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
    expect(isoWeekKey(new Date('2025-12-29T00:00:00Z'))).toBe('2026-W01');
    expect(isoWeekKey(new Date('2020-12-31T00:00:00Z'))).toBe('2020-W53');
    expect(isoWeekKey(new Date('2019-12-30T00:00:00Z'))).toBe('2020-W01');
  });

  it('gives the same key for every day in the same ISO week', () => {
    const monday = isoWeekKey(new Date('2026-09-21T00:00:00Z'));
    const sunday = isoWeekKey(new Date('2026-09-27T23:00:00Z'));
    expect(monday).toBe(sunday);
  });
});
