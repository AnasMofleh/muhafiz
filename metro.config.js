// Metro config: treat .wasm as an asset (needed by expo-sqlite's web worker,
// which fetches the wasm file by URL). Adding it to sourceExts would make
// Babel try to parse the binary and fail.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');

module.exports = config;
