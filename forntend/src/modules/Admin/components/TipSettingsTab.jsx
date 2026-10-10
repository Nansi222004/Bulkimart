import React, { useEffect, useState } from 'react';
import { authGet, authPost } from '../../../utils/adminApi';
import { useAdmin } from '../context/AdminContext';

const money = (n) => '₹' + Math.round(Number(n) || 0);

export const TipSettingsTab = () => {
  const { triggerToast } = useAdmin();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState(null);

  const [isEnabled, setIsEnabled] = useState(true);
  const [title, setTitle] = useState('Tip your delivery partner');
  const [subtitle, setSubtitle] = useState("100% of your tip goes to them. We don't take a cut.");
  const [options, setOptions] = useState([10, 20, 30, 40, 50]);
  const [newChip, setNewChip] = useState('');
  const [allowCustom, setAllowCustom] = useState(true);
  const [minCustomAmount, setMinCustomAmount] = useState('1');
  const [maxCustomAmount, setMaxCustomAmount] = useState('1000');

  const [previewChip, setPreviewChip] = useState(null);
  const [previewIsCustom, setPreviewIsCustom] = useState(false);
  const [previewCustomInput, setPreviewCustomInput] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await authGet('/api/admin/tip-setting');
      const data = res.data || res;
      const c = data.active || data.current || null;
      setCurrent(c);

      if (c) {
        setIsEnabled(Boolean(c.isEnabled));
        setTitle(c.title || 'Tip your delivery partner');
        setSubtitle(c.subtitle || "100% of your tip goes to them. We don't take a cut.");
        setOptions(Array.isArray(c.options) && c.options.length > 0 ? c.options : [10, 20, 30, 40, 50]);
        setAllowCustom(Boolean(c.allowCustom ?? true));
        setMinCustomAmount(String(c.minCustomAmount ?? 1));
        setMaxCustomAmount(String(c.maxCustomAmount ?? 1000));
      }
    } catch (err) {
      triggerToast(err.message || 'Could not load tip settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addChip = () => {
    const n = Math.floor(Number(newChip));
    if (!Number.isFinite(n) || n <= 0) return;
    if (options.includes(n)) {
      setNewChip('');
      return;
    }
    setOptions((prev) => [...prev, n].sort((a, b) => a - b));
    setNewChip('');
  };

  const removeChip = (n) => {
    setOptions((prev) => prev.filter((o) => o !== n));
  };

  const save = async () => {
    if (isEnabled && !options.length) {
      triggerToast('Add at least one preset tip amount option.');
      return;
    }
    setSaving(true);
    try {
      await authPost('/api/admin/tip-setting', {
        isEnabled,
        title,
        subtitle,
        options,
        allowCustom,
        minCustomAmount: Number(minCustomAmount),
        maxCustomAmount: Number(maxCustomAmount),
      });
      triggerToast('Tip settings updated successfully.');
      await load();
    } catch (err) {
      triggerToast(err.message || 'Could not save tip settings');
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    current &&
    (Boolean(current.isEnabled) !== isEnabled ||
      (current.title || '') !== title ||
      (current.subtitle || '') !== subtitle ||
      JSON.stringify(current.options || []) !== JSON.stringify(options) ||
      Boolean(current.allowCustom) !== allowCustom ||
      String(current.minCustomAmount ?? 1) !== minCustomAmount ||
      String(current.maxCustomAmount ?? 1000) !== maxCustomAmount);

  if (loading) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b', fontSize: 13.5, fontWeight: 600 }}>
        Loading tip settings…
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 28px', maxWidth: 1140, margin: '0 auto', fontFamily: "'Inter', sans-serif", color: '#0f172a' }}>
      {/* Page Title & Save Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>🛵</span>
            <span>Dynamic Tip Management</span>
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>
            Configure default tip chips, card title, subtext, and custom tip options shown on Customer Checkout.
          </p>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={saving || (current && !dirty)}
          style={{
            padding: '10px 22px',
            borderRadius: 10,
            border: 'none',
            background: dirty ? '#10b981' : '#e2e8f0',
            color: dirty ? '#ffffff' : '#94a3b8',
            fontWeight: 700,
            fontSize: 13,
            cursor: dirty ? 'pointer' : 'default',
            boxShadow: dirty ? '0 4px 12px rgba(16, 185, 129, 0.25)' : 'none',
            transition: 'all 0.2s ease',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {saving ? 'Saving…' : dirty ? 'Save Changes' : 'Saved ✓'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
        {/* Main Settings Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Card 1: Master Enable/Disable Switch */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 14,
              padding: '16px 20px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                Enable Tip Prompt at Checkout
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                When disabled, the tip card will be completely hidden on the Customer Checkout page.
              </p>
            </div>

            <label style={{ position: 'relative', display: 'inline-block', width: 46, height: 24, cursor: 'pointer', flexShrink: 0 }}>
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={(e) => setIsEnabled(e.target.checked)}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: 'absolute',
                  top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: isEnabled ? '#10b981' : '#cbd5e1',
                  borderRadius: 24,
                  transition: '0.2s ease',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    content: '""',
                    height: 18,
                    width: 18,
                    left: isEnabled ? 24 : 3,
                    bottom: 3,
                    backgroundColor: '#ffffff',
                    borderRadius: '50%',
                    transition: '0.2s ease',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                  }}
                />
              </span>
            </label>
          </div>

          {/* Card 2: Headings & Text */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 14,
              padding: '18px 20px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <p style={{ margin: '0 0 14px', fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
              Text & Headlines
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>
                  Section Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Tip your delivery partner"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    fontSize: 13,
                    color: '#0f172a',
                    fontWeight: 500,
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>
                  Subtitle / Note
                </label>
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="e.g. 100% of your tip goes to them. We don't take a cut."
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    fontSize: 13,
                    color: '#0f172a',
                    fontWeight: 500,
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Card 3: Preset Tip Chips (₹) */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 14,
              padding: '18px 20px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
              Preset Tip Chips (₹)
            </p>
            <p style={{ margin: '0 0 14px', fontSize: 12, color: '#64748b' }}>
              These chips will be displayed directly for quick one-tap tipping by customers.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {options.map((amt) => (
                <div
                  key={amt}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 14px',
                    borderRadius: 999,
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#0f172a',
                  }}
                >
                  {money(amt)}
                  <button
                    type="button"
                    onClick={() => removeChip(amt)}
                    title="Remove chip"
                    style={{
                      border: 'none',
                      background: 'none',
                      color: '#ef4444',
                      cursor: 'pointer',
                      padding: 0,
                      fontWeight: 800,
                      fontSize: 14,
                      lineHeight: 1,
                      marginLeft: 2,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, maxWidth: 300 }}>
              <input
                type="number"
                value={newChip}
                onChange={(e) => setNewChip(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addChip())}
                placeholder="Amount (e.g. 60)"
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={addChip}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#1e293b',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                + Add Chip
              </button>
            </div>
          </div>

          {/* Card 4: Custom Tip Input */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 14,
              padding: '18px 20px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: allowCustom ? 14 : 0 }}>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                  Allow Custom Tip Input
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                  Allows customers to click 'Other' and enter a custom tip amount beyond the presets.
                </p>
              </div>

              <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, cursor: 'pointer', flexShrink: 0 }}>
                <input
                  type="checkbox"
                  checked={allowCustom}
                  onChange={(e) => setAllowCustom(e.target.checked)}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span
                  style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: allowCustom ? '#10b981' : '#cbd5e1',
                    borderRadius: 24,
                    transition: '0.2s ease',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      content: '""',
                      height: 18,
                      width: 18,
                      left: allowCustom ? 23 : 3,
                      bottom: 3,
                      backgroundColor: '#ffffff',
                      borderRadius: '50%',
                      transition: '0.2s ease',
                    }}
                  />
                </span>
              </label>
            </div>

            {allowCustom && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>
                    Min Custom Tip (₹)
                  </label>
                  <input
                    type="number"
                    value={minCustomAmount}
                    onChange={(e) => setMinCustomAmount(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>
                    Max Custom Tip (₹)
                  </label>
                  <input
                    type="number"
                    value={maxCustomAmount}
                    onChange={(e) => setMaxCustomAmount(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Live Customer Checkout Preview Sidebar */}
        <div style={{ position: 'sticky', top: 20 }}>
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 16,
              padding: 18,
              boxShadow: '0 4px 12px rgba(15, 23, 42, 0.05)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              <p style={{ margin: 0, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#64748b' }}>
                CUSTOMER CHECKOUT LIVE PREVIEW
              </p>
            </div>

            {!isEnabled ? (
              <div
                style={{
                  padding: '24px 16px',
                  textAlign: 'center',
                  background: '#f8fafc',
                  border: '1.5px dashed #cbd5e1',
                  borderRadius: 12,
                  color: '#94a3b8',
                  fontSize: 12.5,
                  fontWeight: 600,
                }}
              >
                Tip Section is currently <strong>DISABLED</strong>.
              </div>
            ) : (
              <div
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🛵</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#0f172a', lineHeight: 1.35 }}>
                      {title || 'Tip your delivery partner'}
                    </p>
                    <p style={{ margin: '3px 0 0', fontSize: 11.5, color: '#64748b', lineHeight: 1.3 }}>
                      {subtitle || "100% of your tip goes to them. We don't take a cut."}
                    </p>
                  </div>
                </div>

                {/* Preview Tip Chips + Other */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  {options.map((amt) => {
                    const isSelected = previewChip === amt;
                    return (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => {
                          setPreviewChip(isSelected ? null : amt);
                          setPreviewIsCustom(false);
                          setPreviewCustomInput('');
                        }}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 999,
                          fontSize: 12.5,
                          fontWeight: 800,
                          cursor: 'pointer',
                          border: isSelected ? '1.5px solid #10b981' : '1.5px solid #e2e8f0',
                          background: isSelected ? '#10b981' : '#ffffff',
                          color: isSelected ? '#ffffff' : '#0f172a',
                          boxShadow: isSelected ? '0 2px 8px rgba(16, 185, 129, 0.25)' : 'none',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {money(amt)}
                      </button>
                    );
                  })}

                  {allowCustom && (
                    <button
                      type="button"
                      onClick={() => {
                        if (previewIsCustom) {
                          setPreviewIsCustom(false);
                          setPreviewCustomInput('');
                        } else {
                          setPreviewIsCustom(true);
                          setPreviewChip(null);
                        }
                      }}
                      style={{
                        padding: '6px 15px',
                        borderRadius: 999,
                        fontSize: 12.5,
                        fontWeight: 800,
                        cursor: 'pointer',
                        border: previewIsCustom ? '1.5px solid #10b981' : '1.5px solid #e2e8f0',
                        background: previewIsCustom ? '#10b981' : '#ffffff',
                        color: previewIsCustom ? '#ffffff' : '#0f172a',
                        boxShadow: previewIsCustom ? '0 2px 8px rgba(16, 185, 129, 0.25)' : 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span>
                        {previewIsCustom &&
                        Number(previewCustomInput) >= (Number(minCustomAmount) || 1) &&
                        Number(previewCustomInput) <= (Number(maxCustomAmount) || 1000)
                          ? `₹${previewCustomInput}`
                          : 'Other'}
                      </span>
                      {!previewIsCustom && <span style={{ opacity: 0.7 }}>+</span>}
                    </button>
                  )}
                </div>

                {/* Preview Custom Tip Input Form */}
                {allowCustom && previewIsCustom && (
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1.5px solid #e2e8f0',
                      borderRadius: 10,
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: '#475569' }}>
                        Customer types custom tip:
                      </span>
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: '#94a3b8' }}>
                        ₹{Number(minCustomAmount) || 1} – ₹{Number(maxCustomAmount) || 1000}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#64748b' }}>₹</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={previewCustomInput}
                        onChange={(e) => {
                          const digitsOnly = e.target.value.replace(/\D/g, '');
                          setPreviewCustomInput(digitsOnly);
                        }}
                        onWheel={(e) => e.target.blur()}
                        placeholder="e.g. 35"
                        style={{
                          width: 120,
                          padding: '5px 8px',
                          borderRadius: 6,
                          border: '1.5px solid #10b981',
                          backgroundColor: '#ffffff',
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#0f172a',
                          outline: 'none',
                        }}
                      />
                      {previewCustomInput && (
                        <button
                          type="button"
                          onClick={() => setPreviewCustomInput('')}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#94a3b8',
                            fontSize: 13,
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {previewCustomInput !== '' &&
                      (Number(previewCustomInput) < (Number(minCustomAmount) || 1) ||
                        Number(previewCustomInput) > (Number(maxCustomAmount) || 1000)) && (
                        <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>
                          Must be between ₹{Number(minCustomAmount) || 1} and ₹{Number(maxCustomAmount) || 1000}
                        </span>
                      )}
                  </div>
                )}

                {/* Preview Tip Confirmation */}
                {(() => {
                  const customVal = Number(previewCustomInput);
                  const isCustomValValid =
                    previewIsCustom &&
                    customVal >= (Number(minCustomAmount) || 1) &&
                    customVal <= (Number(maxCustomAmount) || 1000);
                  const effectivePreviewTip = previewChip ?? (isCustomValValid ? customVal : 0);

                  if (effectivePreviewTip > 0) {
                    return (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: '#10b981' }}>
                          ✓ ₹{effectivePreviewTip} tip added — rider receives 100%.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setPreviewChip(null);
                            setPreviewIsCustom(false);
                            setPreviewCustomInput('');
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            fontSize: 11,
                            fontWeight: 600,
                            color: '#94a3b8',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TipSettingsTab;
