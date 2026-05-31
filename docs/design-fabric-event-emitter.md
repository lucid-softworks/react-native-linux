# Migration: ad-hoc tag registry → real Fabric EventEmitter

## Status

Designed; partial implementation attempted and reverted (see "Wiring gap"
below). Picking this back up is the canonical task #6 in the
prod-readiness punch list.

## What we have today

Every native event currently flows through a tag-keyed JSI registry:

1. C++ component view (e.g. `ViewComponentView`) wires a GTK signal
   (e.g. `GtkGestureClick::released`) to a free function that calls
   `dispatchFabricClick(tag)`.
2. `dispatchFabricClick` (in `vnext/src/jsi/RnLinuxBindings.cpp`) looks
   up `state().fabricClickHandlers[tag]` and invokes the stored
   `jsi::Function`.
3. JS-side: `apps/playground/runtime/fabricHostConfig.js` calls
   `rnLinux.fabricOnClick(tag, () => onClick(makeSyntheticEvent('press')))`
   from `syncClickHandler` during `createInstance`/`cloneInstance`.

Same shape for `dispatchFabricChangeText`, `dispatchFabricSubmitEditing`,
`dispatchFabricKeyPress`, `dispatchFabricScroll`, `dispatchFabricFocus`,
`dispatchFabricBlur`, `dispatchFabricLayout`, `dispatchFabricLongPress`,
`dispatchFabricHoverIn`, `dispatchFabricHoverOut`, `dispatchFabricSwitchChange`.

This works for single-handler-per-tag cases but doesn't flow through
React's event-responder system: a child's `onPress` doesn't bubble to
the parent's handler, `e.stopPropagation()` has no effect, and the
gesture-responder negotiation iOS/Android rely on isn't available.

## How react-native-windows / react-native-macos solve this

Both use the upstream Fabric pipeline unmodified:

- Each component view stores a `std::shared_ptr<EventEmitter const>`
  (already true on our side — see `LinuxComponentView::eventEmitter_`).
- Native event handlers call typed methods on the emitter
  (`emitter->onClick(payload)` etc., or the generic
  `emitter->dispatchEvent(name, payload)`).
- `EventEmitter::dispatchEvent` queues a `RawEvent` via
  `EventDispatcher`.
- `EventQueue::onEnqueue` calls `eventBeat_->request()`.
- A platform-specific `EventBeat` flushes by calling `induce()` at a
  frame boundary:
  - RNW: `MainThreadEventBeat` posts to `Dispatcher.RunAsync` (the
    UI-thread dispatcher).
  - RN-macOS: a run-loop observer fires `induce()` before the main
    `CFRunLoop` sleeps.
- `induce()` schedules a beat callback on the JS thread via
  `RuntimeScheduler::scheduleWork`. The beat calls `EventQueue::onBeat`,
  which calls `flushEvents` → `EventQueueProcessor::flushEvents` →
  the eventPipe wired by `Scheduler.cpp`, which terminates in
  `UIManagerBinding::dispatchEvent`.
- `UIManagerBinding::dispatchEvent` calls the JS `eventHandler_` that
  was registered via `nativeFabricUIManager.registerEventHandler(fn)`.
- The JS handler walks the React fiber tree from `instanceHandle`,
  finding the first ancestor with a matching `on<Name>` prop and
  invoking it.

## Plan

Land in three independent commits.

### Phase 1: real EventBeat + JS event handler

- New `vnext/src/fabric/IdleEventBeat.{h,cpp}`. Subclass of
  `facebook::react::EventBeat`. Override `request()` to schedule
  `induce()` via `g_idle_add_full(G_PRIORITY_HIGH_IDLE, …)` on the GTK
  main loop. Coalesce so a burst of `request()` enqueues a single idle.
- `RNLinuxHost::start` swaps `NoopEventBeat` for `IdleEventBeat` in
  the `SchedulerToolbox::eventBeatFactory`.
