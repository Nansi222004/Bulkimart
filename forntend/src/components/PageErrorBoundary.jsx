import React from 'react';

// Keeps a failing page from blanking the whole app: the error is shown with a way to recover,
// and logged so the message can be reported.
export default class PageErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[page error]', this.props.name || 'page', error, info?.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    const message = String(this.state.error?.message || this.state.error || 'Unknown error');
    return <section role="alert" style={{ margin: '24px auto', maxWidth: 560, padding: 20, border: '1px solid #fecaca', borderRadius: 14, background: '#fff', color: '#0f172a', fontFamily: 'inherit' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Something went wrong on this page</h2>
      <p style={{ margin: '0 0 12px', color: '#475569', fontSize: 14 }}>Your data is safe. Try again, or reload the page. If it keeps happening, share this message with support:</p>
      <p style={{ margin: '0 0 16px', padding: '8px 10px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 13, overflowWrap: 'anywhere' }}>{message}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => this.setState({ error: null })} style={{ minHeight: 40, padding: '0 16px', borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff', fontWeight: 700, cursor: 'pointer' }}>Try again</button>
        <button type="button" onClick={() => window.location.reload()} style={{ minHeight: 40, padding: '0 16px', borderRadius: 10, border: 0, background: '#0f766e', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Reload page</button>
      </div>
    </section>;
  }
}
