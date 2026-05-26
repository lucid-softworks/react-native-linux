# Real-app harness: expo-notifications via libnotify

`expo-notifications` produces real desktop notifications on Linux by
talking to the freedesktop notification spec
(`org.freedesktop.Notifications` on the session bus) through
libnotify. Whichever notification daemon the user's desktop runs —
gnome-shell, xfce4-notifyd, mako, dunst — renders the bubble.

## Architecture

```
JS app
  ↓ require('expo-notifications')   ← metro/esbuild rewrite, linux only
@lucid-softworks/react-native-linux-expo/expo-notifications.js
  ├─ scheduleNotificationAsync({content, trigger})
  │    ↓ trigger=null  →  rnLinux.notificationsPresent
  │    ↓ trigger.seconds → rnLinux.notificationsSchedule (delayMs)
  │
  ├─ cancelScheduledNotificationAsync → rnLinux.notificationsCancel
  ├─ getAllScheduledNotificationsAsync → rnLinux.notificationsListScheduled
  └─ addNotificationResponseReceivedListener
       ↓ multiplex into rnLinux.notificationsSetResponseListener
                          (one C++ slot, fans out in JS)
  ↓
vnext/src/jsi/RnLinuxBindings.cpp        ← JSI bindings
  ↓
vnext/src/notifications/Notifications.cpp ← libnotify wrapper
  ↓
libnotify  →  org.freedesktop.Notifications (session bus)
            →  notification daemon (gnome-shell / xfce4-notifyd / …)
                                                ↓ "closed" signal
                                          response → fans back to JS
```

Scheduling is in-process: a `g_timeout_add` source per scheduled
notification, keyed by JS-supplied identifier so cancellation is
O(1) and replacing an existing schedule (same id, new content) is
idempotent. The visible bubble's lifetime is owned by the daemon
once handed off; `cancel()` calls `notify_notification_close` to
take it back down.

## VM / host setup

```sh
sudo apt install -y libnotify-dev libnotify-bin
```

`libnotify-dev` ships `libnotify.pc` for the CMake build;
`libnotify-bin` brings the `notify-send` CLI for sanity checks.

**You also need a notification daemon running.** Full desktop
sessions (GNOME, Plasma, …) start one automatically. Bare Xfce VMs
do not. Install + start one:

```sh
sudo apt install -y xfce4-notifyd
# Auto-starts via DBus activation on the first
# org.freedesktop.Notifications method call — no systemd unit needed.
```

Other daemons that work the same way: `mako` (Wayland), `dunst`,
`notification-daemon`, anything implementing the spec. If no daemon
is installed, `notify_notification_show` returns false and our
`present()` surfaces that to JS.

## Running the smoke demo

```sh
cd apps/playground
RN_ENTRY=smoke-demo.tsx node bundle.mjs
scripts/vm/sh.sh 'scripts/vm/run-playground.sh'
```

Scroll to the `expo-notifications` section. Click **present** for an
immediate bubble; **schedule 3s** kicks off a delayed one;
**cancel all** removes pending schedules. Dismiss the bubble in the
desktop's notification UI to see the response listener fire (the
`last response` line updates with the identifier + actionId).

## API surface

