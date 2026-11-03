// Date input for service forms: Day / Month / Year pickers (the app's bottom-sheet SelectField),
// so no native date-picker module is needed. Emits 'YYYY-MM-DD' — the format the backend validates
// (backend/services/serviceForms.service.js) — or '' until all three parts are chosen.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import SelectField from './SelectField';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');
const daysIn = (year, month) => new Date(Number(year) || 2000, Number(month) || 1, 0).getDate(); // leap-year aware

const parse = value => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return m ? { year: m[1], month: String(Number(m[2])), day: String(Number(m[3])) } : { year: '', month: '', day: '' };
};

/**
 * `pastOnly` (e.g. date of birth) limits years to the current year and earlier.
 */
export default function DateField({ value, onChange, disabled, pastOnly = false }) {
  const [parts, setParts] = useState(() => parse(value));
  useEffect(() => { if (value) setParts(parse(value)); }, [value]);

  const now = new Date().getFullYear();
  const lastYear = pastOnly ? now : now + 10;
  const years = Array.from({ length: lastYear - (now - 120) + 1 }, (_, i) => String(lastYear - i));
  const maxDay = daysIn(parts.year, parts.month);
  const days = Array.from({ length: maxDay }, (_, i) => String(i + 1));

  const update = patch => {
    const next = { ...parts, ...patch };
    // Keep the day valid when month/year change (e.g. 31 → Feb).
    if (next.day && Number(next.day) > daysIn(next.year, next.month)) next.day = String(daysIn(next.year, next.month));
    setParts(next);
    onChange(next.year && next.month && next.day ? `${next.year}-${pad(next.month)}-${pad(next.day)}` : '');
  };

  return <View style={styles.row}>
    <SelectField style={styles.day} value={parts.day} disabled={disabled} placeholder="Day" onChange={day => update({ day })}
      options={days.map(d => ({ value: d, label: d }))} />
    <SelectField style={styles.month} value={parts.month} disabled={disabled} placeholder="Month" onChange={month => update({ month })}
      options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
    <SelectField style={styles.year} value={parts.year} disabled={disabled} placeholder="Year" onChange={year => update({ year })}
      options={years.map(y => ({ value: y, label: y }))} />
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  day: { flex: 1 },
  month: { flex: 1.3 },
  year: { flex: 1.3 },
});
