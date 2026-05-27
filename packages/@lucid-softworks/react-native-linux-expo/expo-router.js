'use strict';

// Minimal expo-router shim.
//
// What's plumbed here:
//   * <Stack>, <Stack.Screen>, <Tabs>, <Tabs.Screen>, <Link>, <Slot>
//     <Redirect>, <ErrorBoundary>, <ThemeProvider> + DarkTheme/DefaultTheme
//   * useRouter, useNavigation, useLocalSearchParams, useGlobalSearchParams,
//     useSegments, usePathname, useFocusEffect, useRootNavigationState
//   * router singleton (.push / .replace / .back / .setParams)
//
// What's NOT here (and would need a build-time plugin to do honestly):
//   * File-based route discovery. Real expo-router scans app/**/*.tsx
//     during the bundle phase and generates a route map. We don't.
//   * To compensate, our <Stack.Screen> / <Tabs.Screen> accept a
//     `component` prop. Apps written for real expo-router will need a
//     wrapper layout that registers each screen's component manually.
//
// Navigation state lives in a single RouterContext with {pathname,
// params, history, navigate, back, setParams}. Both Stack and Tabs
// read from it; Link writes to it.

const React = require('react');
const {Pressable, Text, View} = require('react-native');
const {ErrorBoundary} = require('./error-boundary');

const DefaultTheme = {
  dark: false,
  colors: {
    primary: '#2563eb',
    background: '#fff',
    card: '#fff',
    text: '#0f172a',
    border: '#e4e6eb',
    notification: '#ef4444',
  },
  fonts: {regular: {}, medium: {}, bold: {}, heavy: {}},
};

const DarkTheme = {
  dark: true,
  colors: {
    primary: '#3b82f6',
    background: '#0f172a',
    card: '#1e293b',
    text: '#f8fafc',
    border: '#334155',
    notification: '#ef4444',
  },
  fonts: {regular: {}, medium: {}, bold: {}, heavy: {}},
};

// Module-level singleton — populated by the first <Stack>/<Tabs> that
// mounts, used by the imperative `router` export so apps can call
// `router.push('/foo')` from outside the React tree.
let activeNav = null;
function withNav(name, args) {
  if (activeNav) return activeNav[name](...args);
  if (typeof rnLinux !== 'undefined') {
    rnLinux.log('warn', '[expo-router] no active navigator for ' + name);
  }
  return undefined;
}

const router = {
  push: (...a) => withNav('navigate', a),
  replace: (...a) => withNav('replace', a),
  back: (...a) => withNav('back', a),
  setParams: (...a) => withNav('setParams', a),
  canGoBack: () => (activeNav ? activeNav.canGoBack() : false),
  navigate: (...a) => withNav('navigate', a),
};

const RouterContext = React.createContext({
  pathname: '/',
  params: {},
  history: ['/'],
  navigate: () => {},
  replace: () => {},
  back: () => {},
  setParams: () => {},
  canGoBack: () => false,
});

const NavigationContext = React.createContext(null);
const ThemeContext = React.createContext(DefaultTheme);

// File-system routing context. Each <Stack> / <Tabs> bumps this with
// the segment its parent matched on, so a nested <Stack.Screen
// name="sign-in" /> inside app/(auth)/_layout.tsx resolves to
// `(auth)/sign-in`, not just `/sign-in`.
//
// Real expo-router builds this tree from a babel-time
// `require.context('app', ...)` walk. The akari smoke harness
// generates the equivalent (route-table.tsx) at bundle time; the
// playground's other entries don't set globalThis.__expoRouterRoutes
// at all, so the lookup just returns undefined and the existing
// `component={...}` path still works.
const RouteBaseContext = React.createContext('');

function lookupRoute(base, name) {
  const routes = typeof globalThis !== 'undefined' ? globalThis.__expoRouterRoutes : null;
  if (!routes) return null;
  const prefix = base ? base + '/' + name : '/' + name;
  // `name` itself may already contain slashes (e.g. `oauth/callback`).
  // Try the "this is a directory with its own _layout" form first,
  // then the "this is a leaf file" form.
  const layoutKey = prefix + '/_layout';
  if (routes[layoutKey]) return {component: routes[layoutKey], childBase: prefix};
  if (routes[prefix]) return {component: routes[prefix], childBase: prefix};
  return null;
}

function parseHref(href) {
  if (typeof href !== 'string') {
    return {pathname: '/', params: {}};
  }
  const [path, query = ''] = href.split('?');
  const params = {};
  if (query) {
    for (const pair of query.split('&')) {
      const [k, v = ''] = pair.split('=');
      try {
        params[decodeURIComponent(k)] = decodeURIComponent(v);
      } catch {
        params[k] = v;
      }
    }
  }
  return {pathname: path || '/', params};
}

