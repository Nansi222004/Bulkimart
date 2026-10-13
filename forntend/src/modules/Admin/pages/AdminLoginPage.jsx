import React, { useState } from 'react';
import { apiUrl } from '../../../utils/api';
import BrandLogo from '../../../components/BrandLogo';

const DEFAULT_ADMIN_EMAIL = 'admin@admin.com';
const DEFAULT_ADMIN_PASSWORD = 'Admin123';

export const AdminLoginPage = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState(DEFAULT_ADMIN_EMAIL);
  const [password, setPassword] = useState(DEFAULT_ADMIN_PASSWORD);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');

  const handleQuickFill = () => {
    setEmail(DEFAULT_ADMIN_EMAIL);
    setPassword(DEFAULT_ADMIN_PASSWORD);
    setError('');
    setCopyStatus('filled');
    setTimeout(() => setCopyStatus(''), 2000);
  };

  const handleCopy = (text, type) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      setCopyStatus(type);
      setTimeout(() => setCopyStatus(''), 2000);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const response = await fetch(apiUrl('/api/auth/admin/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || 'Login failed');
      }

      // The API nests the profile: { success, token, admin: { _id, name, email, role } }
      const admin = data.admin || {};

      // Admin model allows superAdmin | admin | moderator — accept all of them,
      // not just 'admin', or a Super Admin gets locked out of their own panel.
      if (!['superAdmin', 'admin', 'moderator'].includes(admin.role)) {
        throw new Error('Access denied. Admin role required.');
      }

      // Save token and info
      localStorage.setItem('adminToken', data.token);
      localStorage.setItem(
        'adminUser',
        JSON.stringify({ name: admin.name, email: admin.email, role: admin.role })
      );

      onLoginSuccess(data.token);
    } catch (err) {
      if (err.name === 'TypeError' || err.message?.includes('Failed to fetch')) {
        setError('Cannot connect to backend server. Please verify backend is running on port 5050.');
      } else {
        setError(err.message || 'An error occurred during login');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <BrandLogo variant="full" portal="Admin" />
          <h2 style={styles.title}>Bulkimart Admin</h2>
          <p style={styles.subtitle}>SuperAdmin Management Portal</p>
        </div>

        {/* Demo / Admin Credentials Box */}
        <div style={styles.credentialBox}>
          <div style={styles.credentialHeader}>
            <div style={styles.credentialTitleWrap}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span style={styles.credentialTitle}>Admin Login Credentials</span>
            </div>
            <button
              type="button"
              onClick={handleQuickFill}
              style={styles.quickFillButton}
              title="Auto-fill credentials"
            >
              {copyStatus === 'filled' ? '✓ Filled!' : '⚡ Auto-fill'}
            </button>
          </div>

          <div style={styles.credentialBody}>
            <div style={styles.credentialRow}>
              <span style={styles.credLabel}>Email:</span>
              <div style={styles.credValueWrapper}>
                <code style={styles.credCode}>{DEFAULT_ADMIN_EMAIL}</code>
                <button
                  type="button"
                  onClick={() => handleCopy(DEFAULT_ADMIN_EMAIL, 'email')}
                  style={styles.copyBtn}
                  title="Copy email"
                >
                  {copyStatus === 'email' ? '✓' : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div style={styles.credentialRow}>
              <span style={styles.credLabel}>Password:</span>
              <div style={styles.credValueWrapper}>
                <code style={styles.credCode}>{DEFAULT_ADMIN_PASSWORD}</code>
                <button
                  type="button"
                  onClick={() => handleCopy(DEFAULT_ADMIN_PASSWORD, 'password')}
                  style={styles.copyBtn}
                  title="Copy password"
                >
                  {copyStatus === 'password' ? '✓' : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div style={styles.errorAlert}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 8, flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Email Address</label>
            <input
              type="email"
              placeholder="you@company.com"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              disabled={loading}
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Password</label>
            <div style={styles.passwordWrapper}>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={styles.passwordInput}
                disabled={loading}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={styles.eyeButton}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            style={{
              ...styles.button,
              backgroundColor: loading ? '#cbd5e1' : '#08b9e8',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
            disabled={loading}
          >
            {loading ? 'Authenticating...' : 'Sign In to Dashboard'}
          </button>
        </form>

        <div style={styles.footer}>
          <span>Secured SuperAdmin Node · Authorized Access Only</span>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100vw',
    height: '100vh',
    background: 'linear-gradient(135deg, #eaf9fe 0%, #ffffff 55%, #fff3e5 100%)',
    fontFamily: "'Inter', sans-serif",
    color: '#0f172a',
    margin: 0,
    padding: 0,
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    padding: '40px',
    boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04)',
    border: '1px solid #e2e8f0',
    boxSizing: 'border-box'
  },
  header: {
    textAlign: 'center',
    marginBottom: '24px',
  },
  credentialBox: {
    backgroundColor: '#f0f9ff',
    border: '1px solid #bae6fd',
    borderRadius: '12px',
    padding: '14px 16px',
    marginBottom: '20px',
  },
  credentialHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '10px',
  },
  credentialTitleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  credentialTitle: {
    fontSize: '12px',
    fontWeight: '700',
    color: '#0369a1',
    letterSpacing: '0.3px',
  },
  quickFillButton: {
    padding: '4px 10px',
    fontSize: '11px',
    fontWeight: '700',
    color: '#0284c7',
    backgroundColor: '#e0f2fe',
    border: '1px solid #7dd3fc',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  credentialBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  credentialRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: '12px',
  },
  credLabel: {
    color: '#64748b',
    fontWeight: '600',
  },
  credValueWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  credCode: {
    fontFamily: 'monospace',
    fontSize: '12px',
    fontWeight: '700',
    color: '#0f172a',
    backgroundColor: '#ffffff',
    padding: '2px 6px',
    borderRadius: '4px',
    border: '1px solid #e2e8f0',
  },
  copyBtn: {
    background: 'none',
    border: 'none',
    color: '#0284c7',
    cursor: 'pointer',
    padding: '2px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: '56px',
    height: '56px',
    borderRadius: '14px',
    backgroundColor: '#10b981',
    color: '#ffffff',
    fontSize: '22px',
    fontWeight: '900',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '16px',
    boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
    letterSpacing: '-0.5px'
  },
  title: {
    fontSize: '24px',
    fontWeight: '800',
    color: '#0f172a',
    margin: '0 0 6px 0',
  },
  subtitle: {
    fontSize: '13px',
    color: '#64748b',
    margin: 0,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontSize: '12px',
    fontWeight: '700',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  input: {
    padding: '14px 16px',
    borderRadius: '10px',
    border: '1.5px solid #cbd5e1',
    backgroundColor: '#f8fafc',
    color: '#0f172a',
    fontSize: '14px',
    outline: 'none',
    transition: 'all 0.2s',
  },
  passwordWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    width: '100%',
  },
  passwordInput: {
    padding: '14px 48px 14px 16px',
    borderRadius: '10px',
    border: '1.5px solid #cbd5e1',
    backgroundColor: '#f8fafc',
    color: '#0f172a',
    fontSize: '14px',
    outline: 'none',
    transition: 'all 0.2s',
    width: '100%',
    boxSizing: 'border-box',
  },
  eyeButton: {
    position: 'absolute',
    right: '16px',
    background: 'none',
    border: 'none',
    color: '#64748b',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    outline: 'none',
    transition: 'color 0.2s',
  },
  button: {
    padding: '14px',
    borderRadius: '10px',
    border: 'none',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '800',
    marginTop: '10px',
    transition: 'all 0.2s',
    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
  },
  errorAlert: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: '10px',
    padding: '12px 16px',
    color: '#dc2626',
    fontSize: '13px',
    marginBottom: '24px',
    lineHeight: 1.4
  },
  footer: {
    textAlign: 'center',
    marginTop: '32px',
    fontSize: '11px',
    color: '#64748b',
    fontWeight: '600',
    letterSpacing: '0.2px'
  }
};

export default AdminLoginPage;
