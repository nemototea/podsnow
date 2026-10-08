const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
const shims = {
  'expo-sqlite': path.resolve(__dirname, 'shims/expo-sqlite.js'),
  'expo-file-system': path.resolve(__dirname, 'shims/expo-file-system.js'),
  'expo-font': path.resolve(__dirname, 'shims/expo-font.js'),
};
config.resolver.resolveRequest = (ctx, name, platform) => {
  if (shims[name]) return { type: 'sourceFile', filePath: shims[name] };
  return ctx.resolveRequest(ctx, name, platform);
};
config.resolver.nodeModulesPaths = [path.resolve(process.env.PODSNOW_ROOT, 'node_modules')];
config.watchFolders = [path.resolve(process.env.PODSNOW_ROOT, 'node_modules')];
module.exports = config;
