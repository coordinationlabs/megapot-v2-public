const mocha = {
  timeout: 300000,
};

// Allow CI to filter tests via env vars when running solidity-coverage
if (process.env.COVERAGE_GREP) {
  mocha.grep = process.env.COVERAGE_GREP;
}
if (process.env.COVERAGE_INVERT === 'true' || process.env.COVERAGE_INVERT === '1') {
  mocha.invert = true;
}

module.exports = {
  skipFiles: ['interfaces', 'mocks', 'external'],
  configureYulOptimizer: true,
  mocha,
};
