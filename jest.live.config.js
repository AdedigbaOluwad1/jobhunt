/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '/test/live/.*\\.live\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', {}],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 30_000,
};
