import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

// A seller's product video on the product page (MP4 on Bulkimart's server). Never autoplays:
// the customer taps play in the native controls, so no mobile data is used until they choose to watch.
export default function ProductVideoPlayer({ uri, label }) {
  const player = useVideoPlayer({ uri }, (p) => { p.loop = false; p.muted = false; });
  return (
    <View style={styles.box}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls
        fullscreenOptions={{ enable: true }} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '88%', aspectRatio: 1, backgroundColor: '#000', borderRadius: 12, overflow: 'hidden' },
});
