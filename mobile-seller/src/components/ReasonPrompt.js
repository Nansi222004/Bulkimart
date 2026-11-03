import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import AppButton from './AppButton';
import AppInput from './AppInput';
import { colors, radius, spacing, type } from '../theme';

/**
 * Modal that collects one or more required text fields (for example a rejection
 * reason, or courier + AWB). fields: [{ key, label, placeholder, multiline }]
 */
export default function ReasonPrompt({ visible, title, message, fields, confirmLabel = 'Submit', busy, onCancel, onSubmit }) {
  const [values, setValues] = useState({});
  const [error, setError] = useState('');
  useEffect(() => { if (visible) { setValues({}); setError(''); } }, [visible]);

  const submit = () => {
    const missing = fields.find((field) => !String(values[field.key] || '').trim());
    if (missing) { setError(`${missing.label} is required`); return; }
    onSubmit(Object.fromEntries(fields.map((field) => [field.key, String(values[field.key]).trim()])));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? undefined : onCancel}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.sheet}>
          <Text style={type.heading}>{title}</Text>
          {message ? <Text style={type.small}>{message}</Text> : null}
          {fields.map((field, index) => (
            <AppInput key={field.key} label={field.label} placeholder={field.placeholder} multiline={field.multiline}
              autoFocus={index === 0} editable={!busy} value={values[field.key] || ''}
              onChangeText={(text) => setValues((current) => ({ ...current, [field.key]: text }))} />
          ))}
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <View style={styles.actions}>
            <AppButton title="Cancel" variant="outline" onPress={onCancel} disabled={busy} style={styles.flex} />
            <AppButton title={confirmLabel} onPress={submit} loading={busy} style={styles.flex} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: spacing.lg },
  sheet: { backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  error: { color: colors.error, fontSize: 13 },
});
