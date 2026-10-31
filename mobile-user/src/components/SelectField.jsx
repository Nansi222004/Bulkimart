// Native replacement for the web's <select>: a field that opens a bottom sheet of options.
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useAppTheme } from '../theme/ThemeContext';
import { Sheet, Text } from './ui';
import { ChevronDown } from './icons';

export default function SelectField({ label, value, options, onChange, disabled, placeholder = 'Select', style, labelStyle }) {
  const theme = useAppTheme();
  const [open, setOpen] = useState(false);
  const current = options.find(option => String(option.value) === String(value));
  return <View style={style}>
    {label ? <Text style={[styles.label, labelStyle]}>{label}</Text> : null}
    <Pressable disabled={disabled} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={label ? `${label}: ${current?.label || placeholder}` : current?.label || placeholder}
      style={[styles.field, { borderColor: theme.border }, disabled && { opacity: 0.6 }]}>
      <Text numberOfLines={1} style={{ flex: 1, color: current ? theme.textPrimary : '#94a3b8', fontSize: 14 }}>{current?.label || placeholder}</Text>
      <ChevronDown size={16} color="#64748b" />
    </Pressable>
    <Sheet visible={open} onClose={() => setOpen(false)}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {label ? <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 10 }}>{label}</Text> : null}
        {options.map(option => {
          const selected = String(option.value) === String(value);
          return <Pressable key={String(option.value)} disabled={option.disabled} onPress={() => { setOpen(false); onChange(option.value); }}
            style={[styles.option, { borderColor: selected ? theme.primaryColor : theme.border, backgroundColor: selected ? theme.primaryLight : '#fff' }, option.disabled && { opacity: 0.5 }]}
            accessibilityRole="radio" accessibilityState={{ selected, disabled: !!option.disabled }}>
            <Text style={{ fontSize: 14, fontWeight: selected ? '700' : '400' }}>{option.label}</Text>
          </Pressable>;
        })}
      </ScrollView>
    </Sheet>
  </View>;
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  field: { minHeight: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 8 },
  option: { padding: 14, borderWidth: 1, borderRadius: 10, marginBottom: 8 },
});
