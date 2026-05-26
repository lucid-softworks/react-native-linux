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

| API                                               | Behavior on Linux                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `requestPermissionsAsync` / `getPermissionsAsync` | Returns `granted` — Linux doesn't gate per-app on the bare desktop |
| `scheduleNotificationAsync` (trigger=null)        | Immediate libnotify show                                           |
| `scheduleNotificationAsync` (trigger.seconds)     | `g_timeout_add` then libnotify show                                |
| `scheduleNotificationAsync` (trigger.date)        | Compute delayMs, then as above                                     |
| `presentNotificationAsync`                        | Direct libnotify show                                              |
| `cancelScheduledNotificationAsync`                | Removes timer + closes visible bubble for that id                  |
| `cancelAllScheduledNotificationsAsync`            | Same for all                                                       |
| `dismissNotificationAsync` / `dismissAll…`        | Alias for `cancel…`                                                |
| `getAllScheduledNotificationsAsync`               | Real — returns currently-pending schedules                         |
| `getPresentedNotificationsAsync`                  | Returns `[]` — the daemon owns presented-state, we don't mirror it |
| `addNotificationReceivedListener`                 | Accepted but never fires (libnotify has no "received" signal)      |
| `addNotificationResponseReceivedListener`         | Real — fires on close with `actionIdentifier='dismissed'`          |
| `setNotificationHandler`                          | Accepted and discarded (no foreground-vs-background distinction)   |
| `getBadgeCount` / `setBadgeCount`                 | Stored in JS memory; no desktop badge protocol implemented         |
| `set/get/deleteNotificationChannelAsync`          | No-ops — Android-only concept                                      |
| `setNotificationCategoryAsync` (+actions)         | No-op — libnotify supports actions but not yet wired through       |
| `getExpoPushTokenAsync` / `getDevicePushToken…`   | Throws — no push-service equivalent bundled                        |

## Known gaps

- **Push notifications (Expo push / FCM / APNS)** intentionally throw.
  Adding them needs a server contract and a wire format choice;
  unrelated to the local-notifications work.
- **Categories with action buttons** — libnotify supports
  `notify_notification_add_action`. Hooking expo's
  `setNotificationCategoryAsync` shape (action ids, button labels,
  `destructive` styling, `authenticationRequired`) is straightforward
  but not yet done.
- **Badge counts** are stored in JS memory and never surface to a
  panel. The Unity launcher API exists for this on some desktops but
  is widely deprecated; libdbusmenu / status notifier item would be
  the modern path.
- **Calendar / daily / weekly triggers** fall back to fire-now.
  Adding them is a JS-side scheduler (compute next fire time, set
  timeout, re-arm on fire); doable but unimplemented.
- **`addNotificationReceivedListener`** is accepted but never fires
  because libnotify doesn't emit a separate "received" signal —
  fired notifications go straight to the daemon. We could fire it
  ourselves at present-time as a synthetic event if real code starts
  depending on it.
- **Persistence across restarts** isn't done. Scheduled but unfired
  notifications are lost on app exit. A small sqlite or JSON cache
  would fix it; matches how `expo-task-manager` works on Android.
