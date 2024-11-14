/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  resolver: 'ts-jest-resolver',
  verbose: true,
  silent: true,
  detectOpenHandles: true,
  forceExit: true,
  testTimeout: 60000,
  testEnvironment: 'node',
  collectCoverage: true,
  coverageReporters: ["json", "html"],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.[tj]sx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.test.json',
        isolatedModules: true
      },
    ],
  }
};