'use strict';

// Minimal Fabric driver. RN's SurfaceRegistryBinding::startSurface (the
// JSI hook our C++ host fires when surface.start() runs) expects
// `globalThis.RN$AppRegistry.runApplication(moduleName, params,
// displayMode)` to exist. We hand-roll a tiny tree that exercises
// Fabric end-to-end (Scheduler diff → SchedulerDelegate →
// MountingManager → GTK widgets).
//
// RN's text model:
//   <Paragraph>             (the layout root; only this one mounts a
//                            widget, in our case a GtkLabel)
//     └─ <RawText text="…"> (data-only leaf; contributes to the
//                            Paragraph's AttributedString during the
//                            commit, but never mounts a widget)
// So putting a `text` prop on the Paragraph itself is silently ignored
// — we have to spell out the RawText child to make the label have any
// actual content.

let nextTag = 1000;
function tag() {
  return ++nextTag;
}

function makeText(fabric, surfaceId, text, layout) {
  const paragraph = fabric.createNode(
    tag(), 'Paragraph', surfaceId,
    {
      ...layout,
      position: 'absolute',
      collapsable: false,
    },
    {},
  );
  const rawText = fabric.createNode(
    tag(), 'RawText', surfaceId,
    {text},
    {},
  );
  fabric.appendChild(paragraph, rawText);
  return paragraph;
}

function runApplication(moduleName, parameters, _displayMode) {
  const fabric = globalThis.nativeFabricUIManager;
  if (!fabric) {
    rnLinux.log('error', 'RN$AppRegistry.runApplication: no nativeFabricUIManager');
    return;
  }
  rnLinux.log('info', 'RN$AppRegistry.runApplication called for ' + moduleName);

  const surfaceId = parameters.rootTag;

  const heading = makeText(fabric, surfaceId,
    'Hello from Fabric!',
    {top: 80, left: 80, width: 800, height: 40});
  const body = makeText(fabric, surfaceId,
    'This text reaches the screen through the real Fabric pipeline.',
    {top: 140, left: 80, width: 800, height: 40});

  const childSet = fabric.createChildSet(surfaceId);
  fabric.appendChildToSet(childSet, heading);
  fabric.appendChildToSet(childSet, body);
  fabric.completeRoot(surfaceId, childSet);
  rnLinux.log('info', 'completeRoot called for surfaceId=' + surfaceId);
}

globalThis.RN$AppRegistry = {runApplication};
rnLinux.log('info', 'RN$AppRegistry installed');
