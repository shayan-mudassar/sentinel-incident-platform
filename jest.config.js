module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/web/'],
  moduleNameMapper: {
    '^@sentinel/(.*)$': '<rootDir>/libs/$1/src'
  }
};
