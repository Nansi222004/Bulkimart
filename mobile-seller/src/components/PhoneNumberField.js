import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './AppText';
import { colors, radius, spacing, type } from '../theme';

/**
 * Indian mobile number field: fixed +91 prefix (the API accepts Indian numbers
 * only), editable 10-digit input and, where Google Play services is present,
 * a "Select number" button that opens the system Phone Number Hint picker.
 * The picked number is just a prefill — it is still verified by OTP.
 */
export default function PhoneNumberField({
  value,
  onChangeText,
  onFocus,
  onPickNumber,
  canPick = false,
  picking = false,
  editable = true,
  error,
  label = 'Mobile number',
  onSubmitEditing,
}) {
  return (
    <View style={styles.wrap}>
      <Text style={type.label}>{label}</Text>
      <View style={[styles.row, error && styles.rowError, !editable && styles.rowDisabled]}>
        <View style={styles.prefix} accessible accessibilityLabel="Country code India plus 91">
          <Text style={styles.prefixText}>IN +91</Text>
        </View>
        <TextInput
          value={value}
          onChangeText={(text) => onChangeText(text.replace(/\D/g, '').slice(0, 10))}
          onFocus={onFocus}
          onSubmitEditing={onSubmitEditing}
          editable={editable}
          placeholder="10-digit mobile number"
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
          maxLength={10}
          autoComplete="tel-national"
          textContentType="telephoneNumber"
          importantForAutofill="yes"
          returnKeyType="done"
          style={styles.input}
          accessibilityLabel={label}
        />
        {canPick && editable ? (
          <Pressable onPress={onPickNumber} disabled={picking} accessibilityRole="button"
            accessibilityLabel="Select phone number from this device" hitSlop={6} style={styles.pick}>
            {picking ? <ActivityIndicator size="small" color={colors.primaryDark} /> : <Text style={styles.pickText}>Select number</Text>}
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.white, overflow: 'hidden' },
  rowError: { borderColor: colors.error },
  rowDisabled: { backgroundColor: colors.surface },
  prefix: { alignSelf: 'stretch', justifyContent: 'center', paddingHorizontal: spacing.md, backgroundColor: colors.aquaLight, borderRightWidth: 1, borderRightColor: colors.border },
  prefixText: { fontSize: 14, fontWeight: '700', color: colors.deepBlue },
  input: { flex: 1, minWidth: 0, paddingHorizontal: spacing.md, fontSize: 15, color: colors.text },
  pick: { paddingHorizontal: spacing.md, alignSelf: 'stretch', justifyContent: 'center' },
  pickText: { fontSize: 13, fontWeight: '700', color: colors.primaryDark },
  error: { fontSize: 12, color: colors.error },
});
