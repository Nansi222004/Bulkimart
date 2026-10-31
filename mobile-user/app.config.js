// Build-time additions to app.json. The Google Maps key is a public Android client key (it ends up in
// AndroidManifest.xml); it is read from the build environment so it is not duplicated in source.
const mapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY || '';

module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...config.plugins,
    ['react-native-maps', { androidGoogleMapsApiKey: mapsKey }],
  ],
  extra: { ...config.extra, mapsConfigured: Boolean(mapsKey) },
});