function makeRouter(initial = '/') {
  const [pathname, setPathname] = React.useState(initial);
  const [params, setParams] = React.useState({});
  const [history, setHistory] = React.useState([initial]);
  const navigate = React.useCallback(href => {
    const {pathname: p, params: q} = parseHref(href);
    setPathname(p);
    setParams(q);
    setHistory(h => [...h, p]);
  }, []);
  const replace = React.useCallback(href => {
    const {pathname: p, params: q} = parseHref(href);
    setPathname(p);
    setParams(q);
    setHistory(h => (h.length ? [...h.slice(0, -1), p] : [p]));
  }, []);
  const back = React.useCallback(() => {
    setHistory(h => {
      if (h.length <= 1) return h;
      const next = h.slice(0, -1);
      setPathname(next[next.length - 1]);
      return next;
    });
  }, []);
  const merge = React.useCallback(extra => {
    setParams(p => ({...p, ...extra}));
  }, []);
  const canGoBack = React.useCallback(() => history.length > 1, [history.length]);
  const ctx = React.useMemo(
    () => ({
      pathname,
      params,
      history,
      navigate,
      replace,
      back,
      setParams: merge,
      canGoBack,
    }),
    [pathname, params, history, navigate, replace, back, merge, canGoBack],
  );
  React.useEffect(() => {
    activeNav = ctx;
    return () => {
      if (activeNav === ctx) activeNav = null;
    };
  }, [ctx]);
  return ctx;
}

// ────────────────────────────────────────────────────────────────
// Stack — renders the screen whose `name` matches the current
// pathname segment. Stack.Screen is config-only (no own render).

function Stack({children, screenOptions}) {
  const ctx = makeRouter('/');
  const base = React.useContext(RouteBaseContext);
  const screens = collectScreens(children, Stack.Screen, base);
  const seg = (ctx.pathname || '/').replace(/^\//, '').split('/')[0] || 'index';
  const match = screens.find(s => s.name === seg) ?? screens[0];
  const headerShown = match?.options?.headerShown ?? screenOptions?.headerShown ?? true;
  return React.createElement(
    RouterContext.Provider,
    {value: ctx},
    React.createElement(
      View,
      {style: {flex: 1}},
      headerShown && match?.options?.title
        ? React.createElement(
            View,
            {style: stackStyles.header},
            React.createElement(Text, {style: stackStyles.headerTitle}, match.options.title),
          )
        : null,
      React.createElement(View, {style: {flex: 1}}, renderScreen(match)),
    ),
  );
}
Stack.Screen = function StackScreen(_props) {
  return null;
};

const stackStyles = {
  header: {
    paddingTop: 16,
    paddingBottom: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: DefaultTheme.colors.border,
    backgroundColor: DefaultTheme.colors.card,
  },
  headerTitle: {fontSize: 22, fontWeight: '700', color: DefaultTheme.colors.text},
};

// ────────────────────────────────────────────────────────────────
// Tabs — bottom tab bar + active screen content.

function Tabs({children, screenOptions}) {
  const ctx = makeRouter('/');
  const base = React.useContext(RouteBaseContext);
  const screens = collectScreens(children, Tabs.Screen, base);
  const seg = (ctx.pathname || '/').replace(/^\//, '').split('/')[0] || screens[0]?.name;
  const active = screens.find(s => s.name === seg) ?? screens[0];
  const activeColor =
    active?.options?.tabBarActiveTintColor ?? screenOptions?.tabBarActiveTintColor ?? '#2563eb';
  const inactiveColor =
    active?.options?.tabBarInactiveTintColor ?? screenOptions?.tabBarInactiveTintColor ?? '#9ca3af';
  return React.createElement(
    RouterContext.Provider,
    {value: ctx},
    React.createElement(
      View,
      {style: {flex: 1}},
      active?.options?.title && active?.options?.headerShown !== false
        ? React.createElement(
            View,
            {style: stackStyles.header},
            React.createElement(Text, {style: stackStyles.headerTitle}, active.options.title),
          )
        : null,
      React.createElement(View, {style: {flex: 1}}, renderScreen(active)),
      React.createElement(
        View,
        {style: tabsStyles.bar},
        screens.map(s => {
          const isActive = s === active;
          const color = isActive ? activeColor : inactiveColor;
          return React.createElement(
            Pressable,
            {key: s.name, style: tabsStyles.tab, onPress: () => ctx.navigate('/' + s.name)},
            s.options?.tabBarIcon
              ? s.options.tabBarIcon({color, focused: isActive, size: 24})
              : null,
            React.createElement(
              Text,
              {style: [tabsStyles.label, {color}]},
              s.options?.title ?? s.name,
            ),
          );
        }),
      ),
    ),
  );
}
Tabs.Screen = function TabsScreen(_props) {
  return null;
};

const tabsStyles = {
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: DefaultTheme.colors.border,
    backgroundColor: DefaultTheme.colors.card,
    paddingVertical: 8,
  },
  tab: {flex: 1, alignItems: 'center', paddingVertical: 6, gap: 2},
  label: {fontSize: 11, fontWeight: '600'},
};

// ────────────────────────────────────────────────────────────────
// Helpers

function collectScreens(children, Type, base) {
  const out = [];
  React.Children.forEach(children, child => {
    if (!child) return;
    if (child.type === Type) {
      // `component` is OUR extension — real expo-router resolves the
      // component from a same-named file under `app/`. Honour the
      // explicit prop first; if missing, ask the file-system route
      // table (populated at bundle time, see lookupRoute).
      let component = child.props.component;
      let childBase = (base || '') + (child.props.name ? '/' + child.props.name : '');
      if (!component && !child.props.children) {
        const fs = lookupRoute(base, child.props.name);
        if (fs) {
          component = fs.component;
          childBase = fs.childBase;
        }
      }
      out.push({
        name: child.props.name,
        options: child.props.options ?? {},
        component,
        children: child.props.children,
        childBase,
      });
    }
  });
  return out;
}

function renderScreen(match) {
  // Per-screen ErrorBoundary: a render throw inside this screen
  // unmounts only the screen subtree. Tabs/Stack stay mounted, their
  // pathname useState survives, and Dismiss re-mounts on the same
  // route. Anything above the router (the router itself, the safe-
  // area wrappers, the runtime's outer App element) still falls
  // through to the backstop boundary in apps/playground/runtime/
  // fabric.js.
  const scope = match ? 'route /' + match.name : '404';
  return React.createElement(ErrorBoundary, {scope}, renderScreenBody(match));
}

function renderScreenBody(match) {
  if (!match) {
    return React.createElement(
      View,
      {style: {flex: 1, alignItems: 'center', justifyContent: 'center'}},
      React.createElement(Text, null, '404'),
    );
  }
  if (match.component) {
    // Push the resolved file-system path so nested <Stack> instances
    // know where they sit. Plain `component={...}` Screens land here
    // too (childBase = base + '/' + name) which is fine — the route
    // table lookup will just miss if no such entry exists.
    return React.createElement(
      RouteBaseContext.Provider,
      {value: match.childBase || ''},
      React.createElement(match.component),
    );
  }
  if (match.children) {
    return React.createElement(
      RouteBaseContext.Provider,
      {value: match.childBase || ''},
      match.children,
    );
  }
  return React.createElement(
    View,
    {style: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24}},
    React.createElement(
      Text,
      {style: {color: DefaultTheme.colors.text, textAlign: 'center'}},
      'No component for "' +
        match.name +
        '". Pass <…Screen component={...} /> or wrap in a layout.',
    ),
  );
}

