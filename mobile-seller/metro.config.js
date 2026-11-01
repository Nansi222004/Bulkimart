const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// Standalone app: Metro only watches this folder, never mobile-user/ or the web app.
module.exports = mergeConfig(getDefaultConfig(__dirname), {});
