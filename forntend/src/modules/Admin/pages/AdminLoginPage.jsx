import React, { useState } from 'react';
import { apiUrl } from '../../../utils/api';
import BrandLogo from '../../../components/BrandLogo';

export const AdminLoginPage = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

      const data = await response.json();

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
      setError(err.message || 'An error occurred during login');
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
    marginBottom: '32px',
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