- JS side: `apps/playground/runtime/fabric.js` calls
  `nativeFabricUIManager.registerEventHandler(dispatchFabricEvent)`
  before the first surface mount. The handler:
  - Maps event name → prop name (`topClick` / `click` → `onClick`,
    `topSubmitEditing` / `submitEditing` → `onSubmitEditing`, etc.).
  - Builds a synthetic event compatible with what userland already
    sees from the tag-registry path (`{nativeEvent, target,
currentTarget, preventDefault, stopPropagation, persist, …}`).
  - Walks `fiber.return` looking for `fiber.memoizedProps[propName]`
    (fall back to `pendingProps`); invokes the first match and stops.

This phase changes no observable behavior — `eventEmitter_->dispatchEvent`
isn't called from anywhere yet, so the JS handler stays inert.

### Phase 2: migrate `click`

- `ViewComponentView`'s gesture handler stops calling
  `dispatchFabricClick(tag)`. Instead it captures `this`, looks up
  `eventEmitter_`, and calls
  `eventEmitter_->dispatchEvent("click", folly::dynamic::object("locationX", x)("locationY", y))`.
- `fabricHostConfig.js` drops `syncClickHandler` from `createInstance`
  - `cloneInstance` (the new JS handler picks `props.onClick` straight
    out of `memoizedProps`).
- `RnLinuxBindings.cpp` keeps `dispatchFabricClick` + `fabricOnClick`
  as dead code that other paths might still use; remove once all
  events are migrated.

### Phase 3: migrate the rest

In rough complexity order: `longPress`, `hoverIn`/`hoverOut`, `focus`/`blur`,
`submitEditing`, `keyPress`, `changeText`, `switchChange`, `scroll`,
`layout`. Each one mirrors the click migration: native handler calls
`emitter->dispatchEvent(name, payload)`, JS side drops the `sync*`
function. Some need event-name remapping (e.g. our `submitEditing`
becomes `topSubmitEditing` on the Fabric side); pick the naming
convention up-front and use it consistently across all 12 events.

## Wiring gap to debug before Phase 2

A first run of Phase 1 + Phase 2 in this session compiled and linked
clean. Logs confirmed the chain up to `induce()`:

- `[View] gesture released tag=2024 emitter=yes`
- `[IdleEventBeat] request()`
- `[IdleEventBeat] idle fire → induce()`

But the JS-registered handler never fired — no `[fabric-events]
received` log appeared. Something between `induce() →
RuntimeScheduler::scheduleWork(beat)` and the beat callback running on
the JS thread isn't connecting. Suspects (none confirmed):

- `runtimeExecutor` may queue the beat but the JS worker doesn't run
  it (deadlock on Hermes' mutex, scheduling priority inversion, …).
- `EventBeat::isBeatCallbackScheduled_` might be stuck `true` if the
  first beat never completes, blocking subsequent inducements.
- `UIManager::onEvent` chain (eventPipe → `UIManagerBinding::dispatchEvent`)
  might drop the event before reaching `eventHandler_` for a reason
  specific to our scheduler setup.

Next debugging step: add a log inside the beat lambda itself
(`EventBeat::induce()` synthesizes it, so this means subclassing the
base or wrapping the `beatCallback_`). Or replace the
`runtimeExecutor` with a wrapper that logs every post + execution. Or
swap `scheduleWork` for `requestSynchronous` (via
`EventQueue::experimental_flushSync`) to bypass the async hop and see
if the synchronous flush works — if it does, the bug is specifically
in `scheduleWork` plumbing.

## Naming convention

Settle this before Phase 3:

- Native side emits **`click`**, **`submitEditing`**, **`changeText`**
  (lowerCamel, no `top` prefix). Matches RNW and modern Fabric.
- JS handler treats both forms (`topX` and `x`) to be robust against
  any RN internals that prepend `top`.
- Prop names mirror what RN apps already write: `onClick`,
  `onSubmitEditing`, `onChangeText`. The mapping is just `'on' +
capitalize(eventName)`.

## Out of scope

- Gesture-responder system (the React-side bubble/capture state
  machine). Real bubbling lands after the fiber-walk handler is
  proven; for now, "first handler in the bubble path fires and we
  stop" matches our existing tag-registry behavior.
- TouchEvent payloads. Move from `folly::dynamic` to typed payload
  classes (`PointerEvent`, `TouchEvent`) once everything's on the new
  pipeline.
