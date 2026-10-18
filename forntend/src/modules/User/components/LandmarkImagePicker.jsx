import ModalPortal from '../../../components/ModalPortal';
import React, { useState, useRef } from 'react';
import './LandmarkImagePicker.css';

/**
 * LandmarkImagePicker Component
 * End-to-end component for landmark image attachment with explicit choices:
 * 1. 📸 Take Photo (Camera directly via capture="environment")
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

  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

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

  const onCameraChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFilePicked(file);
    e.target.value = '';
  };

  const onGalleryChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFilePicked(file);
    e.target.value = '';
  };

  const openCamera = () => {
    if (cameraInputRef.current) {
      cameraInputRef.current.click();
    }
  };

  const openGallery = () => {
    if (galleryInputRef.current) {
      galleryInputRef.current.click();
    }
  };

  return (
    <div className="landmark-picker-container">
      {/* Hidden File Inputs */}
      {/* Direct Native Camera Trigger */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={onCameraChange}
      />
      {/* File Manager / Gallery Selector Trigger */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onGalleryChange}
      />

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
          onClick={() => setShowOptionsModal(true)}
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

      {error && <p className="landmark-picker-error">⚠️ {error}</p>}

      {/* Choice Modal (Camera vs Gallery) */}
      {showOptionsModal && (
        <ModalPortal className="landmark-modal-overlay" onClick={() => setShowOptionsModal(false)}>
          <div className="landmark-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="landmark-sheet-header">
              <h4>Landmark Image Option</h4>
              <button type="button" className="landmark-close-btn" onClick={() => setShowOptionsModal(false)}>✕</button>
            </div>
            
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

            <button type="button" className="landmark-cancel-btn" onClick={() => setShowOptionsModal(false)}>
              Cancel
            </button>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default LandmarkImagePicker;
