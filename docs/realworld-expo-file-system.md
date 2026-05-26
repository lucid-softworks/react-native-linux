# Real-app harness: expo-file-system via POSIX + libsoup

`expo-file-system` is wired directly against POSIX file syscalls
through `vnext/src/filesystem/FileSystem.cpp`. Downloads use libsoup
when present. No external dependencies beyond what the rest of
react-native-linux already pulls in.

## Architecture

```
JS app
  ↓ require('expo-file-system')   ← metro/esbuild rewrite, linux only
@lucid-softworks/react-native-linux-expo/expo-file-system.js
  ├─ documentDirectory / cacheDirectory / bundleDirectory
  │    ← rnLinux.fsConstants() (cached, one read)
  │
  ├─ readAsStringAsync(uri, {encoding})        →  rnLinux.fsReadString
  ├─ writeAsStringAsync(uri, contents, {enc})  →  rnLinux.fsWriteString
  ├─ getInfoAsync(uri, {md5})                   →  rnLinux.fsGetInfo
  ├─ deleteAsync(uri, {idempotent})             →  rnLinux.fsDelete
  ├─ makeDirectoryAsync(uri, {intermediates})   →  rnLinux.fsMakeDirectory
  ├─ readDirectoryAsync(uri)                    →  rnLinux.fsReadDirectory
  ├─ copyAsync({from, to})                      →  rnLinux.fsCopy
  ├─ moveAsync({from, to})                      →  rnLinux.fsMove
  └─ downloadAsync(url, dest)                   →  rnLinux.fsDownload
                                                    ↓ libsoup async
                                                  callback → resolved Promise
```

`file://` URIs are stripped at every boundary by the JS shim; the
C++ side only ever sees absolute paths. The directory constants are
returned WITH the `file://` prefix so concat-string usage matches
upstream (`FS.documentDirectory + 'foo.txt'`).

## Design notes

- **`writeAsStringAsync` is atomic-ish.** We write to `<path>.tmp-rnl`
  then `rename(2)` into place, so a mid-write crash doesn't leave a
  zero-byte file at the consumer's expected path. Real RN apps lean
  on `writeAsStringAsync` for cache JSON and a half-truncation there
  silently breaks the next read.
- **`deleteAsync` on a directory recurses.** We walk the tree with
  `lstat` (never following symlinks), `unlink` files, then `rmdir`
  upward. Matches upstream's `recursive: true` semantics.
- **`moveAsync` falls through to copy+delete on EXDEV.** POSIX
  `rename(2)` only works inside one mount; cross-mount apps
  (`/tmp/...` → `~/...` on systems where `/tmp` is tmpfs) would
  otherwise fail loudly. We translate transparently.
- **Constants are derived from XDG.** `documentDirectory` is
  `$XDG_DATA_HOME/<app-id>/`; `cacheDirectory` is
  `$XDG_CACHE_HOME/<app-id>/`; both fall back to `~/.local/share`
  and `~/.cache` if unset. `bundleDirectory` is computed from
  `/proc/self/exe` + `/assets/`.
- **`getInfoAsync(uri, {md5: true})` streams the file.** 8 KiB
  chunks fed into `g_checksum_update`; fine for any reasonable file
  size without buffering the whole thing.

## VM / host setup

No new install. POSIX is in libc; libsoup3 is already pulled in by
the Image component (downloads silently fall back to "libsoup was
not enabled at build time" if not present).

## Running the smoke demo

```sh
cd apps/playground
RN_ENTRY=smoke-demo.tsx node bundle.mjs
scripts/vm/sh.sh 'scripts/vm/run-playground.sh'
```

The expo-file-system section auto-runs on mount: writes a tagged file
under `documentDirectory`, reads it back, lists the directory, checks
the round-trip, then deletes the file. Shows
`wrote+read N bytes  size=N  K/M entries match prefix` on success.

## API surface

| API                                  | Behavior on Linux                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `documentDirectory`                  | `file://$XDG_DATA_HOME/<app-id>/`                                              |
| `cacheDirectory`                     | `file://$XDG_CACHE_HOME/<app-id>/`                                             |
| `bundleDirectory`                    | `file://${exe_dir}/assets/`                                                    |
| `readAsStringAsync(uri, {enc})`      | POSIX read; `utf8` and `base64` encodings supported                            |
| `writeAsStringAsync(uri, c, {enc})`  | Atomic write via `.tmp-rnl` + rename                                           |
| `getInfoAsync(uri, {md5})`           | `stat`; MD5 streamed via `g_checksum_*` when requested                         |
| `deleteAsync(uri, {idempotent})`     | `unlink` for files; recursive walk + rmdir for directories                     |
| `makeDirectoryAsync(uri, {imm})`     | `mkdir(2)` or hand-rolled `mkdir -p` for intermediates                         |
| `readDirectoryAsync(uri)`            | `opendir`/`readdir`; `.` and `..` filtered                                     |
| `copyAsync({from, to})`              | 64 KiB streamed copy                                                           |
| `moveAsync({from, to})`              | `rename(2)`; copy+delete fallback on EXDEV                                     |
| `downloadAsync(url, fileUri)`        | libsoup async GET → file. Returns `{uri, status, size}`                        |
| `uploadAsync`                        | Throws — multipart/binary upload not implemented yet                           |
| `createDownloadResumable` / class    | `downloadAsync()` works; `pauseAsync`/`cancelAsync` throw                      |
| `StorageAccessFramework.*`           | Most ops mapped onto regular file ops; permission stub returns `granted=false` |
| `getFreeDiskStorageAsync` / `…Total` | Returns `-1` ("unknown") — a `statvfs` binding would be a few lines            |
| `getContentUriAsync`                 | Throws — Android-only `content://` scheme has no Linux equivalent              |
| `EncodingType.UTF8` / `Base64`       | Real                                                                           |

## Known gaps

- **Resumable downloads** (`DownloadResumable.pauseAsync` /
  `cancelAsync`) aren't implemented. Doing them properly needs HTTP
  Range support driving the libsoup request + a durable resume
  token. Right now `resumeAsync` falls through to a full
  `downloadAsync`.
- **Uploads** (`uploadAsync`, multipart / binary) are unimplemented.
  Adding them needs `SoupMultipart` for the multipart path and a
  body-stream for binary — straightforward, not yet done.
- **Disk space** (`getFreeDiskStorageAsync` / `getTotalDiskCapacityAsync`)
  returns `-1`. A `statvfs("/")` binding is a few lines whenever a
  real app depends on it.
- **`content://` URIs** are Android-only. We throw on
  `getContentUriAsync`; for cross-platform code that branches on
  scheme, this is the right failure mode.
- **No file-system event watcher.** expo-file-system doesn't expose
  one either; consumers usually reach for `chokidar` for that. If
  needed, `inotify` would be the obvious backend.
- **Download progress events.** We deliver completion-only today.
  libsoup supports byte-count notifications via `soup_message_*`
  signals; adding them is a follow-up.
