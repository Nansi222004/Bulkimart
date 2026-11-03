import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from './AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme';

// One short message at a time, at the top of the screen. Errors stay longer.
const ToastContext = createContext({ show: () => {} });
export const useToast = () => useContext(ToastContext);

const TONES = {
  info: { bg: colors.deepBlue, fg: colors.white },
  success: { bg: '#166534', fg: colors.white },
  error: { bg: '#991b1b', fg: colors.white },
};

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const insets = useSafeAreaInsets();

  const show = useCallback((message, tone = 'info') => {
    if (!message) return;
    clearTimeout(timer.current);
    setToast({ message: String(message), tone });
    timer.current = setTimeout(() => setToast(null), tone === 'error' ? 6000 : 3500);
  }, []);

  const value = useMemo(() => ({ show }), [show]);
  const palette = TONES[toast?.tone] || TONES.info;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <Pressable onPress={() => setToast(null)} accessibilityRole="alert" accessibilityLiveRegion="polite"
          style={[styles.toast, { top: insets.top + spacing.sm, backgroundColor: palette.bg }]}>
          <Text style={[styles.text, { color: palette.fg }]}>{toast.message}</Text>
        </Pressable>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  toast: { position: 'absolute', left: spacing.lg, right: spacing.lg, borderRadius: radius.md, padding: spacing.md, elevation: 6, zIndex: 100 },
  text: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
});
