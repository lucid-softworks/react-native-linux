// Ambient declarations for the expo-* modules the playground demos
// import. These aren't installed as real npm packages — the bundler
// (apps/playground/bundle.mjs) aliases them to JS shims under
// packages/@lucid-softworks/react-native-linux-expo/ at build time.
// TypeScript doesn't see those aliases, so we declare the modules
// here with `any` exports — the demos exercise them at run-time,
// which is what catches drift.

declare module 'expo-status-bar' {
  export const StatusBar: any;
}
declare module 'expo-symbols' {
  export const SymbolView: any;
}
declare module 'expo-router' {
  export const Tabs: any;
  export const Link: any;
  export const router: any;
  export function useLocalSearchParams(): any;
}
declare module 'expo-font' {
  export function useFonts(map: any): [boolean, Error | null];
}
declare module 'expo-linking' {
  const Linking: any;
  export = Linking;
}
declare module 'expo-splash-screen' {
  const SplashScreen: any;
  export = SplashScreen;
}
declare module 'expo-web-browser' {
  const WebBrowser: any;
  export = WebBrowser;
}
declare module 'expo-constants' {
  const Constants: any;
  export default Constants;
}
