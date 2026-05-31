'use strict';

// firebase modular SDK shim. Most apps reach for `firebase/app`,
// `firebase/auth`, `firebase/firestore`, `firebase/storage`. Each
// sub-path returns an interface with the bare functions apps expect
// at import + boot time; methods that talk to the network return
// rejected promises so apps surface their error UI instead of
// hanging on a pending fetch.

// firebase/app
function initializeApp(config) {
  return {options: config || {}, name: '[DEFAULT]', automaticDataCollectionEnabled: false};
}
function getApps() {
  return [];
}
function getApp(_name) {
  return {options: {}, name: '[DEFAULT]'};
}
function deleteApp() {
  return Promise.resolve();
}

// firebase/auth
function notReady(name) {
  return () => Promise.reject(new Error('firebase/' + name + ' not available on Linux'));
}
function getAuth(_app) {
  return {
    currentUser: null,
    onAuthStateChanged(cb) {
      cb(null);
      return () => {};
    },
    onIdTokenChanged(cb) {
      cb(null);
      return () => {};
    },
    signOut: () => Promise.resolve(),
  };
}
function initializeAuth(app, _persistence) {
  return getAuth(app);
}
function getReactNativePersistence() {
  return null;
}

// firebase/firestore
function getFirestore() {
  return {};
}
function collection() {
  return {};
}
function doc() {
  return {};
}
function getDocs() {
  return Promise.resolve({docs: [], empty: true, size: 0, forEach() {}});
}
function getDoc() {
  return Promise.resolve({exists: () => false, data: () => null, id: null});
}

// firebase/storage
function getStorage() {
  return {};
}
function ref() {
  return {fullPath: '', name: '', bucket: ''};
}
function uploadBytes() {
  return Promise.reject(new Error('firebase/storage not available on Linux'));
}
function getDownloadURL() {
  return Promise.reject(new Error('firebase/storage not available on Linux'));
}

// Each call to require('firebase/<x>') returns a different facet.
// We expose them all on the same module and let the bundle banner
// route by id.
const firebaseApp = {
  initializeApp,
  getApps,
  getApp,
  deleteApp,
  registerVersion() {},
  setLogLevel() {},
  default: undefined,
};
const firebaseAuth = {
  getAuth,
  initializeAuth,
  getReactNativePersistence,
  onAuthStateChanged: (auth, cb) => {
    cb(null);
    return () => {};
  },
  signInWithEmailAndPassword: notReady('auth.signInWithEmailAndPassword'),
  createUserWithEmailAndPassword: notReady('auth.createUserWithEmailAndPassword'),
  signInWithCredential: notReady('auth.signInWithCredential'),
  signOut: () => Promise.resolve(),
  SAMLAuthProvider: function () {},
  GoogleAuthProvider: function () {},
  FacebookAuthProvider: function () {},
  OAuthProvider: function () {},
  EmailAuthProvider: {credential: () => ({})},
  default: undefined,
};
const firebaseFirestore = {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc: () => Promise.resolve(),
  updateDoc: () => Promise.resolve(),
  deleteDoc: () => Promise.resolve(),
  addDoc: () => Promise.resolve({id: null}),
  query: () => ({}),
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  onSnapshot: () => () => {},
  default: undefined,
};
const firebaseStorage = {
  getStorage,
  ref,
  uploadBytes,
  uploadBytesResumable: notReady('storage.uploadBytesResumable'),
  getDownloadURL,
  deleteObject: () => Promise.resolve(),
  listAll: () => Promise.resolve({items: [], prefixes: []}),
  default: undefined,
};

function stamp(o) {
  Object.defineProperty(o, '__esModule', {value: true});
  return o;
}

module.exports = {
  app: stamp(firebaseApp),
  auth: stamp(firebaseAuth),
  firestore: stamp(firebaseFirestore),
  storage: stamp(firebaseStorage),
};
