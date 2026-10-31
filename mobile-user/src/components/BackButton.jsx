// The round back button used on full-screen customer pages (web .pd-back-btn).
import React from 'react';
import { Pressable } from 'react-native';
import { ChevronLeft } from './icons';
import { useAppTheme } from '../theme/ThemeContext';

export default function BackButton({ onPress, label = 'Go back', color, style }) {
  const theme = useAppTheme();
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
    style={[{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }, style]}>
    <ChevronLeft size={20} width={2.5} color={color || theme.textPrimary} />
  </Pressable>;
}
