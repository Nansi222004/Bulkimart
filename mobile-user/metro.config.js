// Metro config for `react-native start`. Expo's defaults are kept because expo-router and the
// Expo modules need them (route discovery, asset handling, the native entry point).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Keep native build output out of Metro's file watcher. android/app/build alone is >1 GB and made
// the watcher time out on Windows ("Failed to start watch mode").
const ignored = [
  /[\\/]android[\\/](app[\\/])?build[\\/].*/,
  /[\\/]android[\\/]\.gradle[\\/].*/,
  /[\\/]\.cxx[\\/].*/,
  /[\\/]node_modules[\\/][^\\/]+[\\/]android[\\/]build[\\/].*/,
  new RegExp(`^${__dirname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\\\/]dist[\\\\/].*`),
];
const existing = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...ignored];

module.exports = config;
