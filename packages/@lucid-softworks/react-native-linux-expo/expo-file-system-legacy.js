'use strict';

// `expo-file-system/legacy` re-export. expo 54 split the package into
// a new file-handle API at `expo-file-system` and the old URI-based
// API at `expo-file-system/legacy`. Our shim already implements the
// legacy API surface (readAsStringAsync, writeAsStringAsync,
// downloadAsync, etc.) — apps importing from the /legacy subpath
// land here.

module.exports = require('./expo-file-system');
module.exports.default = module.exports;
