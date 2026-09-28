import { ConfigService } from '../src/config/config.service';
import { FilterableJob, FilterService } from '../src/jobs/filter.service';
import { makeTestConfig } from './helpers/fake-config';
import { AppConfig } from '../src/config/config.schema';

function makeFilterService(filters: Partial<AppConfig['filters']>): FilterService {
  const config = makeTestConfig({ filters: { ...makeTestConfig().filters, ...filters } });
  const configService = { load: () => config } as unknown as ConfigService;
  return new FilterService(configService);
}

function makeJob(overrides: Partial<FilterableJob> = {}): FilterableJob {
  return {
    title: 'Backend Engineer',
    location: undefined,
    remote: false,
    descriptionText: 'We build things with TypeScript.',
    postedAt: new Date(),
    ...overrides,
  };
}

describe('FilterService', () => {
  it('passes a job that matches nothing restrictive', () => {
    const service = makeFilterService({});
    expect(service.evaluate(makeJob())).toEqual({ status: 'passed', reason: null });
  });

  it('rejects a job older than maxAgeDays', () => {
    const service = makeFilterService({ maxAgeDays: 10 });
    const job = makeJob({ postedAt: new Date(Date.now() - 20 * 86_400_000) });
    expect(service.evaluate(job)).toEqual({ status: 'rejected', reason: 'max-age' });
  });

  it('keeps a job with unknown postedAt regardless of maxAgeDays', () => {
    const service = makeFilterService({ maxAgeDays: 1 });
    expect(service.evaluate(makeJob({ postedAt: undefined }))).toMatchObject({ status: 'passed' });
  });

  it('rejects on titleExclude with a word-boundary match', () => {
    const service = makeFilterService({ titleExclude: ['intern'] });
    expect(service.evaluate(makeJob({ title: 'Software Engineering Intern' }))).toEqual({
      status: 'rejected',
      reason: 'title-excluded:intern',
    });
  });

  it('does not false-positive titleExclude on a substring inside another word', () => {
    const service = makeFilterService({ titleExclude: ['intern'] });
    expect(service.evaluate(makeJob({ title: 'International Backend Engineer' }))).toMatchObject({ status: 'passed' });
  });

  it('rejects when titleInclude is set and nothing matches', () => {
    const service = makeFilterService({ titleInclude: ['frontend'] });
    expect(service.evaluate(makeJob({ title: 'Backend Engineer' }))).toEqual({
      status: 'rejected',
      reason: 'title-no-match',
    });
  });

  it('passes titleInclude with a multi-word phrase match', () => {
    const service = makeFilterService({ titleInclude: ['full stack'] });
    expect(service.evaluate(makeJob({ title: 'Full Stack Engineer' }))).toMatchObject({ status: 'passed' });
  });

  it('titleExclude takes precedence over titleInclude (evaluated first)', () => {
    const service = makeFilterService({ titleInclude: ['engineer'], titleExclude: ['intern'] });
    expect(service.evaluate(makeJob({ title: 'Engineering Intern' }))).toEqual({
      status: 'rejected',
      reason: 'title-excluded:intern',
    });
  });

  it('rejects a non-remote job when remoteOnly is set', () => {
    const service = makeFilterService({ remoteOnly: true });
    expect(service.evaluate(makeJob({ remote: false }))).toEqual({ status: 'rejected', reason: 'not-remote' });
  });

  it('passes a remote job when remoteOnly is set', () => {
    const service = makeFilterService({ remoteOnly: true });
    expect(service.evaluate(makeJob({ remote: true, location: 'Remote' }))).toMatchObject({ status: 'passed' });
  });

  it('rejects a non-remote job whose location matches no locationsAllow term', () => {
    const service = makeFilterService({ remoteOnly: false, locationsAllow: ['nigeria', 'worldwide'] });
    expect(service.evaluate(makeJob({ remote: false, location: 'Berlin, Germany' }))).toEqual({
      status: 'rejected',
      reason: 'location:Berlin, Germany',
    });
  });

  it('passes a non-remote job whose location matches a locationsAllow term', () => {
    const service = makeFilterService({ remoteOnly: false, locationsAllow: ['germany'] });
    expect(service.evaluate(makeJob({ remote: false, location: 'Berlin, Germany' }))).toMatchObject({ status: 'passed' });
  });

  it('passes a job with no location text regardless of locationsAllow', () => {
    const service = makeFilterService({ remoteOnly: false, locationsAllow: ['nigeria'] });
    expect(service.evaluate(makeJob({ remote: false, location: undefined }))).toMatchObject({ status: 'passed' });
  });

  it('does not apply locationsAllow to a remote job even with unrelated location text', () => {
    const service = makeFilterService({ remoteOnly: false, locationsAllow: ['nigeria'] });
    expect(service.evaluate(makeJob({ remote: true, location: 'San Francisco, CA' }))).toMatchObject({ status: 'passed' });
  });

  it('rejects on descriptionExclude phrase match', () => {
    const service = makeFilterService({ descriptionExclude: ['security clearance'] });
    const job = makeJob({ descriptionText: 'Must be eligible for a security clearance.' });
    expect(service.evaluate(job)).toEqual({ status: 'rejected', reason: 'description:security clearance' });
  });

  it('runs descriptionExclude last, after title and location checks pass', () => {
    const service = makeFilterService({
      titleInclude: ['engineer'],
      remoteOnly: true,
      descriptionExclude: ['clearance'],
    });
    const job = makeJob({ title: 'Backend Engineer', remote: true, descriptionText: 'Requires security clearance.' });
    expect(service.evaluate(job)).toEqual({ status: 'rejected', reason: 'description:clearance' });
  });
});
