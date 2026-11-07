/** Unit tests cover the pure domain logic (no React Native runtime needed). */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { strict: true, esModuleInterop: true, module: 'commonjs', target: 'es2020', types: ['jest', 'node'], isolatedModules: true, rootDir: '.' } }],
  },
};
