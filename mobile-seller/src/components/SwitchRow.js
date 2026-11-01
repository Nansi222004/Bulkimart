import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { colors, spacing, type } from '../theme';

export default function SwitchRow({ label, hint, value, onValueChange, disabled }) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={type.label}>{label}</Text>
        {hint ? <Text style={type.small}>{hint}</Text> : null}
      </View>
      <Switch accessibilityLabel={label} value={!!value} onValueChange={onValueChange} disabled={disabled}
        trackColor={{ true: colors.primary, false: colors.border }} thumbColor={value ? colors.primaryDark : colors.white} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48 },
  text: { flex: 1, gap: 2 },
});
