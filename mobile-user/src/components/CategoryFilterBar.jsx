import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { request } from '../api/client';
import { useAppTheme } from '../theme/ThemeContext';
import { Text } from './ui';

/**
 * Category filters for customers (Developer Guide §9): Size and Colour for clothing, RAM and Storage for
 * phones, and so on, exactly as Admin marked them "customer filter" for the category. Only option fields
 * (dropdown / multi-select / yes-no) are offered as tap-to-filter chips.
 *   value: { code: [optionValue, …] }
 */
export default function CategoryFilterBar({ categoryId, value, onChange }) {
  const theme = useAppTheme();
  const [filters, setFilters] = useState([]);
  const [open, setOpen] = useState(null); // the filter being edited

  useEffect(() => {
    setFilters([]);
    if (!categoryId) return undefined;
    let cancelled = false;
    request(`/api/catalog/filters?category=${encodeURIComponent(categoryId)}`)
      .then(({ ok, body }) => {
        if (cancelled || !ok) return;
        const list = (body?.data?.filters || []).map((f) => (f.fieldType === 'boolean' ? { ...f, options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] } : f));
        setFilters(list.filter((f) => f.options?.length));
      })
      .catch(() => { /* filters are optional; the list still shows */ });
    return () => { cancelled = true; };
  }, [categoryId]);

  if (!filters.length) return null;
  const active = Object.values(value || {}).reduce((n, list) => n + (list?.length || 0), 0);
  const toggle = (code, optionValue) => {
    const current = new Set(value?.[code] || []);
    if (current.has(optionValue)) current.delete(optionValue); else current.add(optionValue);
    onChange({ ...(value || {}), [code]: [...current] });
  };

  return (
    <View style={{ marginBottom: 10 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
        {active ? (
          <Pressable onPress={() => onChange({})} style={[styles.chip, { borderColor: theme.border }]} accessibilityRole="button">
            <Text style={styles.chipText}>Clear ({active})</Text>
          </Pressable>
        ) : null}
        {filters.map((f) => {
          const count = value?.[f.code]?.length || 0;
          return (
            <Pressable key={f.code} onPress={() => setOpen(f)} accessibilityRole="button" accessibilityLabel={`Filter by ${f.label}`}
              style={[styles.chip, { borderColor: count ? theme.primary : theme.border, backgroundColor: count ? theme.primaryLight : '#fff' }]}>
              <Text style={[styles.chipText, count ? { color: theme.primary } : null]}>{f.label}{count ? ` · ${count}` : ''} ▾</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(null)} accessibilityLabel="Close filter" />
        {open ? (
          <View style={styles.sheet}>
            <Text style={{ fontSize: 16, fontWeight: '800', marginBottom: 12 }}>{open.label}</Text>
            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {open.options.map((o) => {
                const on = (value?.[open.code] || []).includes(o.value);
                return (
                  <Pressable key={o.value} onPress={() => toggle(open.code, o.value)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                    style={[styles.option, { borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.primaryLight : '#fff' }]}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: on ? theme.primary : '#334155' }}>{on ? '✓ ' : ''}{o.label}{open.unit && open.fieldType !== 'boolean' ? ` ${open.unit}` : ''}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable onPress={() => setOpen(null)} style={[styles.done, { backgroundColor: theme.primary }]} accessibilityRole="button">
              <Text style={{ color: '#fff', fontWeight: '800' }}>Show results</Text>
            </Pressable>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, minHeight: 34, justifyContent: 'center' },
  chipText: { fontSize: 12.5, fontWeight: '700', color: '#334155' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  option: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, minHeight: 38, justifyContent: 'center' },
  done: { marginTop: 16, borderRadius: 12, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
});
