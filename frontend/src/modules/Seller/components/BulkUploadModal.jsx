import ModalPortal from '../../../components/ModalPortal';
import React, { useState } from 'react';
import { apiUrl } from '../../../utils/api';
import { bulkFileError } from '../utils/bulkUploadValidation';

const getAuthHeaders = () => {
  const token = localStorage.getItem('sellerToken');
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
  const [fileErrors, setFileErrors] = useState({});
  const [rowErrors, setRowErrors] = useState([]);

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

      const isQuick = String(mode).toLowerCase() === 'quick' || String(mode).toLowerCase() === 'grocery';
      const defaultFilename = isQuick
        ? 'Bulkimart_Quick_Commerce_Bulk_Product_Template.xlsx'
        : 'Bulkimart_Ecommerce_Bulk_Product_Template.xlsx';

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
  const chooseFile = (e, kind) => {
    const file = e.target.files?.[0] || null;
    const error = file ? bulkFileError(file, kind) : '';
    setFileErrors(previous => ({ ...previous, [kind]: error }));
    setErrorMessage(''); setRowErrors([]);
    (kind === 'sheet' ? setExcelFile : setZipFile)(error ? null : file);
    if (error) e.target.value = '';
  };

  // Submit bulk upload
  const handleSubmit = async (e) => {
    e.preventDefault();
    const sheetError = bulkFileError(excelFile, 'sheet'), zipError = bulkFileError(zipFile, 'zip');
    if (sheetError || zipError || Object.values(fileErrors).some(Boolean)) {
      setFileErrors(previous => ({ ...previous, sheet: sheetError || previous.sheet, zip: zipError || previous.zip }));
      return;
    }

    try {
      setUploading(true);
      setErrorMessage('');
      setRowErrors([]);
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
        setRowErrors(data.meta?.errors || []);
        throw new Error(data.message || 'Bulk upload failed');
      }

      setUploadResult(data);
      if (data.successCount > 0 && onSuccess) onSuccess();
    } catch (err) {
      setErrorMessage(err.message || 'Bulk upload processing failed.');
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  const cannotSubmit = uploading || !excelFile || Object.values(fileErrors).some(Boolean);
  return (
    <ModalPortal style={{
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
              Bulk Product Listing
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', opacity: 0.9 }}>
              Upload Excel product sheet & images ZIP file to list items in bulk
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
            <div role="alert" style={{
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
          {rowErrors.length > 0 && <div role="alert"><strong>Fix these rows and upload the file again. No products were imported.</strong><ul>{rowErrors.map((error, index) => <li key={index}>Row {error.row}{error.name ? ` (${error.name})` : ''}: {error.reason}</li>)}</ul></div>}

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
                1. Download {mode === 'quick' ? 'Quick Commerce Excel Template' : 'Ecommerce Excel Template'}
              </strong>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                Pre-populated with valid system Categories, Headers & dropdowns.
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
                  id="bulk-product-sheet"
                  type="file"
                  accept=".xlsx,.csv"
                  aria-label="Product data sheet"
                  aria-invalid={!!fileErrors.sheet}
                  aria-describedby="bulk-sheet-help bulk-sheet-error"
                  onChange={e => chooseFile(e, 'sheet')}
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
                <small id="bulk-sheet-help">Accepted: .xlsx or .csv, up to 10 MB. Use the downloaded template. Product Name, Main Category, Sell Price and Stock are required; stock must be a whole number of zero or more. MRP must be at least the selling price.</small>
                {fileErrors.sheet && <p id="bulk-sheet-error" role="alert" style={{ color: '#b91c1c' }}>{fileErrors.sheet}</p>}
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
                  accept=".zip"
                  aria-label="Product images ZIP"
                  aria-invalid={!!fileErrors.zip}
                  aria-describedby="bulk-zip-help bulk-zip-error"
                  onChange={e => chooseFile(e, 'zip')}
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
                <small id="bulk-zip-help">Accepted: .zip, up to 50 MB. Filenames must match the product sheet.</small>
                {fileErrors.zip && <p id="bulk-zip-error" role="alert" style={{ color: '#b91c1c' }}>{fileErrors.zip}</p>}
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
                  disabled={cannotSubmit}
                  style={{
                    padding: '10px 24px',
                    border: 'none',
                    borderRadius: '10px',
                    backgroundColor: cannotSubmit ? '#94a3b8' : '#1b7a37',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: '800',
                    cursor: cannotSubmit ? 'not-allowed' : 'pointer'
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
                <h4 style={{ margin: 0, fontSize: '18px', color: uploadResult.failedCount ? '#991b1b' : '#166534', fontWeight: '800' }}>{uploadResult.failedCount ? 'Import finished with errors' : 'Bulk Listing Complete!'}</h4>
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
    </ModalPortal>
  );
};
