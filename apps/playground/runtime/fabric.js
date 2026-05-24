'use strict';

// Minimal Fabric driver. RN's SurfaceRegistryBinding::startSurface (the
// JSI hook our C++ host fires when surface.start() runs) expects
// `globalThis.RN$AppRegistry.runApplication(moduleName, params,
// displayMode)` to exist. The real RN ships ReactFabric inside that
// callback; we hand-roll a tiny tree that exercises Fabric end-to-end
// (Scheduler diff → SchedulerDelegate → MountingManager → GTK widgets).
//
// Once this works, the same hook becomes the integration point for the
// real ReactFabric renderer (or our own React-host config that emits
// nativeFabricUIManager calls).

let nextTag = 1000;
function tag() {
  return ++nextTag;
}

function runApplication(moduleName, parameters, _displayMode) {
  const fabric = globalThis.nativeFabricUIManager;
  if (!fabric) {
    rnLinux.log('error', 'RN$AppRegistry.runApplication: no nativeFabricUIManager');
    return;
  }
  rnLinux.log('info', 'RN$AppRegistry.runApplication called for ' + moduleName);

  const surfaceId = parameters.rootTag;

  // Build a tree of Views + Paragraphs. Notes:
  //   • `collapsable: false` keeps Fabric from flattening Views that
  //     have no measured children (otherwise the layout pass merges
  //     them away and only the inner Paragraphs survive as siblings
  //     of root).
  //   • Explicit width/height because our cxx TextLayoutManager is a
  //     stub that returns zero measurements — Paragraphs would otherwise
  //     come out 0 tall.
  const banner = fabric.createNode(
    tag(), 'View', surfaceId,
    {
      backgroundColor: 0xff3b82f6,     // ARGB int — bypass color parser quirks
      width: 800, height: 80,
      top: 40, left: 40,
      position: 'absolute',
      collapsable: false,
    },
    {},
  );
  const bannerText = fabric.createNode(
    tag(), 'Paragraph', surfaceId,
    {
      text: 'Hello from Fabric!',
      width: 760, height: 40,
      top: 20, left: 20,
      position: 'absolute',
      collapsable: false,
    },
    {},
  );
  fabric.appendChild(banner, bannerText);

  const sub = fabric.createNode(
    tag(), 'View', surfaceId,
    {
      backgroundColor: 0xfff97316,
      width: 800, height: 80,
      top: 140, left: 40,
      position: 'absolute',
      collapsable: false,
    },
    {},
  );
  const subText = fabric.createNode(
    tag(), 'Paragraph', surfaceId,
    {
      text: 'Layout via Yoga, mount via LinuxMountingManager',
      width: 760, height: 40,
      top: 20, left: 20,
      position: 'absolute',
      collapsable: false,
    },
    {},
  );
  fabric.appendChild(sub, subText);

  const childSet = fabric.createChildSet(surfaceId);
  fabric.appendChildToSet(childSet, banner);
  fabric.appendChildToSet(childSet, sub);
  fabric.completeRoot(surfaceId, childSet);
  rnLinux.log('info', 'completeRoot called for surfaceId=' + surfaceId);
}

globalThis.RN$AppRegistry = {runApplication};
rnLinux.log('info', 'RN$AppRegistry installed');
