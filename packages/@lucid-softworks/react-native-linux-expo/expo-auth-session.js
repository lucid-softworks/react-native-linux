'use strict';

// expo-auth-session shim. OAuth via the system browser; on Linux we
// don't have an interactive auth handler today (would need to launch
// xdg-open against the auth URL and listen on a localhost callback).
// For smoke purposes the hooks return null sessions and the
// promptAsync calls resolve to a `cancel` result.

const noopUnsub = {remove() {}};

function makeRequest() {
  return {
    promptAsync: () => Promise.resolve({type: 'cancel'}),
    url: null,
    state: null,
    clientId: null,
    redirectUri: null,
    responseType: null,
    scopes: [],
  };
}

function useAuthRequest(_config, _discovery) {
  return [makeRequest(), null, () => Promise.resolve({type: 'cancel'})];
}

function useAutoDiscovery(_issuer) {
  return null;
}

const Providers = {
  Google: {useAuthRequest, useIdTokenAuthRequest: useAuthRequest},
  Facebook: {useAuthRequest},
  Apple: {useAuthRequest},
  Github: {useAuthRequest},
  Azure: {useAuthRequest},
  Slack: {useAuthRequest},
  Spotify: {useAuthRequest},
  Discord: {useAuthRequest},
  Twitch: {useAuthRequest},
};

Object.defineProperty(module.exports, '__esModule', {value: true});
module.exports.useAuthRequest = useAuthRequest;
module.exports.useIdTokenAuthRequest = useAuthRequest;
module.exports.useAutoDiscovery = useAutoDiscovery;
module.exports.makeRedirectUri = function (opts) {
  return (opts && opts.scheme ? opts.scheme + ':/' : 'rn-linux:/') + '/redirect';
};
module.exports.exchangeCodeAsync = () => Promise.resolve({accessToken: null});
module.exports.refreshAsync = () => Promise.resolve({accessToken: null});
module.exports.revokeAsync = () => Promise.resolve(true);
module.exports.fetchDiscoveryAsync = () => Promise.resolve(null);
module.exports.fetchUserInfoAsync = () => Promise.resolve(null);
module.exports.startAsync = () => Promise.resolve({type: 'cancel'});
module.exports.dismiss = () => {};
module.exports.maybeCompleteAuthSession = function () {
  return {type: 'cancel'};
};
module.exports.AuthSession = {
  startAsync: () => Promise.resolve({type: 'cancel'}),
  dismiss: () => {},
};
module.exports.ResponseType = {Code: 'code', Token: 'token', IdToken: 'id_token'};
module.exports.CodeChallengeMethod = {S256: 'S256', Plain: 'plain'};
module.exports.Prompt = {
  Login: 'login',
  None: 'none',
  Consent: 'consent',
  SelectAccount: 'select_account',
};
module.exports.TokenResponse = function (props) {
  Object.assign(this, props || {});
};
module.exports.AuthRequest = function () {};
module.exports.DiscoveryDocument = function () {};
module.exports.AccessTokenRequest = function () {};
module.exports.RefreshTokenRequest = function () {};
module.exports.RevokeTokenRequest = function () {};
module.exports.Providers = Providers;
