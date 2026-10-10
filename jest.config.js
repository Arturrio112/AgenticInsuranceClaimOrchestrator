module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.mjs'],
  moduleFileExtensions: ['ts', 'js', 'mjs', 'json', 'node'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleNameMapper: {
    "^@langchain/langgraph/prebuilt$": "<rootDir>/node_modules/@langchain/langgraph/dist/prebuilt/index.cjs",
    "^@modelcontextprotocol/sdk/(.*)\\.js$": "<rootDir>/node_modules/@modelcontextprotocol/sdk/dist/cjs/$1.js"
  }
};