// ────────────────────────────────────────────────────────────────
// Link — Pressable that navigates.

function Link(props) {
  const {href, asChild, replace, children, style, onPress, ...rest} = props;
  const ctx = React.useContext(RouterContext);
  const handle = e => {
    if (onPress) onPress(e);
    if (e && e.defaultPrevented) return;
    (replace ? ctx.replace : ctx.navigate)(href);
  };
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, {
      onPress: handle,
      ...rest,
    });
  }
  // Don't theme text unless the Link has no parent style — apps that
  // pass their own style for the Pressable wrapper expect to control
  // the text colour themselves.
  const styledChild =
    typeof children === 'string'
      ? React.createElement(
          Text,
          {
            style: style
              ? {color: '#fff', fontWeight: '600'}
              : {color: DefaultTheme.colors.primary, fontWeight: '600'},
          },
          children,
        )
      : children;
  return React.createElement(Pressable, {style, onPress: handle, ...rest}, styledChild);
}

// ────────────────────────────────────────────────────────────────
// Misc

function Slot({children}) {
  return children ?? null;
}

function Redirect({href}) {
  const ctx = React.useContext(RouterContext);
  React.useEffect(() => {
    ctx.replace(href);
  }, [href]);
  return null;
}

function ErrorBoundaryProvider({children}) {
  return React.createElement(React.Fragment, null, children);
}

function ThemeProvider({value, children}) {
  return React.createElement(ThemeContext.Provider, {value: value ?? DefaultTheme}, children);
}

function useRouter() {
  return React.useContext(RouterContext);
}
function useNavigation() {
  return React.useContext(RouterContext);
}
function useLocalSearchParams() {
  return React.useContext(RouterContext).params;
}
function useGlobalSearchParams() {
  return React.useContext(RouterContext).params;
}
function useSegments() {
  return (React.useContext(RouterContext).pathname || '/')
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean);
}
function usePathname() {
  return React.useContext(RouterContext).pathname;
}
function useRootNavigationState() {
  const ctx = React.useContext(RouterContext);
  return {
    key: 'root',
    index: ctx.history.length - 1,
    routeNames: [],
    routes: ctx.history.map((p, i) => ({key: 'r' + i, name: p})),
    type: 'stack',
    stale: false,
  };
}
function useFocusEffect(cb) {
  React.useEffect(() => {
    const cleanup = cb();
    return cleanup;
  }, [cb]);
}

module.exports = {
  // Components
  Stack,
  Tabs,
  Link,
  Slot,
  Redirect,
  ThemeProvider,
  ErrorBoundary: ErrorBoundaryProvider,

  // Hooks
  useRouter,
  useNavigation,
  useLocalSearchParams,
  useGlobalSearchParams,
  useSegments,
  usePathname,
  useRootNavigationState,
  useFocusEffect,

  // Imperative
  router,

  // Theme
  DarkTheme,
  DefaultTheme,

  default: Stack,
  __esModule: true,
};
