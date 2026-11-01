import React, { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, type } from '../theme';

/**
 * Native select field: shows the current choice and opens a full-height list.
 * options: [{ value, label }]
 */
export default function OptionPicker({ label, value, options, placeholder = 'Select…', onChange, disabled, error, required }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => String(o.value) === String(value));
  return (
    <View style={styles.wrap}>
      {label ? <Text style={type.label}>{label}{required ? ' *' : ''}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`${label || 'Option'}: ${selected?.label || placeholder}`}
        accessibilityState={{ disabled }} onPress={disabled ? undefined : () => setOpen(true)}
        style={[styles.field, error && styles.fieldError, disabled && styles.disabled]}>
        <Text style={[styles.value, !selected && styles.placeholder]} numberOfLines={1}>{selected?.label || placeholder}</Text>
        <Text style={styles.caret}>▾</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={type.heading}>{label || 'Select'}</Text>
            <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.close}><Text style={styles.closeText}>Close</Text></Pressable>
          </View>
          <FlatList
            data={options}
            keyExtractor={(item) => String(item.value)}
            renderItem={({ item }) => {
              const active = String(item.value) === String(value);
              return (
                <Pressable accessibilityRole="radio" accessibilityState={{ checked: active }}
                  onPress={() => { onChange(item.value); setOpen(false); }} style={[styles.option, active && styles.optionActive]}>
                  <Text style={[type.body, active && styles.optionTextActive]}>{item.label}</Text>
                  {active ? <Text style={styles.check}>✓</Text> : null}
                </Pressable>
              );
            }}
            ListEmptyComponent={<Text style={[type.small, styles.empty]}>No options available.</Text>}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  field: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center' },
  fieldError: { borderColor: colors.error },
  disabled: { backgroundColor: colors.surface },
  value: { flex: 1, fontSize: 15, color: colors.text },
  placeholder: { color: colors.textMuted },
  caret: { color: colors.textSecondary, fontSize: 14 },
  error: { fontSize: 12, color: colors.error },
  sheet: { flex: 1, backgroundColor: colors.background },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  close: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.sm },
  closeText: { color: colors.primaryDark, fontWeight: '700' },
  option: { minHeight: 52, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  optionActive: { backgroundColor: colors.aquaLight },
  optionTextActive: { color: colors.primaryDark, fontWeight: '700' },
  check: { color: colors.primaryDark, fontWeight: '800' },
  empty: { padding: spacing.lg },
});
