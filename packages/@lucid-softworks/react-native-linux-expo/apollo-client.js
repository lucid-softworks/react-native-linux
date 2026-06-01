'use strict';

// @apollo/client shim. Apollo's surface is enormous; for smoke we
// implement the most-used pieces:
//   * `new ApolloClient({...})`
//   * `<ApolloProvider client={client}>`
//   * `useQuery` (returns loading: false, data: null, error: null)
//   * `useMutation` / `useLazyQuery` (no-op variants)
//   * `gql` (returns the template literal as-is — apps don't usually
//     inspect the parsed AST until execution time)
//   * `InMemoryCache`, `HttpLink`, `from`, `ApolloLink` — placeholder
//     constructors that just hold their config so chaining doesn't throw.

const React = require('react');

const ApolloCtx = React.createContext(null);

function ApolloClient(config) {
  this.config = config || {};
  this.cache = (config && config.cache) || new InMemoryCache();
}
ApolloClient.prototype.query = () => Promise.resolve({data: null, loading: false, error: null});
ApolloClient.prototype.mutate = () => Promise.resolve({data: null, loading: false, error: null});
ApolloClient.prototype.subscribe = () => ({
  subscribe(observer) {
    return {unsubscribe() {}};
  },
});
ApolloClient.prototype.watchQuery = () => ({
  subscribe() {
    return {unsubscribe() {}};
  },
});
ApolloClient.prototype.resetStore = () => Promise.resolve();
ApolloClient.prototype.clearStore = () => Promise.resolve();
ApolloClient.prototype.onResetStore = () => () => {};

function InMemoryCache(config) {
  this.config = config || {};
}
InMemoryCache.prototype.extract = () => ({});
InMemoryCache.prototype.restore = () => ({});

function HttpLink(opts) {
  Object.assign(this, opts || {});
}
function ApolloLink(opts) {
  Object.assign(this, opts || {});
}
function from(links) {
  return {links: links || []};
}
function createHttpLink(opts) {
  return new HttpLink(opts);
}

function ApolloProvider(props) {
  return React.createElement(ApolloCtx.Provider, {value: props.client || null}, props.children);
}

function useQuery() {
  // Returning `data: null + loading: false` causes apps that read
  // `data.starship.name` inside the success branch to crash with
  // Cannot read property of null. Stay in `loading: true` so apps
  // render their loader and gate field access behind a guard. data
  // stays undefined which is the canonical Apollo "no result yet"
  // value.
  return {
    data: undefined,
    loading: true,
    error: null,
    networkStatus: 1,
    called: true,
    client: null,
    refetch: () => Promise.resolve(),
    fetchMore: () => Promise.resolve(),
    subscribeToMore: () => () => {},
    startPolling: () => {},
    stopPolling: () => {},
    updateQuery: () => {},
  };
}
function useMutation() {
  return [
    () => Promise.resolve({data: null}),
    {loading: false, error: null, data: null, reset() {}},
  ];
}
function useLazyQuery() {
  return [() => Promise.resolve({data: null}), {loading: false, error: null, data: null}];
}
function useSubscription() {
  return {loading: false, error: null, data: null};
}
function useApolloClient() {
  return React.useContext(ApolloCtx);
}

// `gql` accepts a tagged template literal and returns the raw query
// document. Real Apollo parses with graphql-tag; we just rebuild the
// joined source so callers that compare via `loc.source.body` still
// see something stable.
function gql(strings) {
  let q = '';
  for (let i = 0; i < strings.length; i++) {
    q += strings[i];
    if (i < arguments.length - 1) q += '${' + i + '}';
  }
  return {kind: 'Document', definitions: [], loc: {source: {body: q}}};
}

Object.defineProperty(module.exports, '__esModule', {value: true});
module.exports.ApolloClient = ApolloClient;
module.exports.ApolloProvider = ApolloProvider;
module.exports.InMemoryCache = InMemoryCache;
module.exports.HttpLink = HttpLink;
module.exports.ApolloLink = ApolloLink;
module.exports.createHttpLink = createHttpLink;
module.exports.from = from;
module.exports.useQuery = useQuery;
module.exports.useMutation = useMutation;
module.exports.useLazyQuery = useLazyQuery;
module.exports.useSubscription = useSubscription;
module.exports.useApolloClient = useApolloClient;
module.exports.gql = gql;
module.exports.NetworkStatus = {
  loading: 1,
  setVariables: 2,
  fetchMore: 3,
  refetch: 4,
  poll: 6,
  ready: 7,
  error: 8,
};
