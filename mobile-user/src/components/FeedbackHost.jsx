// Native rendering of the web FeedbackProvider: toasts at the top, one confirmation dialog at a time.
import React, { useEffect, useSyncExternalStore } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { feedback } from '../lib/feedback';
import { on, EVENTS } from '../lib/events';
import { Text } from './ui';

const ICON = { success: '✓', error: '!', warning: '⚠', info: 'i' };
const LABEL = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Information' };
const EDGE = { success: '#15803d', error: '#b91c1c', warning: '#a16207', info: '#073b78' };

export default function FeedbackHost() {
  const state = useSyncExternalStore(feedback.subscribe, feedback.getSnapshot, feedback.getSnapshot);
  const insets = useSafeAreaInsets();
  // A dialog or toast never outlives the session that opened it.
  useEffect(() => on(EVENTS.SESSION_CHANGED, () => feedback.clear()), []);
  useEffect(() => {
    const timers = state.toasts.filter(item => item.expires).map(item => setTimeout(() => feedback.dismiss(item.id), Math.max(0, item.expires - Date.now())));
    return () => timers.forEach(clearTimeout);
  }, [state.toasts]);
  const request = state.dialog;
  return <>
    {state.toasts.length > 0 && <View pointerEvents="box-none" style={[styles.toasts, { top: Math.max(12, insets.top) }]}>
      {state.toasts.map(item => <View key={item.id} style={[styles.toast, { borderLeftColor: EDGE[item.type] }]} accessibilityRole={item.type === 'error' ? 'alert' : 'text'} accessibilityLiveRegion="polite">
        <Text style={styles.toastIcon}>{ICON[item.type]}</Text>
        <View style={{ flex: 1 }}><Text style={styles.toastTitle}>{LABEL[item.type]}</Text><Text style={styles.toastText}>{item.message}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss notification" style={styles.toastClose} onPress={() => feedback.dismiss(item.id)}><Text style={{ fontSize: 22, color: '#172b4d' }}>×</Text></Pressable>
      </View>)}
    </View>}
    <Modal visible={Boolean(request)} transparent animationType="fade" statusBarTranslucent onRequestClose={() => feedback.cancel()}>
      {request && <KeyboardAvoidingView behavior="height" style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => feedback.cancel()} />
        <View style={styles.dialog} accessibilityRole="alert" accessibilityViewIsModal>
          <Text style={styles.title}>{request.title || 'Please confirm'}</Text>
          <Text style={styles.message}>{request.message}</Text>
          {request.input && <View style={{ marginTop: 12 }}>
            <Text style={styles.inputLabel}>{request.inputLabel || 'Details'}{request.required === false ? ' (optional)' : ''}</Text>
            <TextInput multiline numberOfLines={3} maxLength={request.maxLength || 2000} value={request.value} editable={!request.busy} autoFocus
              onChangeText={value => feedback.change(value)} style={styles.textarea} textAlignVertical="top" />
          </View>}
          {request.error ? <Text style={styles.error} accessibilityRole="alert">{request.error}</Text> : null}
          {request.busy ? <Text style={{ marginTop: 10, color: '#475569' }}>Working… Please wait.</Text> : null}
          <View style={styles.actions}>
            <Pressable disabled={request.busy} onPress={() => feedback.cancel()} style={[styles.action, request.busy && styles.disabled]} accessibilityRole="button"><Text style={styles.actionText}>{request.cancelLabel || 'Cancel'}</Text></Pressable>
            <Pressable disabled={request.busy} onPress={() => void feedback.accept()} accessibilityRole="button"
              style={[styles.action, request.destructive ? styles.destructive : styles.primary, request.busy && styles.disabled]}>
              <Text style={[styles.actionText, { color: '#fff' }]}>{request.busy ? 'Working…' : request.confirmLabel || 'Continue'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>}
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  toasts: { position: 'absolute', left: 12, right: 12, zIndex: 21000, elevation: 30, gap: 8 },
  toast: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderWidth: 1, borderColor: '#cbd5e1', borderLeftWidth: 4, borderRadius: 12, backgroundColor: '#fff', shadowColor: '#0f172a', shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  toastIcon: { fontWeight: '800', fontSize: 20, color: '#172b4d' },
  toastTitle: { fontWeight: '700', fontSize: 14, color: '#172b4d' },
  toastText: { marginTop: 4, fontSize: 14, lineHeight: 21, color: '#172b4d' },
  toastClose: { minWidth: 44, minHeight: 44, borderRadius: 8, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', alignItems: 'center', justifyContent: 'center', padding: 12 },
  dialog: { width: '100%', maxWidth: 480, padding: 22, borderRadius: 20, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '700', color: '#172b4d', marginBottom: 12 },
  message: { fontSize: 15, lineHeight: 24, color: '#172b4d' },
  inputLabel: { fontWeight: '600', marginBottom: 8, color: '#172b4d' },
  textarea: { minHeight: 80, padding: 12, borderWidth: 1, borderColor: '#94a3b8', borderRadius: 10, fontSize: 16, color: '#172b4d' },
  error: { marginTop: 12, padding: 12, borderWidth: 1, borderColor: '#fecaca', borderRadius: 10, backgroundColor: '#fff1f2', color: '#991b1b' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  action: { flex: 1, minHeight: 46, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center' },
  actionText: { fontWeight: '700', color: '#172b4d', fontSize: 15, textAlign: 'center' },
  primary: { backgroundColor: '#073b78', borderColor: '#073b78' },
  destructive: { backgroundColor: '#b91c1c', borderColor: '#b91c1c' },
  disabled: { opacity: 0.65 },
});
