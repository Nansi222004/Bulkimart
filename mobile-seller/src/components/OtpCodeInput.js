/**
 * Segmented OTP input: N boxes drawn over one real (invisible) TextInput, so
 * typing, deleting, long-press paste, the keyboard's SMS suggestion and
 * SMS Retriever autofill all go through a single field.
 *
 * Keep identical in mobile-user, mobile-seller and mobile-delivery; colours
 * come in through props.
 */
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

/** Pasted "Your code is 482913" or "482 913" → "482913". */
export function sanitizeOtp(text, length) {
  const raw = String(text ?? '');
  const exact = (raw.match(/\d+/g) || []).find((run) => run.length === length);
  return (exact || raw.replace(/\D/g, '')).slice(0, length);
}

const OtpCodeInput = forwardRef(function OtpCodeInput({
  value,
  onChange,
  length = 6,
  error = false,
  editable = true,
  autoFocus = false,
  onSubmitEditing,
  accentColor = '#078ccb',
  textColor = '#0f172a',
  borderColor = '#cbd5e1',
  errorColor = '#ef4444',
  fontFamily,
}, ref) {
  const input = useRef(null);
  const [focused, setFocused] = useState(false);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus(), blur: () => input.current?.blur() }), []);

  const code = String(value ?? '');
  const active = Math.min(code.length, length - 1);

  return (
    <Pressable onPress={() => input.current?.focus()} disabled={!editable} style={styles.row}
      accessible={false} importantForAccessibility="no">
      {Array.from({ length }, (_, i) => {
        const filled = i < code.length;
        const isActive = focused && editable && i === active;
        return (
          <View key={i} importantForAccessibility="no-hide-descendants"
            style={[styles.box, { borderColor: error ? errorColor : isActive ? accentColor : borderColor },
              isActive && styles.boxActive, filled && styles.boxFilled, !editable && styles.boxDisabled]}>
            <Text maxFontSizeMultiplier={1.2} style={[styles.digit, { color: textColor }, fontFamily ? { fontFamily } : null]}>
              {code[i] || ''}
            </Text>
          </View>
        );
      })}
      <TextInput
        ref={input}
        value={code}
        onChangeText={(text) => onChange(sanitizeOtp(text, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmitEditing}
        editable={editable}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        returnKeyType="done"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        importantForAutofill="yes"
        caretHidden
        selectTextOnFocus={false}
        style={styles.hiddenInput}
        accessibilityLabel={`${length}-digit verification code`}
        accessibilityHint="Enter, paste or autofill the code from the SMS"
      />
    </Pressable>
  );
});

export default OtpCodeInput;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 8, width: '100%' },
  box: { flex: 1, maxWidth: 52, height: 54, borderWidth: 1.5, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' },
  boxActive: { borderWidth: 2 },
  boxFilled: { backgroundColor: '#f8fafc' },
  boxDisabled: { opacity: 0.6 },
  digit: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  // Covers the boxes so taps and long-press "Paste" land on the real input.
  hiddenInput: { ...StyleSheet.absoluteFillObject, color: 'transparent', backgroundColor: 'transparent', opacity: 0.015, fontSize: 1 },
});
