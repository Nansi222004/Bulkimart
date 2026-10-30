import React, { useEffect, useState, useRef } from 'react';

const formatFileSize = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export const AttachmentPreview = ({ files = [], onRemove }) => {
  const [objectUrls, setObjectUrls] = useState([]);

  useEffect(() => {
    // Generate object URLs for images to provide immediate live preview
    const urls = files.map((file) => {
      if (file && file.type && file.type.startsWith('image/')) {
        return URL.createObjectURL(file);
      }
      return null;
    });

    setObjectUrls(urls);

    // Cleanup URLs on unmount or file list change to prevent memory leaks
    return () => {
      urls.forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [files]);

  if (!files || files.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '10px',
        marginTop: '12px',
        width: '100%'
      }}
    >
      {files.map((file, idx) => {
        const isImage = file && file.type && file.type.startsWith('image/');
        const isPdf = file && (file.type === 'application/pdf' || (file.name && file.name.toLowerCase().endsWith('.pdf')));
        const previewUrl = objectUrls[idx];

        return (
          <div
            key={`${file.name || 'file'}-${idx}`}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px 8px 8px',
              borderRadius: '12px',
              background: '#ffffff',
              border: '1.5px solid #e2e8f0',
              boxShadow: '0 2px 5px rgba(0, 0, 0, 0.04)',
              maxWidth: '260px',
              flex: '1 1 200px',
              overflow: 'hidden',
              transition: 'all 0.2s ease'
            }}
          >
            {/* Image / Icon Thumbnail Preview */}
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '8px',
                overflow: 'hidden',
                background: isPdf ? '#fef2f2' : '#f1f5f9',
                border: isPdf ? '1px solid #fecaca' : '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              {isImage && previewUrl ? (
                <img
                  src={previewUrl}
                  alt={file.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : isPdf ? (
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#dc2626' }}>PDF</span>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              )}
            </div>

            {/* File Info */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#0f172a',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
                title={file.name}
              >
                {file.name}
              </span>
              <span style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', fontWeight: 500 }}>
                {formatFileSize(file.size)}
              </span>
            </div>

            {/* Remove File Button */}
            {onRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(idx);
                }}
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  border: 'none',
                  background: '#fee2e2',
                  color: '#ef4444',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                  flexShrink: 0,
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#ef4444';
                  e.currentTarget.style.color = '#ffffff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#fee2e2';
                  e.currentTarget.style.color = '#ef4444';
                }}
                title="Remove attachment"
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export const AttachmentUploader = ({
  files = [],
  onAddFiles,
  onRemoveFile,
  maxFiles = 5,
  accept = "image/jpeg,image/png,image/webp,application/pdf"
}) => {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length > 0 && onAddFiles) {
      onAddFiles(selected);
    }
    // CRITICAL: Reset native file input value so re-selecting same file works & native text clears
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const selected = Array.from(e.dataTransfer.files);
      if (onAddFiles) {
        onAddFiles(selected);
      }
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  };

  const handleRemove = (idxToRemove) => {
    if (onRemoveFile) {
      onRemoveFile(idxToRemove);
    }
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const isFull = files.length >= maxFiles;

  return (
    <div style={{ width: '100%', marginTop: '6px', marginBottom: '8px' }}>
      {/* Hidden Native File Input */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        onChange={handleFileChange}
        style={{ display: 'none' }}
        disabled={isFull}
      />

      {/* Modern Custom Dropzone Upload Area */}
      <div
        onClick={() => !isFull && inputRef.current && inputRef.current.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          border: isDragging ? '2px dashed #16a34a' : '2px dashed #cbd5e1',
          borderRadius: '14px',
          padding: '16px 20px',
          background: isDragging ? '#f0fdf4' : isFull ? '#f8fafc' : '#ffffff',
          cursor: isFull ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s ease-in-out',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: '8px',
          boxShadow: isDragging ? '0 4px 12px rgba(22, 163, 74, 0.12)' : 'none'
        }}
        onMouseEnter={(e) => {
          if (!isFull && !isDragging) {
            e.currentTarget.style.borderColor = '#16a34a';
            e.currentTarget.style.background = '#fafafa';
          }
        }}
        onMouseLeave={(e) => {
          if (!isFull && !isDragging) {
            e.currentTarget.style.borderColor = '#cbd5e1';
            e.currentTarget.style.background = '#ffffff';
          }
        }}
      >
        <div
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '50%',
            background: isFull ? '#f1f5f9' : '#e8f5e9',
            color: isFull ? '#94a3b8' : '#16a34a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.2s ease'
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>

        <div>
          <p style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: isFull ? '#94a3b8' : '#1e293b' }}>
            {isFull ? 'Maximum files limit reached' : 'Click or Drag & Drop to attach files'}
          </p>
          <p style={{ margin: '3px 0 0', fontSize: '11.5px', color: '#64748b', fontWeight: 500 }}>
            PNG, JPG, WEBP, or PDF (Up to {maxFiles} files)
          </p>
        </div>

        {/* Counter Badge */}
        <div
          style={{
            fontSize: '11px',
            fontWeight: 700,
            padding: '3px 10px',
            borderRadius: '20px',
            background: files.length > 0 ? '#dcfce7' : '#f1f5f9',
            color: files.length > 0 ? '#15803d' : '#64748b'
          }}
        >
          {files.length} / {maxFiles} attached
        </div>
      </div>

      {/* File Previews List */}
      <AttachmentPreview files={files} onRemove={handleRemove} />
    </div>
  );
};

export default AttachmentUploader;
