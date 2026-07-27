# Changelog

## [0.1.0](https://github.com/lucid-softworks/react-native-linux/compare/react-native-linux-v0.0.1...react-native-linux-v0.1.0) (2026-07-27)


### ⚠ BREAKING CHANGES

* **deps:** bump to React 19.1.7 + RN 0.81.5 + Hermes
* consumers must install the scoped names. There is no unscoped 0.0.x release yet, so this is breakage in name only.

### Features

* **codegen,host:** component commands end-to-end ([46934e5](https://github.com/lucid-softworks/react-native-linux/commit/46934e5a9ce617e28b0f06852e97f27b37797b7c))
* **codegen:** Fabric component MVP — Props + EventEmitter + Shadow + Descriptor ([d41a28d](https://github.com/lucid-softworks/react-native-linux/commit/d41a28d3db5c34cfb3b30ccefd7de5fb82aa8798))
* **codegen:** ImageSource + Int32Enum component prop coverage ([a231a13](https://github.com/lucid-softworks/react-native-linux/commit/a231a134884636d3490bd4bb266eee0b232df4f2))
* **codegen:** Linux TurboModule generator emits real C++ headers ([ebbe9dc](https://github.com/lucid-softworks/react-native-linux/commit/ebbe9dc9efdf3e0a762bbf250491d869a0e367cd))
* **codegen:** non-void callback returns (primitive) ([32090a6](https://github.com/lucid-softworks/react-native-linux/commit/32090a6414f8e151091047f9098844fd07260d81))
* **codegen:** Object + Array props on Fabric components ([ab4d370](https://github.com/lucid-softworks/react-native-linux/commit/ab4d370662545c6be1290d4ec8bff41cc9f585b6))
* **codegen:** object args inside callback param types ([2e83adc](https://github.com/lucid-softworks/react-native-linux/commit/2e83adca57b99cf0f7bd2e84e79edd6a247a8aab))
* **codegen:** Reserved + StringEnum prop coverage for Fabric components ([d49dc46](https://github.com/lucid-softworks/react-native-linux/commit/d49dc460c54b07377b763daaf3dca201ac96b3ec))
* **codegen:** typed C++ structs in place of folly::dynamic for ObjectType ([ece6d4b](https://github.com/lucid-softworks/react-native-linux/commit/ece6d4b7b726f420a7b34a8a98e242c0c8f30930))
* **rn-linux:** add View/Text/UnimplementedView shims + codegen specs ([f640541](https://github.com/lucid-softworks/react-native-linux/commit/f640541f582892ffd6a91a7fdfd5060f52cd7bbb))
* **rn:** bump React Native 0.81 -&gt; 0.85.3 + Hermes 0.16 + new Scheduler hook ([f2c6392](https://github.com/lucid-softworks/react-native-linux/commit/f2c6392719eaf68eda2de7170f3293fb0057dad4))


### Bug Fixes

* **ci:** unblock typecheck, autolink, vnext-configure, and jest ([01efe7a](https://github.com/lucid-softworks/react-native-linux/commit/01efe7a20060acd88051c0903328b76c54455b58))
* **typecheck,test,lint:** unblock pre-push gate end-to-end ([4e42dca](https://github.com/lucid-softworks/react-native-linux/commit/4e42dca44039fdbc724bb3b7b38fb477c8861a39))


### Miscellaneous Chores

* **deps:** bump to React 19.1.7 + RN 0.81.5 + Hermes ([43427bd](https://github.com/lucid-softworks/react-native-linux/commit/43427bddb05d5a5d81103d7311f9d761de837015))
* scope packages under @lucid-softworks/ ([d9785e3](https://github.com/lucid-softworks/react-native-linux/commit/d9785e345b772116d6f5a5a3d511b55bc8d5f68d))
