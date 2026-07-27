# Changelog

## [0.1.0](https://github.com/lucid-softworks/react-native-linux/compare/react-native-linux-cli-v0.0.1...react-native-linux-cli-v0.1.0) (2026-07-27)


### ⚠ BREAKING CHANGES

* **deps:** bump to React 19.1.7 + RN 0.81.5 + Hermes
* consumers must install the scoped names. There is no unscoped 0.0.x release yet, so this is breakage in name only.

### Features

* **cli:** add autolink-linux command + jest tests ([f4ffbc3](https://github.com/lucid-softworks/react-native-linux/commit/f4ffbc373583027322867fe02bec443709c8a943))
* **cli:** autolink-linux picks up *NativeComponent.ts specs ([2fe2a1b](https://github.com/lucid-softworks/react-native-linux/commit/2fe2a1badec357361c4c19b380503af96dd2c79b))
* **cli:** autolink-linux runs Linux codegen per linked dep ([76f3344](https://github.com/lucid-softworks/react-native-linux/commit/76f33443ff5a0bc96a8454db5b8be19776b5bd34))
* **cli:** derive per-binary application-id from package.json ([df65f00](https://github.com/lucid-softworks/react-native-linux/commit/df65f00ac283a5e17b1d17a08819d007569477d7))
* **cli:** pack-linux --target=rpm builds a .rpm via rpmbuild ([8112132](https://github.com/lucid-softworks/react-native-linux/commit/8112132a235e53321cc791159bc9a6483c5a17e5))
* **cli:** pack-linux command with .deb packager ([887848f](https://github.com/lucid-softworks/react-native-linux/commit/887848fb393430f6d08a23eb20863de94a103e97))
* **rn:** bump React Native 0.81 -&gt; 0.85.3 + Hermes 0.16 + new Scheduler hook ([f2c6392](https://github.com/lucid-softworks/react-native-linux/commit/f2c6392719eaf68eda2de7170f3293fb0057dad4))


### Bug Fixes

* **ci:** unblock typecheck, autolink, vnext-configure, and jest ([01efe7a](https://github.com/lucid-softworks/react-native-linux/commit/01efe7a20060acd88051c0903328b76c54455b58))


### Miscellaneous Chores

* **deps:** bump to React 19.1.7 + RN 0.81.5 + Hermes ([43427bd](https://github.com/lucid-softworks/react-native-linux/commit/43427bddb05d5a5d81103d7311f9d761de837015))
* scope packages under @lucid-softworks/ ([d9785e3](https://github.com/lucid-softworks/react-native-linux/commit/d9785e345b772116d6f5a5a3d511b55bc8d5f68d))
