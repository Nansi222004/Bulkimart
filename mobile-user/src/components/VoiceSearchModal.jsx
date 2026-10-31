// Port of VoiceSearchModal.jsx + hooks/useVoiceSearch.js with the platform speech recognizer
// (expo-speech-recognition) instead of webkitSpeechRecognition. Same flow: starts listening when opened,
// 3.2 s silence ends it, interim text is kept, the query is cleaned (utils/voiceUtils) before searching.
// The microphone permission is requested only when the customer opens voice search.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { cleanVoiceQuery } from '../lib/voiceUtils';
import { Text } from './ui';
import { useAppTheme } from '../theme/ThemeContext';
import { alpha } from '../theme';
import { useLaunchSplash } from './storefront/PromotionalSplash';

function useVoiceSearch({ lang = 'en-IN', silenceTimeoutMs = 3200 } = {}) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [volume, setVolume] = useState(0);
  const [error, setError] = useState(null);
  const [isSupported, setSupported] = useState(true);
  const silence = useRef(null);
  const lastInterim = useRef('');
  const active = useRef(false);

  const stopListening = useCallback(() => {
    clearTimeout(silence.current);
    if (active.current) { try { ExpoSpeechRecognitionModule.stop(); } catch { /* already stopped */ } }
    setVolume(0);
    setIsListening(false);
  }, []);
  const resetSilence = useCallback(() => {
    clearTimeout(silence.current);
    silence.current = setTimeout(() => stopListening(), silenceTimeoutMs);
  }, [silenceTimeoutMs, stopListening]);

  useSpeechRecognitionEvent('start', () => { active.current = true; setIsListening(true); resetSilence(); });
  useSpeechRecognitionEvent('end', () => {
    active.current = false;
    clearTimeout(silence.current);
    setVolume(0); setIsListening(false);
    if (lastInterim.current) setTranscript(prev => prev || lastInterim.current);
  });
  useSpeechRecognitionEvent('result', event => {
    resetSilence();
    const text = event.results?.[0]?.transcript || '';
    if (event.isFinal) {
      if (text.trim()) setTranscript(prev => (prev + ' ' + text).trim());
      lastInterim.current = ''; setInterimTranscript('');
    } else if (text.trim()) {
      lastInterim.current = text.trim(); setInterimTranscript(text.trim());
    }
  });
  useSpeechRecognitionEvent('volumechange', event => setVolume(Math.max(0, Math.min(100, Math.round((event.value / 10) * 100)))));
  useSpeechRecognitionEvent('error', event => {
    if (event.error === 'no-speech' || event.error === 'speech-timeout') setError('No speech detected. Please speak louder or closer to the microphone.');
    else if (event.error === 'not-allowed') { setError('Microphone access denied. Please allow microphone permission in your phone settings.'); stopListening(); }
    else if (event.error === 'network') { setError('Network error during voice recognition. Please check your connection.'); stopListening(); }
    else if (event.error !== 'aborted') setError(`Voice search error: ${event.error}`);
  });

  const startListening = useCallback(async () => {
    setError(null); setTranscript(''); setInterimTranscript(''); lastInterim.current = '';
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) { setSupported(false); setError('Voice recognition is not supported on this device.'); return; }
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) { setError('Microphone access denied. Please allow microphone permission in your phone settings.'); return; }
      ExpoSpeechRecognitionModule.start({ lang, interimResults: true, continuous: true, maxAlternatives: 3, volumeChangeEventOptions: { enabled: true, intervalMillis: 100 } });
    } catch {
      setError('Could not start voice recognition.');
      setIsListening(false);
    }
  }, [lang]);
  const resetTranscript = useCallback(() => { setTranscript(''); setInterimTranscript(''); lastInterim.current = ''; setError(null); }, []);
  useEffect(() => () => { clearTimeout(silence.current); if (active.current) { try { ExpoSpeechRecognitionModule.abort(); } catch { /* stopped */ } } }, []);
  return { isListening, transcript, interimTranscript, cleanedQuery: cleanVoiceQuery(transcript || interimTranscript), volume, error, startListening, stopListening, resetTranscript, isSupported };
}

const MicIcon = ({ size = 32, color = '#fff' }) => <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
  <Path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><Path d="M19 10v2a7 7 0 0 1-14 0v-2" /><Line x1="12" y1="19" x2="12" y2="23" /><Line x1="8" y1="23" x2="16" y2="23" />
</Svg>;

