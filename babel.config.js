// Inlines the GitHub Pages subpath (app.json `expo.extra.webBasePath`, e.g.
// '/muhafiz') into the web bundle. SDK 58's CLI never wires EXPO_BASE_URL
// itself, but expo-router's web routing reads that var to strip/prepend the
// base path. Web-only: native deep links must not be base-path-prefixed.
//
// The value is passed as a plugin OPTION (not read from process.env) so
// Metro's transform cache key changes whenever the base path changes.
// EXPO_BASE_URL overrides app.json, e.g. for local subpath testing.

const appJson = require('./app.json');

const basePath =
  process.env.EXPO_BASE_URL || (appJson?.expo?.extra?.webBasePath ?? '');

function defineExpoBaseUrl({ types: t }) {
  const literal = t.stringLiteral(basePath);
  return {
    visitor: {
      MemberExpression(path) {
        const { object, property } = path.node;
        if (
          t.isMemberExpression(object) &&
          t.isIdentifier(object.object, { name: 'process' }) &&
          t.isIdentifier(object.property, { name: 'env' }) &&
          t.isIdentifier(property, { name: 'EXPO_BASE_URL' })
        ) {
          path.replaceWith(t.cloneNode(literal, true));
        }
      },
    },
  };
}

module.exports = function (api) {
  const isWeb = api.caller((caller) => Boolean(caller && caller.platform === 'web'));
  const plugins = [];
  if (isWeb) {
    plugins.push([defineExpoBaseUrl, { basePath }]);
  }
  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};
