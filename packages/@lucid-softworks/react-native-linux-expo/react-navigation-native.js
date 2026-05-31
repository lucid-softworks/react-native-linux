'use strict';

// Minimal @react-navigation/native shim — enough to mount apps that
// reach for NavigationContainer + Stack/Drawer/Tabs.Navigator from
// the top of their component tree. Actual route transitions are
// out of scope: the navigator renders the initial screen and stays
// there. useNavigation returns a stub with no-op navigate/goBack so
// callsites don't throw.
//
// The companion packages (@react-navigation/stack,
// /native-stack, /drawer, /bottom-tabs) live as separate require
// targets; the bundle.mjs banner routes all of them through this
// same factory so a single implementation backs them all.

const React = require('react');
const {View, Text} = require('react-native');

const NavigationContext = React.createContext({
  navigate: () => {},
  goBack: () => {},
  reset: () => {},
  setParams: () => {},
  setOptions: () => {},
  canGoBack: () => false,
  isFocused: () => true,
  dispatch: () => {},
  addListener: () => () => {},
  removeListener: () => {},
});

const RouteContext = React.createContext({
  key: 'root',
  name: 'root',
  params: undefined,
});

const NavigationContainerRefContext = React.createContext(null);

function NavigationContainer(props) {
  return React.createElement(
    NavigationContainerRefContext.Provider,
    {value: {current: null}},
    props.children,
  );
}

// createNavigationContainerRef — apps grab a ref + call
// .navigate(name) from outside React. We return an object with the
// same stub methods our context provides.
function createNavigationContainerRef() {
  return {
    current: null,
    navigate: () => {},
    goBack: () => {},
    reset: () => {},
    isReady: () => true,
    dispatch: () => {},
  };
}

function useNavigation() {
  return React.useContext(NavigationContext);
}
function useRoute() {
  return React.useContext(RouteContext);
}
function useNavigationState(selector) {
  const state = {index: 0, routes: [{key: 'root', name: 'root'}]};
  return selector ? selector(state) : state;
}
function useFocusEffect(callback) {
  React.useEffect(() => {
    const cleanup = callback();
    return cleanup;
  }, []);
}
function useIsFocused() {
  return true;
}
function useNavigationContainerRef() {
  return React.useContext(NavigationContainerRefContext) || createNavigationContainerRef();
}

// Theme helpers — apps pass theme={DarkTheme} into NavigationContainer
// to wire up status-bar / surface colours. We export the canonical
// shapes so theme prop reads still work.
const DefaultTheme = {
  dark: false,
  colors: {
    primary: '#007aff',
    background: '#fff',
    card: '#fff',
    text: '#000',
    border: '#d8d8d8',
    notification: '#ff3b30',
  },
  fonts: {regular: {}, medium: {}, bold: {}, heavy: {}},
};
const DarkTheme = {
  dark: true,
  colors: {
    primary: '#0a84ff',
    background: '#000',
    card: '#1c1c1e',
    text: '#fff',
    border: '#272729',
    notification: '#ff453a',
  },
  fonts: {regular: {}, medium: {}, bold: {}, heavy: {}},
};
function useTheme() {
  return DefaultTheme;
}

