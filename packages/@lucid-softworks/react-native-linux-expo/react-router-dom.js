'use strict';

// react-router-dom is the web-only router. RN apps occasionally use
// it via react-native-web's compat layer. We provide BrowserRouter
// + Routes + Route + Link + useNavigate / useLocation as stubs
// that render the first matched Route's element (no actual routing).

const React = require('react');

const LocationContext = React.createContext({pathname: '/', search: '', hash: '', state: null});
const NavigationContext = React.createContext({navigate: () => {}, replace: () => {}});

function BrowserRouter(props) {
  return React.createElement(LocationContext.Provider, {value: {pathname: '/'}}, props.children);
}
const Router = BrowserRouter;
const HashRouter = BrowserRouter;
const MemoryRouter = BrowserRouter;

function Routes(props) {
  // Pick the first Route child's element.
  const first = React.Children.toArray(props.children).find(c => c && c.props && c.props.element);
  return first ? first.props.element : null;
}

function Route(_props) {
  return null;
}

function Link(props) {
  return React.createElement('view', props, props.children);
}

function useNavigate() {
  return () => {};
}
function useLocation() {
  return React.useContext(LocationContext);
}
function useParams() {
  return {};
}
function useSearchParams() {
  return [new URLSearchParams(), () => {}];
}
function Navigate(_props) {
  return null;
}
function Outlet(_props) {
  return null;
}

Object.defineProperty(module.exports, '__esModule', {value: true});
module.exports.BrowserRouter = BrowserRouter;
module.exports.Router = Router;
module.exports.HashRouter = HashRouter;
module.exports.MemoryRouter = MemoryRouter;
module.exports.Routes = Routes;
module.exports.Route = Route;
module.exports.Link = Link;
module.exports.NavLink = Link;
module.exports.Navigate = Navigate;
module.exports.Outlet = Outlet;
module.exports.useNavigate = useNavigate;
module.exports.useLocation = useLocation;
module.exports.useParams = useParams;
module.exports.useSearchParams = useSearchParams;
