'use strict';

// Helper for expo modules awaiting a real Linux backend. Each stub
// shim calls into here and exports the resulting Proxy. The Proxy's
// import succeeds (so apps that conditionally use the module don't
// crash at load time), but any property access OR call throws with
// a consistent "not yet implemented" message pointing at the TODO.
//
// As each module's real implementation lands, replace the stub
// file's body with the real shim — no wiring changes needed.

module.exports = function unimplemented(name) {
  const err = () => {
    throw new Error(
      name +
        ': not yet implemented on react-native-linux. ' +
        'See TODO.md "Expo module backlog" for the planned Linux backend.',
    );
  };
  // Need the underlying target to be callable so `new X()` and X()
  // both reach our throw — Proxy's apply trap requires a function
  // target. The handler also covers `get` so destructured imports
  // (`const {x} = require(...)`) blow up the same way.
  const target = function unimplementedStub() {
    err();
  };
  return new Proxy(target, {
    get(_obj, prop) {
      // Allow a couple of well-known introspection accesses without
      // throwing — keeps debuggers, util.inspect, and React's "is
      // this a component?" probes from spuriously erroring.
      if (
        prop === 'then' ||
        prop === Symbol.toPrimitive ||
        prop === Symbol.toStringTag ||
        prop === Symbol.iterator ||
        prop === '__rnLinuxUnimplemented' ||
        prop === '__esModule'
      ) {
        return undefined;
      }
      err();
    },
    apply: err,
    construct: err,
  });
};