// Navigator factories. createStackNavigator / createNativeStackNavigator /
// createDrawerNavigator / createBottomTabNavigator all return
// {Navigator, Screen, Group}. The Navigator renders the initial
// screen's component; Group is a passthrough.
function makeNavigatorFactory() {
  return function createNavigator() {
    function Navigator(props) {
      // Walk children to find Screen entries — they're the source of
      // truth for what to render. Take the initialRouteName prop, or
      // the first Screen's name.
      const screens = [];
      React.Children.forEach(props.children, child => {
        if (child && child.props && typeof child.props.name === 'string') {
          screens.push(child);
        }
      });
      if (!screens.length) return null;
      const initial = props.initialRouteName;
      const picked = screens.find(s => s.props.name === initial) || screens[0];
      const screenProps = picked.props;
      const Component =
        screenProps.component || (screenProps.children ? () => screenProps.children : null);
      if (!Component) {
        return React.createElement(
          View,
          {style: {flex: 1, justifyContent: 'center', alignItems: 'center'}},
          React.createElement(
            Text,
            null,
            'Navigator screen "' + screenProps.name + '" has no component',
          ),
        );
      }
      const route = {
        key: screenProps.name,
        name: screenProps.name,
        params: screenProps.initialParams,
      };
      const navigation = React.useContext(NavigationContext);
      return React.createElement(
        RouteContext.Provider,
        {value: route},
        React.createElement(NavigationContext.Provider, {value: navigation}, [
          React.createElement(Component, {
            key: 'screen',
            navigation,
            route,
            ...(screenProps.initialParams || {}),
          }),
        ]),
      );
    }
    function Screen(_props) {
      // Screens are pure declaration containers — the Navigator walks
      // them and decides what to render. Returning null is fine
      // because the Navigator never includes them in its returned
      // tree.
      return null;
    }
    function Group(props) {
      return props.children;
    }
    return {Navigator, Screen, Group};
  };
}

const createStackNavigator = makeNavigatorFactory();
const createNativeStackNavigator = makeNavigatorFactory();
const createDrawerNavigator = makeNavigatorFactory();
const createBottomTabNavigator = makeNavigatorFactory();
const createMaterialTopTabNavigator = makeNavigatorFactory();
const createMaterialBottomTabNavigator = makeNavigatorFactory();

// CommonActions / StackActions / DrawerActions — action creators
// returning bare objects. Apps that pass these to navigation.dispatch
// won't crash; the dispatch itself is a no-op on our side.
const CommonActions = {
  navigate: (name, params) => ({type: 'NAVIGATE', payload: {name, params}}),
  goBack: () => ({type: 'GO_BACK'}),
  reset: state => ({type: 'RESET', payload: state}),
  setParams: params => ({type: 'SET_PARAMS', payload: params}),
};
const StackActions = {
  push: (name, params) => ({type: 'PUSH', payload: {name, params}}),
  pop: count => ({type: 'POP', payload: {count}}),
  popToTop: () => ({type: 'POP_TO_TOP'}),
  replace: (name, params) => ({type: 'REPLACE', payload: {name, params}}),
};
const DrawerActions = {
  openDrawer: () => ({type: 'OPEN_DRAWER'}),
  closeDrawer: () => ({type: 'CLOSE_DRAWER'}),
  toggleDrawer: () => ({type: 'TOGGLE_DRAWER'}),
};

Object.defineProperty(module.exports, '__esModule', {value: true});
module.exports.NavigationContainer = NavigationContainer;
module.exports.NavigationContext = NavigationContext;
module.exports.RouteContext = RouteContext;
module.exports.createNavigationContainerRef = createNavigationContainerRef;
module.exports.useNavigation = useNavigation;
module.exports.useNavigationContainerRef = useNavigationContainerRef;
module.exports.useRoute = useRoute;
module.exports.useNavigationState = useNavigationState;
module.exports.useFocusEffect = useFocusEffect;
module.exports.useIsFocused = useIsFocused;
module.exports.useTheme = useTheme;
module.exports.DefaultTheme = DefaultTheme;
module.exports.DarkTheme = DarkTheme;
module.exports.CommonActions = CommonActions;
module.exports.StackActions = StackActions;
module.exports.DrawerActions = DrawerActions;
// Navigator factories live on every @react-navigation/* sub-package.
// Re-exported here so the bundle banner can route them all through
// this single module.
module.exports.createStackNavigator = createStackNavigator;
module.exports.createNativeStackNavigator = createNativeStackNavigator;
module.exports.createDrawerNavigator = createDrawerNavigator;
module.exports.createBottomTabNavigator = createBottomTabNavigator;
module.exports.createMaterialTopTabNavigator = createMaterialTopTabNavigator;
module.exports.createMaterialBottomTabNavigator = createMaterialBottomTabNavigator;
