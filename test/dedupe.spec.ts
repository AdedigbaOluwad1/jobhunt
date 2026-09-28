import { resolveDuplicate } from '../src/jobs/dedupe';

describe('resolveDuplicate', () => {
  it('marks nothing as duplicate when there is no existing match', () => {
    const result = resolveDuplicate({ source: 'greenhouse' }, null);
    expect(result).toEqual({ newJobDuplicateOfId: null, swapExistingId: null });
  });

  it('marks the new job as a duplicate when both sources are the same type (ATS)', () => {
    const result = resolveDuplicate({ source: 'lever' }, { id: 7, source: 'greenhouse' });
    expect(result).toEqual({ newJobDuplicateOfId: 7, swapExistingId: null });
  });

  it('marks the new job as a duplicate when both sources are remote boards', () => {
    const result = resolveDuplicate({ source: 'remoteok' }, { id: 7, source: 'remotive' });
    expect(result).toEqual({ newJobDuplicateOfId: 7, swapExistingId: null });
  });

  it('lets a new ATS job win over an existing remote-board entry', () => {
    const result = resolveDuplicate({ source: 'greenhouse' }, { id: 7, source: 'remotive' });
    expect(result).toEqual({ newJobDuplicateOfId: null, swapExistingId: 7 });
  });

  it('keeps an existing ATS job canonical over a new remote-board entry', () => {
    const result = resolveDuplicate({ source: 'remotive' }, { id: 7, source: 'greenhouse' });
    expect(result).toEqual({ newJobDuplicateOfId: 7, swapExistingId: null });
  });
});
