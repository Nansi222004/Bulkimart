import React, { useState } from 'react';
import { apiUrl } from '../../../utils/api';

const getAuthHeaders = () => {
  const token = localStorage.getItem('userToken') || localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const BulkUploadModal = ({ onClose, onSuccess, mode = 'ecommerce' }) => {
  const [excelFile, setExcelFile] = useState(null);
  const [zipFile, setZipFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadResult, setUploadResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Handle template download
  const handleDownloadTemplate = async () => {
    try {
      setDownloadingTemplate(true);
      setErrorMessage('');
      const res = await fetch(apiUrl(`/api/products/bulk/template?mode=${mode}`), {
        headers: getAuthHeaders()
      });

      if (!res.ok) {
        throw new Error('Failed to download template. Please try again.');
      }

      const isShg = String(mode).toLowerCase() === 'shg';
      const isQuick = String(mode).toLowerCase() === 'quick' || String(mode).toLowerCase() === 'grocery';
      const defaultFilename = isShg
        ? 'Bulkimart_SHG_Bulk_Product_Template.xlsx'
        : (isQuick 
            ? 'Bulkimart_Quick_Commerce_Bulk_Product_Template.xlsx' 
            : 'Bulkimart_Ecommerce_Bulk_Product_Template.xlsx');

      const contentDisposition = res.headers.get('content-disposition');
      let filename = defaultFilename;
      if (contentDisposition && contentDisposition.includes('filename=')) {
        const match = contentDisposition.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setErrorMessage(err.message || 'Error downloading template');
    } finally {
      setDownloadingTemplate(false);
    }
  };

  // Handle file select
  const handleExcelChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setExcelFile(e.target.files[0]);
    }
  };

  const handleZipChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setZipFile(e.target.files[0]);
    }
  };

  // Submit bulk upload
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!excelFile) {
      setErrorMessage('Please select a completed Excel/CSV file.');
      return;
    }

    try {
      setUploading(true);
      setErrorMessage('');
      setUploadProgress('Extracting ZIP images and parsing spreadsheet...');

      const formData = new FormData();
      formData.append('excelFile', excelFile);
      if (zipFile) {
        formData.append('zipFile', zipFile);
      }
      formData.append('mode', mode);

      setUploadProgress('Uploading images to Cloudinary & creating product listings...');

      const res = await fetch(apiUrl(`/api/products/bulk/upload?mode=${mode}`), {
        method: 'POST',
        headers: {
          ...getAuthHeaders()
        },
        body: formData
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Bulk upload failed');
      }

      setUploadResult(data);
      if (onSuccess) onSuccess();
    } catch (err) {
      setErrorMessage(err.message || 'Bulk upload processing failed.');
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.75)',
      backdropFilter: 'blur(4px)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '20px',
        maxWidth: '680px',
        width: '100%',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          background: 'linear-gradient(135deg, #1b7a37 0%, #15803d 100%)',
          color: '#ffffff',
          borderRadius: '20px 20px 0 0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800' }}>
              {mode === 'shg' ? 'SHG Bulk Product Listing' : 'Bulk Product Listing'}
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', opacity: 0.9 }}>
              {mode === 'shg'
                ? 'Upload Excel sheet with SHG categories & images ZIP file to list products in bulk'
                : 'Upload Excel product sheet & images ZIP file to list items in bulk'}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              color: '#ffffff',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              cursor: 'pointer',
              fontSize: '18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {errorMessage && (
            <div style={{
              backgroundColor: '#fef2f2',
              border: '1px solid #fca5a5',
              borderRadius: '12px',
              padding: '12px 16px',
              color: '#b91c1c',
              fontSize: '13px',
              fontWeight: '600'
            }}>
              ⚠️ {errorMessage}
            </div>
          )}

          {/* STEP 1: Download Template */}
          <div style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '16px',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px'
          }}>
            <div>
              <strong style={{ display: 'block', fontSize: '14px', color: '#0f172a' }}>
                1. Download {mode === 'shg' ? 'SHG Excel Template' : (mode === 'quick' ? 'Quick Commerce Excel Template' : 'Ecommerce Excel Template')}
              </strong>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                Pre-populated with valid {mode === 'shg' ? 'SHG' : 'system'} Categories, Headers & dropdowns.
              </span>
            </div>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              disabled={downloadingTemplate}
              style={{
                backgroundColor: '#ffffff',
                border: '1.5px solid #1b7a37',
                color: '#1b7a37',
                padding: '8px 16px',
                borderRadius: '10px',
                fontWeight: '700',
                fontSize: '13px',
                cursor: 'pointer',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              {downloadingTemplate ? 'Downloading...' : '📥 Download Template'}
            </button>
          </div>

          {!uploadResult ? (
            /* STEP 2: File Upload Form */
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#0f172a', marginBottom: '6px' }}>
                  2. Upload Excel / CSV Data Sheet <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="file"
                  accept=".csv, .xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                  onChange={handleExcelChange}
                  disabled={uploading}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1.5px dashed #cbd5e1',
                    borderRadius: '12px',
                    backgroundColor: '#ffffff',
                    fontSize: '13px',
                    boxSizing: 'border-box'
                  }}
                />
                {excelFile && (
                  <span style={{ fontSize: '11px', color: '#1b7a37', fontWeight: '700', marginTop: '4px', display: 'block' }}>
                    Selected: {excelFile.name} ({(excelFile.size / 1024).toFixed(1)} KB)
                  </span>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#0f172a', marginBottom: '6px' }}>
                  3. Upload Product Images Archive (ZIP) <span style={{ color: '#64748b', fontWeight: '400' }}>(Optional)</span>
                </label>
                <input
                  type="file"
                  accept=".zip, application/zip, application/x-zip-compressed"
                  onChange={handleZipChange}
                  disabled={uploading}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1.5px dashed #cbd5e1',
                    borderRadius: '12px',
                    backgroundColor: '#ffffff',
                    fontSize: '13px',
                    boxSizing: 'border-box'
                  }}
                />
                <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
                  Image filenames in Excel (e.g. <code>prod1_main.png</code>) will automatically map to images in this ZIP archive.
                </span>
                {zipFile && (
                  <span style={{ fontSize: '11px', color: '#1b7a37', fontWeight: '700', marginTop: '2px', display: 'block' }}>
                    Selected ZIP: {zipFile.name} ({(zipFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </span>
                )}
              </div>

              {uploading && (
                <div style={{
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '12px',
                  padding: '12px',
                  textAlign: 'center',
                  color: '#15803d',
                  fontSize: '13px',
                  fontWeight: '700'
                }}>
                  ⏳ {uploadProgress}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={uploading}
                  style={{
                    padding: '10px 20px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '10px',
                    backgroundColor: '#ffffff',
                    color: '#475569',
                    fontSize: '13px',
                    fontWeight: '700',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !excelFile}
                  style={{
                    padding: '10px 24px',
                    border: 'none',
                    borderRadius: '10px',
                    backgroundColor: uploading || !excelFile ? '#94a3b8' : '#1b7a37',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: '800',
                    cursor: uploading || !excelFile ? 'not-allowed' : 'pointer'
                  }}
                >
                  {uploading ? 'Processing Import...' : '🚀 Process & Import Products'}
                </button>
              </div>
            </form>
          ) : (
            /* Upload Execution Results */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '16px',
                padding: '20px',
                textAlign: 'center'
              }}>
                <h4 style={{ margin: 0, fontSize: '18px', color: '#166534', fontWeight: '800' }}>Bulk Listing Complete!</h4>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', marginTop: '16px' }}>
                  <div>
                    <span style={{ display: 'block', fontSize: '24px', fontWeight: '900', color: '#166534' }}>{uploadResult.successCount}</span>
                    <span style={{ fontSize: '12px', color: '#15803d', fontWeight: '600' }}>Successfully Created</span>
                  </div>
                  {uploadResult.failedCount > 0 && (
                    <div>
                      <span style={{ display: 'block', fontSize: '24px', fontWeight: '900', color: '#dc2626' }}>{uploadResult.failedCount}</span>
                      <span style={{ fontSize: '12px', color: '#b91c1c', fontWeight: '600' }}>Skipped / Errors</span>
                    </div>
                  )}
                  <div>
                    <span style={{ display: 'block', fontSize: '24px', fontWeight: '900', color: '#0f172a' }}>{uploadResult.totalRows}</span>
                    <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>Total Rows</span>
                  </div>
                </div>
              </div>

              {/* Errors Breakdown */}
              {uploadResult.errors && uploadResult.errors.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <h5 style={{ margin: 0, fontSize: '14px', color: '#991b1b', fontWeight: '800' }}>Row Execution Warnings:</h5>
                  <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid #fecaca', borderRadius: '12px', backgroundColor: '#fff5f5' }}>
                    <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
                          <th style={{ padding: '8px 12px' }}>Row</th>
                          <th style={{ padding: '8px 12px' }}>Product Name</th>
                          <th style={{ padding: '8px 12px' }}>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uploadResult.errors.map((err, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #fecaca' }}>
                            <td style={{ padding: '8px 12px', fontWeight: '700' }}>Row {err.row}</td>
                            <td style={{ padding: '8px 12px' }}>{err.name || '—'}</td>
                            <td style={{ padding: '8px 12px', color: '#dc2626' }}>{err.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setUploadResult(null)}
                  style={{
                    padding: '10px 20px',
                    border: '1.5px solid #cbd5e1',
                    borderRadius: '10px',
                    backgroundColor: '#ffffff',
                    color: '#0f172a',
                    fontSize: '13px',
                    fontWeight: '700',
                    cursor: 'pointer'
                  }}
                >
                  Upload Another File
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: '10px 24px',
                    border: 'none',
                    borderRadius: '10px',
                    backgroundColor: '#1b7a37',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: '800',
                    cursor: 'pointer'
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
