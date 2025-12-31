module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@sentinel/(.*)$': '<rootDir>/libs/$1/src'
  }
};
