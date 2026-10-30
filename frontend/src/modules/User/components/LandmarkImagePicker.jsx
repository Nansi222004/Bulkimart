import ModalPortal from '../../../components/ModalPortal';
import React, { useState, useRef, useEffect } from 'react';
import './LandmarkImagePicker.css';

/**
 * LandmarkImagePicker Component
 * End-to-end component for landmark image attachment with explicit choices:
 * 1. 📸 Take Photo (live camera preview and capture)
 * 2. 📁 Choose from Gallery / File Manager
 */
const LandmarkImagePicker = ({
  value,
  onChange,
  onUpload,
  disabled = false,
  label = 'Landmark Photo (Optional — Helps Delivery Riders)',
  sublabel = 'Upload a photo of your building entrance, gate, or house front for fast delivery.'
}) => {
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const [cameraStatus, setCameraStatus] = useState('closed');
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const cameraRequestRef = useRef(0);
  const galleryInputRef = useRef(null);

  const stopCamera = () => {
    cameraRequestRef.current++;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const closeModal = () => {
    stopCamera();
    setCameraStatus('closed');
    setCameraReady(false);
    setCapturing(false);
    setShowOptionsModal(false);
  };

  useEffect(() => {
    window.addEventListener('pagehide', closeModal);
    return () => {
      window.removeEventListener('pagehide', closeModal);
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (cameraStatus !== 'live' || !videoRef.current) return;
    const request = cameraRequestRef.current;
    videoRef.current.srcObject = streamRef.current;
    videoRef.current.play().catch(() => {
      if (request !== cameraRequestRef.current) return;
      stopCamera();
      setCameraStatus('closed');
      setError('Could not start the camera preview. Please try again.');
    });
  }, [cameraStatus]);

  const handleFilePicked = async (file) => {
    if (!file) return;
    try {
      setShowOptionsModal(false);
      setUploading(true);
      setError(null);
      const res = await onUpload(file);
      setUploading(false);
      if (res && res.ok && res.imageUrl) {
        onChange(res.imageUrl);
      } else {
        setError(res?.message || 'Could not upload landmark photo.');
      }
    } catch (err) {
      setUploading(false);
      setError(err?.message || 'Upload failed.');
    }
  };

  const onGalleryChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFilePicked(file);
    e.target.value = '';
  };

  const openCamera = async () => {
    stopCamera();
    const request = cameraRequestRef.current;
    setError(null);
    setCameraReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera is unavailable. Open the app over HTTPS and allow camera access.');
      return;
    }
    setCameraStatus('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      // A permission prompt can resolve after the user has closed this sheet.
      if (request !== cameraRequestRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      setCameraStatus('live');
    } catch (err) {
      if (request !== cameraRequestRef.current) return;
      setCameraStatus('closed');
      setError(err?.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access in app or browser settings and try again.'
        : 'Could not open the camera. Check that it is available and try again.');
    }
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (capturing || !video?.videoWidth || !video.videoHeight) return;
    const request = cameraRequestRef.current;
    setCapturing(true);
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (request !== cameraRequestRef.current) return;
      if (!blob) throw new Error('Could not capture the photo. Please try again.');
      closeModal();
      await handleFilePicked(new File([blob], 'landmark-photo.jpg', { type: 'image/jpeg' }));
    } catch (err) {
      if (request !== cameraRequestRef.current) return;
      setCapturing(false);
      setError(err?.message || 'Could not capture the photo. Please try again.');
    }
  };

  const openGallery = () => {
    if (galleryInputRef.current) {
      galleryInputRef.current.click();
    }
  };

  return (
    <div className="landmark-picker-container">
      <div className="landmark-picker-head">
        <label className="landmark-picker-label">
          <span>📸</span>
          <span>{label}</span>
        </label>
        {sublabel && <p className="landmark-picker-subtext">{sublabel}</p>}
      </div>

      {value ? (
        <div className="landmark-preview-card">
          <img src={value} alt="Landmark Preview" />
          <button
            type="button"
            className="landmark-remove-btn"
            onClick={() => onChange('')}
            title="Remove photo"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="landmark-upload-trigger-btn"
          disabled={disabled || uploading}
          onClick={() => { setError(null); setShowOptionsModal(true); }}
        >
          {uploading ? (
            <span>⏳ Uploading photo to Cloud...</span>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
              <span>Take Photo or Pick from Gallery</span>
            </>
          )}
        </button>
      )}

      {error && !showOptionsModal && <p className="landmark-picker-error" role="alert">⚠️ {error}</p>}

      {/* Choice Modal (Camera vs Gallery) */}
      {showOptionsModal && (
        <ModalPortal className="landmark-modal-overlay" onClick={closeModal} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); closeModal(); } }}>
          <div className="landmark-modal-sheet" onClick={(e) => e.stopPropagation()}>
            {/* Keep native pickers inside the modal: the app root is inert while it is open. */}
            <input ref={galleryInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onGalleryChange} />
            <div className="landmark-sheet-header">
              <h4>{cameraStatus === 'closed' ? 'Landmark Image Option' : 'Take Landmark Photo'}</h4>
              <button type="button" className="landmark-close-btn" aria-label="Close camera options" onClick={closeModal}>✕</button>
            </div>

            {error && <p className="landmark-picker-error" role="alert">⚠️ {error}</p>}
            {cameraStatus !== 'closed' ? (
              <>
                {cameraStatus === 'starting' ? <p role="status">Opening camera…</p> : (
                  <video ref={videoRef} className="landmark-camera-preview" autoPlay playsInline muted onLoadedData={() => setCameraReady(true)} />
                )}
                <button type="button" className="landmark-capture-btn" disabled={!cameraReady || capturing} onClick={capturePhoto}>
                  {capturing ? 'Capturing…' : 'Capture photo'}
                </button>
              </>
            ) : <>
            <p className="landmark-sheet-desc">
              Choose how you want to attach the landmark photo:
            </p>

            <div className="landmark-sheet-options">
              <button type="button" className="landmark-option-btn camera" onClick={openCamera}>
                <div className="option-icon-box">📸</div>
                <div className="option-text">
                  <strong>Take Photo (Camera)</strong>
                  <span>Opens camera to snap live image</span>
                </div>
              </button>

              <button type="button" className="landmark-option-btn gallery" onClick={openGallery}>
                <div className="option-icon-box">📁</div>
                <div className="option-text">
                  <strong>Choose from Gallery / Files</strong>
                  <span>Pick existing photo from phone storage</span>
                </div>
              </button>
            </div>
            </>}

            <button type="button" className="landmark-cancel-btn" onClick={closeModal}>
              Cancel
            </button>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default LandmarkImagePicker;
