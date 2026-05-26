# Component support matrix

A live tally of which React Native components / APIs map to GTK4 on Linux.
Statuses:

- **✅** working in the current `main` snapshot.
- **🚧** scaffolded but incomplete — props/events partial.
- **⏳** planned, no code yet.
- **❌** not in scope.

Last updated: 2026-05-22.

## Core components

| Component              | GTK4 backing                  | Status |
| ---------------------- | ----------------------------- | ------ |
| `View`                 | `GtkFixed`                    | 🚧     |
| `Text`                 | `GtkLabel` (+ Pango attrs)    | 🚧     |
| `ScrollView`           | `GtkScrolledWindow`           | ⏳     |
| `Image`                | `GtkPicture` + gdk-pixbuf     | ⏳     |
| `TextInput`            | `GtkEntry` / `GtkTextView`    | ⏳     |
| `Pressable`            | JS + `GtkGestureClick`        | ⏳     |
| `Switch`               | `GtkSwitch`                   | ⏳     |
| `ActivityIndicator`    | `GtkSpinner`                  | ⏳     |
| `Modal`                | second `GtkWindow`            | ⏳     |
| `FlatList`             | JS over `ScrollView`          | ⏳     |
| `SectionList`          | JS over `ScrollView`          | ⏳     |
| `RefreshControl`       | custom (no direct equivalent) | ⏳     |
| `KeyboardAvoidingView` | no-op on desktop              | ⏳     |
| `StatusBar`            | no-op on desktop              | ⏳     |

## Core APIs

| API                   | Implementation                        | Status |
| --------------------- | ------------------------------------- | ------ |
| `Platform.OS`         | hard-coded `'linux'`                  | ✅     |
| `Platform.constants`  | `PlatformConstants` TurboModule       | 🚧     |
| `Dimensions`          | `gdk_monitor_*`                       | ⏳     |
| `Appearance`          | `AdwStyleManager` (libadwaita)        | ⏳     |
| `Linking`             | `g_app_info_launch_default_for_uri`   | ⏳     |
| `Clipboard`           | `gdk_clipboard_set_text`              | ⏳     |
| `AccessibilityInfo`   | AT-SPI2 / ATK bridge                  | ⏳     |
| `Animated`            | JS-side; no native driver yet         | 🚧     |
| `Alert`               | `GtkAlertDialog` (GTK 4.10+)          | ⏳     |
| `AppState`            | window focus / `GApplication` signals | ⏳     |
| `Vibration`           | not in scope (no haptics on desktop)  | ❌     |
| `PushNotificationIOS` | iOS only                              | ❌     |
| `PermissionsAndroid`  | Android only                          | ❌     |

## Out-of-tree / stretch

| Surface             | Path                            | Status |
| ------------------- | ------------------------------- | ------ |
| Native file dialogs | `GtkFileDialog`                 | ⏳     |
| D-Bus notifications | `org.freedesktop.Notifications` | ⏳     |
| Secret storage      | `org.freedesktop.secrets`       | ⏳     |
| System tray         | libayatana-appindicator         | ⏳     |
| WebView             | `WebKitGTK`                     | ⏳     |
| libadwaita styling  | `Adwaita*` widgets              | ⏳     |
| Reanimated 3        | JS worklets + JSI               | ⏳     |
