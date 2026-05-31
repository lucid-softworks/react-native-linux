'use strict';

// styled-components/native shim. Real impl parses CSS via babel-
// plugin-styled-components or a runtime CSS-to-RN-style transformer,
// caches templates, and threads theme through ThemeContext. We
// support the most-used surface:
//
//   const Box = styled.View`padding: 16px; background: red;`
//   const Title = styled(Text)`font-size: 18px; color: ${p => p.color};`
//
// We treat the template literal as a flat block of `prop: value;`
// declarations, parse them with a tiny CSS-to-RN reducer, and
// pass the resulting style object straight through to RN. Values
// that are functions are evaluated with the component's props
// (which is the `${p => p.color}` interpolation form).

const React = require('react');
const RN = require('react-native');

// Convert "padding-top" → "paddingTop". RN style keys are camelCase.
function camelize(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// Strip the trailing "px" / "%" / etc. so RN gets numbers where it
// expects them. Leaves color strings + percentages untouched.
function parseValue(key, raw) {
  const trimmed = raw.trim().replace(/;$/, '');
  if (/^-?\d+(\.\d+)?px$/i.test(trimmed)) return parseFloat(trimmed);
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return parseFloat(trimmed);
  return trimmed;
}

// Resolve the tagged-template-literal pieces into a single CSS
// string. Function interpolations get the props object, value
// interpolations stringify. Same shape styled-components uses.
function resolveTemplate(strings, values, props) {
  let css = '';
  for (let i = 0; i < strings.length; i++) {
    css += strings[i];
    if (i < values.length) {
      const v = values[i];
      css += typeof v === 'function' ? v(props) : v == null ? '' : v;
    }
  }
  return css;
}

function cssToStyle(css) {
  const out = {};
  const decls = css.split(';');
  for (const decl of decls) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const key = decl.slice(0, idx).trim();
    const val = decl.slice(idx + 1).trim();
    if (!key || !val) continue;
    out[camelize(key)] = parseValue(key, val);
  }
  return out;
}

function makeStyledFactory(Component) {
  return function styledTag(strings, ...values) {
    function Styled(props) {
      const css = resolveTemplate(strings, values, props);
      const style = cssToStyle(css);
      const {forwardedAs, as, style: propStyle, ...rest} = props;
      const Target = forwardedAs || as || Component;
      return React.createElement(Target, {
        ...rest,
        style: propStyle ? [style, propStyle] : style,
      });
    }
    Styled.displayName = 'Styled(' + (Component.displayName || Component.name || 'Component') + ')';
    return Styled;
  };
}

// `styled` is a function (for `styled(Component)``) AND has component
// shortcuts (styled.View, styled.Text, …). Use a Proxy so any
// property access returns a factory for that RN primitive.
const styledFn = function (Component) {
  return makeStyledFactory(Component);
};
const styled = new Proxy(styledFn, {
  get(_target, prop) {
    if (typeof prop !== 'string') return undefined;
    const Component = RN[prop] || RN.View;
    return makeStyledFactory(Component);
  },
});

// ThemeContext for `<ThemeProvider theme={...}>`. Consumers grab via
// useTheme() or the `theme` prop on styled components.
const ThemeContext = React.createContext({});

function ThemeProvider(props) {
  return React.createElement(ThemeContext.Provider, {value: props.theme || {}}, props.children);
}

function useTheme() {
  return React.useContext(ThemeContext);
}

// `css` tagged template literal returns the same flat object form.
// Plenty of apps inline `css\`color: red\`` into other styled blocks.
function css(strings, ...values) {
  return cssToStyle(resolveTemplate(strings, values, {}));
}

Object.defineProperty(module.exports, '__esModule', {value: true});
module.exports.default = styled;
module.exports.ThemeProvider = ThemeProvider;
module.exports.ThemeContext = ThemeContext;
module.exports.useTheme = useTheme;
module.exports.css = css;
// `styled-components` (without /native) re-exports the same surface
// on web, so apps importing either path get the same shim.
module.exports.styled = styled;
