import { useState, useEffect, useRef, useCallback } from 'react';
import { cleanVoiceQuery } from '../utils/voiceUtils';

/**
 * Custom Hook for Voice Search with Audio Amplification for Fragile/Quiet Voices.
 * 
 * Features:
 * - Web Audio API GainNode amplification (up to 3x) for low-volume input.
 * - RMS Volume Analyser (0..100) for real-time visual sound level feedback.
 * - Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 * - Multi-language support ('hi-IN' Hindi, 'en-IN' English).
 * - Safe interim transcript capture to ensure quiet voice cutoffs aren't dropped.
 */
export const useVoiceSearch = (options = {}) => {
  const {
    initialLang = 'en-IN',
    silenceTimeoutMs = 3200,
    gainMultiplier = 2.5,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [volume, setVolume] = useState(0); // 0 to 100
  const [error, setError] = useState(null);
  const [lang, setLang] = useState(initialLang);

  const recognitionRef = useRef(null);
  const audioCtxRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const animFrameRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const lastInterimRef = useRef('');

  // Check if browser supports Web Speech API
  const isSupported = typeof window !== 'undefined' && 
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  // Clean up AudioContext & MediaStream
  const cleanupAudio = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setVolume(0);
  }, []);

  // Clear silence timer
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // Reset silence timer
  const resetSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      stopListening();
    }, silenceTimeoutMs);
  }, [clearSilenceTimer, silenceTimeoutMs]);

  // Start audio analyzer & gain booster for delicate voice capture
  const setupAudioAmplifier = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      const ctx = new AudioContextClass();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      
      // Dynamic Gain Booster for weak/whispered input
      const gainNode = ctx.createGain();
      gainNode.gain.value = gainMultiplier;

      // RMS Sound Level Analyser
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;

      source.connect(gainNode);
      gainNode.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateVolume = () => {
        if (!mediaStreamRef.current) return;
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        // Scale 0..255 to 0..100
        const scaledVol = Math.min(100, Math.round((average / 128) * 100));
        setVolume(scaledVol);

        animFrameRef.current = requestAnimationFrame(updateVolume);
      };

      updateVolume();
    } catch (err) {
      console.warn('[useVoiceSearch] Web Audio amplifier unavailable:', err?.message || err);
    }
  }, [gainMultiplier]);

  // Stop recognition & audio
  const stopListening = useCallback(() => {
    clearSilenceTimer();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* ignore if already stopped */
      }
    }
    cleanupAudio();
    setIsListening(false);
  }, [clearSilenceTimer, cleanupAudio]);

  // Start listening
  const startListening = useCallback(() => {
    if (!isSupported) {
      setError('Voice recognition is not supported on this browser.');
      return;
    }

    setError(null);
    setTranscript('');
    setInterimTranscript('');
    lastInterimRef.current = '';

    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionClass();
    recognitionRef.current = recognition;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.lang = lang;

    recognition.onstart = () => {
      setIsListening(true);
      setupAudioAmplifier();
      resetSilenceTimer();
    };

    recognition.onresult = (event) => {
      resetSilenceTimer();
      let finalStr = '';
      let interimStr = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript || '';
        if (result.isFinal) {
          finalStr += text + ' ';
        } else {
          interimStr += text + ' ';
        }
      }

      if (finalStr.trim()) {
        setTranscript((prev) => (prev + ' ' + finalStr).trim());
        lastInterimRef.current = '';
        setInterimTranscript('');
      } else if (interimStr.trim()) {
        lastInterimRef.current = interimStr.trim();
        setInterimTranscript(interimStr.trim());
      }
    };

    recognition.onerror = (event) => {
      console.warn('[useVoiceSearch] Speech recognition error:', event.error);
      if (event.error === 'no-speech') {
        setError('No speech detected. Please speak louder or closer to the microphone.');
      } else if (event.error === 'not-allowed') {
        setError('Microphone access denied. Please allow microphone permission in your browser.');
        stopListening();
      } else if (event.error === 'network') {
        setError('Network error during voice recognition. Please check your connection.');
        stopListening();
      } else {
        setError(`Voice search error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      clearSilenceTimer();
      cleanupAudio();
      setIsListening(false);

      // If user stopped speaking fragilely, fallback to the last interim text if final transcript is empty
      if (lastInterimRef.current && !transcript) {
        setTranscript(lastInterimRef.current);
      }
    };

    try {
      recognition.start();
    } catch (err) {
      console.error('[useVoiceSearch] Start failed:', err);
      setError('Could not start voice recognition.');
      setIsListening(false);
    }
  }, [isSupported, lang, setupAudioAmplifier, resetSilenceTimer, stopListening, clearSilenceTimer, cleanupAudio, transcript]);

  const resetTranscript = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
    lastInterimRef.current = '';
    setError(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearSilenceTimer();
      cleanupAudio();
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }
    };
  }, [clearSilenceTimer, cleanupAudio]);

  const cleanedQuery = cleanVoiceQuery(transcript || interimTranscript);

  return {
    isListening,
    transcript,
    interimTranscript,
    cleanedQuery,
    volume,
    error,
    lang,
    setLang,
    startListening,
    stopListening,
    resetTranscript,
    isSupported,
  };
};

export default useVoiceSearch;
