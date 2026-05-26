'use strict';

// Skip the playground's own JS tests through to jest's defaults but
// exclude the fetched native dependency trees — CMake's FetchContent
// drops Hermes / Folly source under linux/build/_deps/, and those
// have their own (incompatible) jest config + thousands of test
// fixtures that hijack jest --passWithNoTests if we don't bail.
module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/linux/build/'],
  passWithNoTests: true,
};
