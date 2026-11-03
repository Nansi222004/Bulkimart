import React, { forwardRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from './AppText';
import { colors, radius, spacing, type } from '../theme';

const AppInput = forwardRef(function AppInput({ label, error, hint, required, style, ...props }, ref) {
  return (
    <View style={[styles.wrap, style]}>
      {label ? <Text style={type.label}>{label}{required ? ' *' : ''}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, props.multiline && styles.multiline, error && styles.inputError, props.editable === false && styles.disabled]}
        accessibilityLabel={label}
        {...props}
      />
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : hint ? <Text style={type.small}>{hint}</Text> : null}
    </View>
  );
});

export default AppInput;

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, fontSize: 15, color: colors.text, backgroundColor: colors.white },
  multiline: { minHeight: 96, paddingTop: spacing.md, textAlignVertical: 'top' },
  inputError: { borderColor: colors.error },
  disabled: { backgroundColor: colors.surface, color: colors.textSecondary },
  error: { fontSize: 12, color: colors.error },
});
