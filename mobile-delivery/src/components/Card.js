import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { colors, radius, spacing, type } from '../theme';

export default function Card({ title, right, children, onPress, style, accessibilityLabel }) {
  const content = (
    <>
      {(title || right) ? (
        <View style={styles.header}>
          {title ? <Text style={type.heading}>{title}</Text> : <View />}
          {right}
        </View>
      ) : null}
      {children}
    </>
  );
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || title} onPress={onPress}
        android_ripple={{ color: 'rgba(0,0,0,0.05)' }} style={[styles.card, style]}>
        {content}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{content}</View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
});
