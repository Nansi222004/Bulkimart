const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// Standalone app: Metro only watches this folder, never the other apps or the web portal.
module.exports = mergeConfig(getDefaultConfig(__dirname), {});
