import React, { useEffect } from 'react';
import useVoiceSearch from '../../../hooks/useVoiceSearch';
import './VoiceSearchModal.css';

/**
 * VoiceSearchModal Component
 * Fullscreen / Bottom-sheet voice input modal with real-time VU meter ripple feedback,
 * language selector, and fragile voice capture feedback.
 */
const VoiceSearchModal = ({ isOpen, onClose, onSearch }) => {
  const {
    isListening,
    transcript,
    interimTranscript,
    cleanedQuery,
    volume,
    error,
    startListening,
    stopListening,
    resetTranscript,
    isSupported,
  } = useVoiceSearch({ initialLang: 'en-IN' });

  // Auto start listening when modal opens
  useEffect(() => {
    if (isOpen) {
      resetTranscript();
      startListening();
    } else {
      stopListening();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleApplySearch = () => {
    const finalQuery = cleanedQuery || transcript || interimTranscript;
    if (finalQuery.trim()) {
      stopListening();
      onSearch(finalQuery.trim());
      onClose();
    }
  };

  const handleToggleMic = () => {
    if (isListening) {
      stopListening();
    } else {
      resetTranscript();
      startListening();
    }
  };

  // Scale volume for ripple animation ring (1.0 to 1.6)
  const ringScale = 1 + (volume / 100) * 0.6;
  const pulseOpacity = 0.3 + (volume / 100) * 0.7;

  return (
    <div className="voice-modal-overlay" onClick={() => { stopListening(); onClose(); }}>
      <div className="voice-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="voice-modal-header">
          <span className="voice-modal-title">Voice Search</span>
          <button type="button" className="voice-modal-close-btn" onClick={() => { stopListening(); onClose(); }} aria-label="Close voice search">
            ✕
          </button>
        </div>

        {/* Title */}
        <div className="voice-modal-body">
          <p className="voice-status-text">
            {!isSupported
              ? 'Voice search is not supported on this browser'
              : error
              ? error
              : isListening
              ? volume > 15
                ? 'Listening... Speak now'
                : 'Listening... (Speak softly or clearly)'
              : 'Tap microphone to start speaking'}
          </p>

          {/* Concentric Animated Voice Meter Button */}
          <div className="voice-mic-container">
            {isListening && (
              <>
                <div
                  className="voice-ripple-ring outer"
                  style={{
                    transform: `scale(${ringScale * 1.25})`,
                    opacity: pulseOpacity * 0.4,
                  }}
                />
                <div
                  className="voice-ripple-ring inner"
                  style={{
                    transform: `scale(${ringScale})`,
                    opacity: pulseOpacity,
                  }}
                />
              </>
            )}
            <button
              type="button"
              className={`voice-mic-btn ${isListening ? 'listening' : ''}`}
              onClick={handleToggleMic}
              aria-label={isListening ? 'Stop listening' : 'Start listening'}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
          </div>

          {/* Transcript Display Box */}
          <div className="voice-transcript-box">
            {transcript || interimTranscript ? (
              <>
                <span className="voice-text-final">{transcript}</span>
                <span className="voice-text-interim"> {interimTranscript}</span>
              </>
            ) : (
              <span className="voice-text-placeholder">
                {isListening ? 'Try saying "Aloo", "Milk", or "Amul Butter"...' : 'Tap mic and speak'}
              </span>
            )}
          </div>

          {/* Cleaned Query Preview Badge */}
          {cleanedQuery && cleanedQuery !== transcript && (
            <div className="voice-cleaned-preview">
              <span>Searching for: </span>
              <strong>"{cleanedQuery}"</strong>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="voice-modal-footer">
          {(transcript || interimTranscript) && (
            <button
              type="button"
              className="voice-action-btn secondary"
              onClick={resetTranscript}
            >
              Clear
            </button>
          )}

          <button
            type="button"
            className="voice-action-btn primary"
            disabled={!transcript && !interimTranscript && !cleanedQuery}
            onClick={handleApplySearch}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            Search Now
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoiceSearchModal;
