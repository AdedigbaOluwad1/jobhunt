import { isValidStatus, STATUS_VALUES } from '../src/jobs/status';

describe('isValidStatus', () => {
  it('accepts every documented status value', () => {
    for (const status of STATUS_VALUES) {
      expect(isValidStatus(status)).toBe(true);
    }
  });

  it('rejects an unknown status', () => {
    expect(isValidStatus('archived')).toBe(false);
    expect(isValidStatus('')).toBe(false);
  });
});
