// Coloured title bar for pages opened from the Account menu (Help & Support, Privacy Policy).
// Back returns to the previous screen, or to Account when the page was opened directly (deep link).
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Line, Polyline } from 'react-native-svg';
import { Text } from './ui';
import { useAppTheme } from '../theme/ThemeContext';

export const goBackToAccount = () => (router.canGoBack() ? router.back() : router.replace('/account'));

export default function AccountPageHeader({ title }) {
  const theme = useAppTheme();
  return <LinearGradient colors={[theme.header, theme.header]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.head}>
    <Pressable onPress={goBackToAccount} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={{ padding: 4, marginRight: 12 }}>
      <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <Line x1="19" y1="12" x2="5" y2="12" /><Polyline points="12 19 5 12 12 5" />
      </Svg>
    </Pressable>
    <Text accessibilityRole="header" style={styles.title}>{title}</Text>
  </LinearGradient>;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 20, elevation: 4 },
  title: { fontSize: 18, fontWeight: '800', color: '#fff', flex: 1 },
});
