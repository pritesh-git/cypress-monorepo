const constants = require('./constants');
const fixtures = require('./fixtures');
const { BASE_CONFIG } = require('./config/base.config');

module.exports = {
  ...constants,
  FIXTURES: fixtures,
  BASE_CONFIG,
};