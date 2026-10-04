// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

const grafanaConfig = require('./.config/jest.config');
const { grafanaESModules, nodeModulesToTransform } = require('./.config/jest/utils');

module.exports = {
  // Jest configuration provided by Grafana scaffolding
  ...grafanaConfig,
  moduleNameMapper: {
    ...grafanaConfig.moduleNameMapper,
    '^react-dom/server$': 'react-dom/server.node',
  },
  transformIgnorePatterns: [nodeModulesToTransform([...grafanaESModules, '@react-hookz/web', '@ver0/deep-equal'])],
};
