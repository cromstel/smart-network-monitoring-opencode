/** @type {import('jest').Config} */
module.exports = {
  // Server-side by default. Files that render React opt into jsdom with a
  // `@jest-environment jsdom` docblock, which keeps one flat config (and one
  // coverage report) instead of splitting the run across projects.
  testEnvironment: 'node',
  transform: {
    // `diagnostics: false` is deliberate. tsconfig.test.json omits `paths` so
    // that Jest's moduleNameMapper is the only thing resolving `@/`; when
    // ts-jest also applies `paths` it loads each module twice on Windows and
    // the coverage reporter dies on paths like
    // `lib/services/file:\C:\...\lib/services/alertService.ts`.
    // Type safety is not lost: `tsconfig.json` includes `**/*.ts`, so
    // `npm run type-check` still type-checks every test file.
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json', diagnostics: false }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['<rootDir>/lib/**/__tests__/**/*.test.ts', '<rootDir>/**/*.test.tsx'],
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
  // The v8 provider is used instead of the default babel/istanbul one because
  // on Windows the latter records untested files under keys like
  // `lib/services/file:\C:\...\lib/services/alertService.ts`, which then makes
  // the lcov reporter throw "Path contains invalid characters". v8 emits clean
  // absolute paths and is considerably faster.
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'lib/services/**/*.ts',
    'lib/utils/**/*.ts',
    '!lib/services/scanners/asusScanner.ts',
    '!lib/utils/cn.ts',
  ],
  // PRD §7 release criteria: >=70% on lib/services and lib/utils.
  // Branches and functions are reported but not gated yet — the PRD figure
  // covers statements and lines, and gating a stricter number before the
  // suite supports it would only teach people to ignore the gate.
  coverageThreshold: {
    global: {
      statements: 70,
      lines: 70,
    },
  },
  coverageReporters: ['text-summary', 'lcov'],
}