export default function VoiceSearchModal({ isOpen, onClose, onSearch }) {
  const launchSplash = useLaunchSplash();
  const open = isOpen && !launchSplash;
  const theme = useAppTheme();
  const voice = useVoiceSearch({ lang: 'en-IN' });
  const { isListening, transcript, interimTranscript, cleanedQuery, volume, error, startListening, stopListening, resetTranscript, isSupported } = voice;
  useEffect(() => {
    if (open) { resetTranscript(); startListening(); } else stopListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const close = () => { stopListening(); onClose(); };
  const apply = () => {
    const finalQuery = cleanedQuery || transcript || interimTranscript;
    if (finalQuery.trim()) { stopListening(); onSearch(finalQuery.trim()); onClose(); }
  };
  const toggle = () => { if (isListening) stopListening(); else { resetTranscript(); startListening(); } };
  const ringScale = 1 + (volume / 100) * 0.6, pulse = 0.3 + (volume / 100) * 0.7;
  return <Modal visible={open} transparent animationType="slide" statusBarTranslucent onRequestClose={close}>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>Voice Search</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close voice search" onPress={close} style={styles.close}><Text style={{ color: '#64748b', fontWeight: '700' }}>✕</Text></Pressable>
        </View>
        <Text style={styles.status}>{!isSupported ? 'Voice search is not supported on this device' : error ? error : isListening ? (volume > 15 ? 'Listening... Speak now' : 'Listening... (Speak softly or clearly)') : 'Tap microphone to start speaking'}</Text>
        <View style={styles.micWrap}>
          {isListening && <>
            <View style={[styles.ring, { backgroundColor: theme.focusRing, transform: [{ scale: ringScale * 1.25 }], opacity: pulse * 0.4 }]} />
            <View style={[styles.ring, { transform: [{ scale: ringScale }], opacity: pulse }]} />
          </>}
          <Pressable accessibilityRole="button" accessibilityLabel={isListening ? 'Stop listening' : 'Start listening'} onPress={toggle}
            style={[styles.mic, isListening && { backgroundColor: theme.action, shadowColor: theme.primary }]}><MicIcon /></Pressable>
        </View>
        <View style={styles.transcript}>
          {transcript || interimTranscript ? <Text style={{ fontSize: 15, textAlign: 'center' }}><Text style={styles.final}>{transcript}</Text><Text style={styles.interim}> {interimTranscript}</Text></Text>
            : <Text style={styles.placeholder}>{isListening ? 'Try saying "Aloo", "Milk", or "Amul Butter"...' : 'Tap mic and speak'}</Text>}
        </View>
        {cleanedQuery && cleanedQuery !== transcript ? <View style={styles.cleaned}><Text style={{ fontSize: 13, color: '#10b981' }}>Searching for: <Text style={{ fontWeight: '700', color: '#10b981' }}>"{cleanedQuery}"</Text></Text></View> : null}
        <View style={styles.footer}>
          {(transcript || interimTranscript) ? <Pressable onPress={resetTranscript} style={[styles.action, styles.secondary]}><Text style={{ color: '#475569', fontWeight: '700' }}>Clear</Text></Pressable> : null}
          <Pressable disabled={!transcript && !interimTranscript && !cleanedQuery} onPress={apply}
            style={[styles.action, (!transcript && !interimTranscript && !cleanedQuery) ? { backgroundColor: '#cbd5e1' } : { backgroundColor: '#10b981' }]}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={(!transcript && !interimTranscript && !cleanedQuery) ? '#94a3b8' : '#fff'} strokeWidth={2.5}><Circle cx="11" cy="11" r="8" /><Line x1="21" y1="21" x2="16.65" y2="16.65" /></Svg>
            <Text style={{ color: (!transcript && !interimTranscript && !cleanedQuery) ? '#94a3b8' : '#fff', fontWeight: '700' }}>Search Now</Text>
          </Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.75)', justifyContent: 'flex-end' },
  card: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 32, alignItems: 'center', gap: 16 },
  header: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  close: { backgroundColor: '#f1f5f9', width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  status: { fontSize: 14, fontWeight: '600', color: '#475569', minHeight: 20, textAlign: 'center' },
  micWrap: { width: 110, height: 110, alignItems: 'center', justifyContent: 'center', marginVertical: 12 },
  ring: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 55, backgroundColor: alpha('#10b981', 0.25) },
  mic: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#0f172a', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } },
  transcript: { width: '100%', minHeight: 64, backgroundColor: '#f8fafc', borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#cbd5e1', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  final: { fontWeight: '700', color: '#0f172a' },
  interim: { color: '#64748b', fontStyle: 'italic' },
  placeholder: { color: '#94a3b8', fontSize: 14, textAlign: 'center' },
  cleaned: { backgroundColor: '#ecfdf5', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#a7f3d0' },
  footer: { width: '100%', flexDirection: 'row', gap: 12 },
  action: { flex: 1, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondary: { backgroundColor: '#f1f5f9' },
});