| API                                                        | Behavior on Linux                                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `requestPermissionsAsync` / `getPermissionsAsync`          | Returns `granted` — Linux doesn't gate per-app on the bare desktop                                                |
| `scheduleNotificationAsync` (trigger=null)                 | Immediate libnotify show                                                                                          |
| `scheduleNotificationAsync` (trigger.seconds)              | JS `setTimeout` then `notify_notification_show`                                                                   |
| `scheduleNotificationAsync` (trigger.date)                 | Compute delayMs, then as above                                                                                    |
| `scheduleNotificationAsync` (daily/weekly/yearly/calendar) | Real — JS scheduler computes next fire, re-arms after each tick                                                   |
| `presentNotificationAsync`                                 | Direct libnotify show                                                                                             |
| `cancelScheduledNotificationAsync`                         | Removes JS timer + closes visible bubble for that id                                                              |
| `cancelAllScheduledNotificationsAsync`                     | Same for all                                                                                                      |
| `dismissNotificationAsync` / `dismissAll…`                 | Alias for `cancel…`                                                                                               |
| `getAllScheduledNotificationsAsync`                        | Real — returns pending schedules (full request body, not just title/body)                                         |
| `getPresentedNotificationsAsync`                           | Returns `[]` — the daemon owns presented-state, we don't mirror it                                                |
| `addNotificationReceivedListener`                          | Real — synthesized from this process's present()/schedule() entry points                                          |
| `addNotificationResponseReceivedListener`                  | Real — fires on close with `actionIdentifier='dismissed'` or the action key for category-button clicks            |
| `setNotificationHandler`                                   | Accepted and discarded (no foreground-vs-background distinction)                                                  |
| `getBadgeCount` / `setBadgeCount`                          | Stored in JS memory; no desktop badge protocol implemented                                                        |
| `set/get/deleteNotificationChannelAsync`                   | No-ops — Android-only concept                                                                                     |
| `setNotificationCategoryAsync` (+actions)                  | Real — `notify_notification_add_action` per button; clicks fan back via the response listener with the action key |
| `getNotificationCategoriesAsync`                           | Real — round-trips through the native category registry                                                           |
| `getExpoPushTokenAsync` / `getDevicePushToken…`            | Throws — no push-service equivalent bundled                                                                       |

## Known gaps

- **Push notifications (Expo push / FCM / APNS)** intentionally throw.
  Adding them needs a server contract and a wire format choice;
  unrelated to the local-notifications work.
- **Categories with action buttons** — **DONE.**
  `setNotificationCategoryAsync(id, [{identifier, buttonTitle}])`
  registers the action list against the native side; when a
  notification's `content.categoryIdentifier` matches, every action
  is added via `notify_notification_add_action`. A click on a
  button fans through the same response listener as a dismiss,
  with `actionIdentifier` set to the action key.
  `destructive` / `authenticationRequired` styling isn't surfaced
  — the freedesktop notification spec has no equivalent flag.
- **Badge counts** are stored in JS memory and never surface to a
  panel. The Unity launcher API exists for this on some desktops but
  is widely deprecated; libdbusmenu / status notifier item would be
  the modern path.
- **Calendar / daily / weekly / yearly triggers** — **DONE.** JS
  owns the scheduler now: each schedule computes its next absolute
  fire time off the trigger shape and `setTimeout`s to it; repeating
  triggers (`daily`, `weekly`, `yearly`, `calendar`, or any
  trigger with `repeats: true`) re-arm after each fire. Calendar
  triggers match on any subset of `{second, minute, hour, day,
month, year, weekday}` — we walk forward until the constraints
  match. The native `notificationsSchedule` JSI is no longer used
  for the timer path; the C++ side just handles the immediate
  present and cancel-visible.
- **`addNotificationReceivedListener`** — **DONE.** Synthesized
  at present-time from this process's `presentNotificationAsync`
  / `scheduleNotificationAsync` entry points, with the standard
  expo `{request, date}` shape. Cancellation clears the pending
  JS-side timer so cancelled schedules don't fire the listener
  spuriously. Note: notifications presented by _other_ processes
  on the same daemon still don't surface here — that would need
  a `org.freedesktop.Notifications` bus eavesdrop, which most
  daemons reject for security reasons.
- **Persistence across restarts** isn't done. A first attempt
  serialized to `$XDG_CACHE_HOME/expo-notifications-scheduled.json`
  and rehydrated at module load, but the at-load rehydrate raced
  with vendor-bundle evaluation on this runtime and stalled the
  whole boot; that's tracked as a follow-up. The next iteration
  will wire rehydrate behind an explicit app-lifecycle hook
  (mirrors how iOS's `application:didFinishLaunching` and
  Android's foreground service handle the same problem).
  Scheduled-but-unfired notifications are lost on app exit
  meanwhile.
