import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import AppInput from './AppInput';
import OptionPicker from './OptionPicker';
import SwitchRow from './SwitchRow';
import CategoryUploadField from './CategoryUploadField';
import { colors, radius, spacing, type } from '../theme';

/**
 * One Admin-configured category field (from GET /api/catalog/fields), drawn by its type. The same component
 * serves product details (Brand, Fabric, Expiry …) and per-variant options (Size, Colour, RAM …).
 * Image / file fields upload the picked photo or PDF straight away (CategoryUploadField).
 */
export default function CategoryField({ field, value, onChange, disabled }) {
  const label = `${field.label}${field.unit ? ` (${field.unit})` : ''}`;
  const hint = field.helpText || undefined;

  switch (field.fieldType) {
    case 'select':
      return (
        <OptionPicker label={label} required={field.required} disabled={disabled} value={value ?? ''}
          options={field.options.map((o) => ({ value: o.value, label: o.label }))} placeholder={`Select ${field.label.toLowerCase()}`}
          onChange={onChange} />
      );
    case 'multiselect': {
      const chosen = new Set(Array.isArray(value) ? value : []);
      const toggle = (v) => { const next = new Set(chosen); if (next.has(v)) next.delete(v); else next.add(v); onChange([...next]); };
      return (
        <View style={styles.wrap}>
          <Text style={type.label}>{label}{field.required ? ' *' : ''}</Text>
          <View style={styles.chips} accessibilityRole="list">
            {field.options.map((o) => {
              const on = chosen.has(o.value);
              return (
                <Pressable key={o.value} disabled={disabled} onPress={() => toggle(o.value)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                  style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{on ? '✓ ' : ''}{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {hint ? <Text style={type.small}>{hint}</Text> : null}
        </View>
      );
    }
    case 'boolean':
      return (
        <View style={styles.box}>
          <SwitchRow label={`${label}${field.required ? ' *' : ''}`} hint={hint} value={value === true} disabled={disabled} onValueChange={(v) => onChange(v)} />
        </View>
      );
    case 'number':
    case 'decimal':
      return (
        <AppInput label={label} required={field.required} hint={hint} keyboardType={field.fieldType === 'number' ? 'number-pad' : 'decimal-pad'}
          placeholder={field.placeholder || undefined} editable={!disabled} value={value === undefined || value === null ? '' : String(value)}
          onChangeText={(t) => onChange(t.replace(field.fieldType === 'number' ? /[^0-9-]/g : /[^0-9.-]/g, ''))} />
      );
    case 'date':
      return (
        <AppInput label={label} required={field.required} hint={hint || 'Format: YYYY-MM-DD, e.g. 2027-03-31'} placeholder="YYYY-MM-DD" maxLength={10}
          keyboardType="numbers-and-punctuation" editable={!disabled} value={value ?? ''} onChangeText={(t) => onChange(t.replace(/[^0-9-]/g, ''))} />
      );
    case 'longtext':
      return (
        <AppInput label={label} required={field.required} hint={hint} placeholder={field.placeholder || undefined} multiline
          maxLength={field.validation?.maxLength || 5000} editable={!disabled} value={value ?? ''} onChangeText={onChange} />
      );
    case 'image':
    case 'file':
      return <CategoryUploadField label={label} required={field.required} hint={hint} kind={field.fieldType} value={value} onChange={onChange} disabled={disabled} />;
    default:
      return (
        <AppInput label={label} required={field.required} hint={hint} placeholder={field.placeholder || undefined}
          maxLength={field.validation?.maxLength || 200} editable={!disabled} value={value ?? ''} onChangeText={onChange} />
      );
  }
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.white },
  chipOn: { borderColor: colors.primaryDark, backgroundColor: colors.aquaLight },
  chipText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  chipTextOn: { color: colors.primaryDark },
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 4 },
});
