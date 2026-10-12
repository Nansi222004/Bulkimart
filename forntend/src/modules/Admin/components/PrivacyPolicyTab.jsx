import React, { useState, useEffect } from "react";
import { apiUrl } from "../../../utils/api";
import { useAdmin } from "../context/AdminContext";

const ROLE_TABS = [
  {
    id: "user",
    slug: "user-policy",
    label: "Customer / User",
    icon: "👤",
    description: "Privacy policy for app shoppers, customers, and public visitors.",
  },
  {
    id: "seller",
    slug: "seller-policy",
    label: "Seller / Vendor",
    icon: "🏪",
    description: "Data retention, catalog, payout, and GST/FSSAI compliance for merchants.",
  },
  {
    id: "delivery",
    slug: "delivery-policy",
    label: "Delivery Partner",
    icon: "🛵",
    description: "Background location tracking, KYC, trip earnings, and rider safety policies.",
  },
];

export const PrivacyPolicyTab = () => {
  const { triggerToast } = useAdmin();
  const [activeRoleKey, setActiveRoleKey] = useState("user");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Policy Form State
  const [policyData, setPolicyData] = useState({
    role: "user",
    roleTitle: "",
    slug: "user-policy",
    summary: "",
    version: "1.0.0",
    effectiveDate: new Date().toISOString().split("T")[0],
    sections: [],
  });

  const activeTabMeta = ROLE_TABS.find((t) => t.id === activeRoleKey) || ROLE_TABS[0];

  // Fetch Policy for Active Role
  const fetchPolicy = async (roleKey) => {
    setLoading(true);
    try {
      const activeMeta = ROLE_TABS.find((t) => t.id === roleKey) || ROLE_TABS[0];
      const res = await fetch(apiUrl(`/api/privacy-policy/${activeMeta.slug}`), {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("adminToken")}`,
        },
      });
      const body = await res.json();

      if (body.success && body.data) {
        setPolicyData({
          role: body.data.role || roleKey,
          roleTitle: body.data.roleTitle || activeMeta.label + " Privacy Policy",
          slug: body.data.slug || activeMeta.slug,
          summary: body.data.summary || "",
          version: body.data.version || "1.0.0",
          effectiveDate: body.data.effectiveDate
            ? new Date(body.data.effectiveDate).toISOString().split("T")[0]
            : new Date().toISOString().split("T")[0],
          sections: body.data.sections || [],
        });
      } else {
        // Fallback default empty state if not found
        setPolicyData({
          role: roleKey,
          roleTitle: activeMeta.label + " Privacy Policy",
          slug: activeMeta.slug,
          summary: "",
          version: "1.0.0",
          effectiveDate: new Date().toISOString().split("T")[0],
          sections: [],
        });
      }
    } catch (err) {
      triggerToast("Failed to load policy data from server", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPolicy(activeRoleKey);
  }, [activeRoleKey]);

  // Handler to update section fields
  const handleSectionChange = (index, field, value) => {
    const updatedSections = [...policyData.sections];
    updatedSections[index] = {
      ...updatedSections[index],
      [field]: value,
    };
    setPolicyData({ ...policyData, sections: updatedSections });
  };

  // Handler to update points (comma separated string input helper)
  const handlePointsChange = (index, pointsText) => {
    const pointsArray = pointsText.split("\n").filter((p) => p.trim() !== "");
    handleSectionChange(index, "points", pointsArray);
  };

  // Add new section
  const handleAddSection = () => {
    const newSection = {
      id: `sec-${Date.now()}`,
      title: `${policyData.sections.length + 1}. New Policy Section`,
      content: "Enter policy guidelines and details here...",
      points: [],
      order: policyData.sections.length + 1,
    };
    setPolicyData({
      ...policyData,
      sections: [...policyData.sections, newSection],
    });
  };

  // Delete section
  const handleDeleteSection = (index) => {
    if (window.confirm("Are you sure you want to delete this section?")) {
      const updated = policyData.sections.filter((_, i) => i !== index);
      setPolicyData({ ...policyData, sections: updated });
    }
  };

  // Move section position
  const handleMoveSection = (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= policyData.sections.length) return;
    const updated = [...policyData.sections];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setPolicyData({ ...policyData, sections: updated });
  };

  // Save Policy to Backend
  const handleSave = async (e) => {
    e.preventDefault();
    if (!policyData.roleTitle.trim()) {
      triggerToast("Policy title is required", "error");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(apiUrl(`/api/admin/privacy-policy/${activeTabMeta.slug}`), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("adminToken")}`,
        },
        body: JSON.stringify(policyData),
      });

      const body = await res.json();
      if (res.ok && body.success) {
        triggerToast(`Privacy Policy for ${activeTabMeta.label} updated & published live!`, "success");
        fetchPolicy(activeRoleKey);
      } else {
        triggerToast(body.message || "Failed to save privacy policy", "error");
      }
    } catch (err) {
      triggerToast("Error saving privacy policy: " + err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: "24px", backgroundColor: "#f8fafc", minHeight: "100%", color: "#0f172a" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
          background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
          padding: "20px 24px",
          borderRadius: "16px",
          color: "#ffffff",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: "22px", fontWeight: "800" }}>📜 Privacy Policy Management</h2>
          <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#94a3b8" }}>
            Dynamically update privacy policy terms for users, sellers, and riders.
          </p>
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            type="button"
            onClick={() => setIsPreviewOpen(!isPreviewOpen)}
            style={{
              padding: "10px 18px",
              borderRadius: "10px",
              border: "1px solid #475569",
              backgroundColor: isPreviewOpen ? "#334155" : "transparent",
              color: "#ffffff",
              fontSize: "13px",
              fontWeight: "700",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            👁️ {isPreviewOpen ? "Hide Live Preview" : "Show Live Preview"}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            style={{
              padding: "10px 24px",
              borderRadius: "10px",
              border: "none",
              background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)",
              color: "#ffffff",
              fontSize: "13px",
              fontWeight: "800",
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(22, 163, 74, 0.3)",
            }}
          >
            {saving ? "Publishing Changes..." : "💾 Save & Publish Live"}
          </button>
        </div>
      </div>

      {/* Role Selector Tabs (4 Distinct Roles) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "12px",
          marginBottom: "24px",
        }}
      >
        {ROLE_TABS.map((t) => {
          const isActive = t.id === activeRoleKey;
          return (
            <button
              key={t.id}
              onClick={() => setActiveRoleKey(t.id)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                padding: "14px 16px",
                borderRadius: "14px",
                border: isActive ? "2px solid #16a34a" : "1px solid #cbd5e1",
                backgroundColor: isActive ? "#f0fdf4" : "#ffffff",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.15s ease-in-out",
                boxShadow: isActive ? "0 4px 12px rgba(22, 163, 74, 0.12)" : "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <span style={{ fontSize: "18px" }}>{t.icon}</span>
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: "800",
                    color: isActive ? "#15803d" : "#0f172a",
                  }}
                >
                  {t.label}
                </span>
              </div>
              <span style={{ fontSize: "11px", color: "#64748b", lineHeight: "1.3" }}>{t.description}</span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: "700",
                  fontFamily: "monospace",
                  color: "#0284c7",
                  marginTop: "6px",
                  background: "#e0f2fe",
                  padding: "2px 6px",
                  borderRadius: "4px",
                }}
              >
                /api/privacy-policy/{t.slug}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main Workspace: Editor + Optional Live Preview */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isPreviewOpen ? "1fr 1fr" : "1fr",
          gap: "24px",
          alignItems: "start",
        }}
      >
        {/* Editor Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", background: "#ffffff", borderRadius: "16px" }}>
              <p style={{ color: "#64748b", fontSize: "14px" }}>Loading policy data...</p>
            </div>
          ) : (
            <>
              {/* Basic Meta Settings Card */}
              <div
                style={{
                  backgroundColor: "#ffffff",
                  borderRadius: "16px",
                  padding: "20px",
                  border: "1px solid #e2e8f0",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.02)",
                }}
              >
                <h4 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                  📌 {activeTabMeta.label} Policy Settings
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "16px", marginBottom: "16px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#475569", marginBottom: "6px" }}>
                      Policy Document Title
                    </label>
                    <input
                      type="text"
                      value={policyData.roleTitle}
                      onChange={(e) => setPolicyData({ ...policyData, roleTitle: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        borderRadius: "10px",
                        border: "1px solid #cbd5e1",
                        fontSize: "14px",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#475569", marginBottom: "6px" }}>
                      Version Number
                    </label>
                    <input
                      type="text"
                      value={policyData.version}
                      onChange={(e) => setPolicyData({ ...policyData, version: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        borderRadius: "10px",
                        border: "1px solid #cbd5e1",
                        fontSize: "14px",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#475569", marginBottom: "6px" }}>
                      Effective Date
                    </label>
                    <input
                      type="date"
                      value={policyData.effectiveDate}
                      onChange={(e) => setPolicyData({ ...policyData, effectiveDate: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        borderRadius: "10px",
                        border: "1px solid #cbd5e1",
                        fontSize: "14px",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#475569", marginBottom: "6px" }}>
                    Policy Summary & Intro Notice
                  </label>
                  <textarea
                    rows={3}
                    value={policyData.summary}
                    onChange={(e) => setPolicyData({ ...policyData, summary: e.target.value })}
                    placeholder="Provide a brief summary of how privacy is handled for this role..."
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "10px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      boxSizing: "border-box",
                      resize: "vertical",
                    }}
                  />
                </div>
              </div>

              {/* Policy Sections Editor Card */}
              <div
                style={{
                  backgroundColor: "#ffffff",
                  borderRadius: "16px",
                  padding: "20px",
                  border: "1px solid #e2e8f0",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.02)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <h4 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                    📑 Policy Clauses & Sections ({policyData.sections.length})
                  </h4>
                  <button
                    type="button"
                    onClick={handleAddSection}
                    style={{
                      padding: "8px 14px",
                      borderRadius: "8px",
                      border: "none",
                      backgroundColor: "#16a34a",
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: "700",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    ➕ Add Clause / Section
                  </button>
                </div>

                {policyData.sections.length === 0 ? (
                  <div style={{ padding: "30px", textAlign: "center", background: "#f8fafc", borderRadius: "12px" }}>
                    <p style={{ color: "#64748b", margin: 0, fontSize: "13px" }}>
                      No sections added yet. Click "+ Add Clause / Section" to create your first policy point.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    {policyData.sections.map((sec, idx) => (
                      <div
                        key={sec.id || idx}
                        style={{
                          backgroundColor: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          borderRadius: "14px",
                          padding: "16px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: "12px",
                          }}
                        >
                          <span style={{ fontSize: "13px", fontWeight: "800", color: "#1e293b" }}>Section #{idx + 1}</span>
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button
                              type="button"
                              onClick={() => handleMoveSection(idx, -1)}
                              disabled={idx === 0}
                              style={{
                                padding: "4px 8px",
                                fontSize: "11px",
                                borderRadius: "6px",
                                border: "1px solid #cbd5e1",
                                background: "#ffffff",
                                cursor: idx === 0 ? "not-allowed" : "pointer",
                              }}
                            >
                              ⬆️ Up
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveSection(idx, 1)}
                              disabled={idx === policyData.sections.length - 1}
                              style={{
                                padding: "4px 8px",
                                fontSize: "11px",
                                borderRadius: "6px",
                                border: "1px solid #cbd5e1",
                                background: "#ffffff",
                                cursor: idx === policyData.sections.length - 1 ? "not-allowed" : "pointer",
                              }}
                            >
                              ⬇️ Down
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSection(idx)}
                              style={{
                                padding: "4px 10px",
                                fontSize: "11px",
                                borderRadius: "6px",
                                border: "1px solid #fca5a5",
                                backgroundColor: "#fef2f2",
                                color: "#dc2626",
                                fontWeight: "700",
                                cursor: "pointer",
                              }}
                            >
                              🗑️ Delete
                            </button>
                          </div>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                          <div>
                            <label style={{ display: "block", fontSize: "11px", fontWeight: "700", color: "#475569", marginBottom: "4px" }}>
                              Section Title
                            </label>
                            <input
                              type="text"
                              value={sec.title}
                              onChange={(e) => handleSectionChange(idx, "title", e.target.value)}
                              style={{
                                width: "100%",
                                padding: "8px 12px",
                                borderRadius: "8px",
                                border: "1px solid #cbd5e1",
                                fontSize: "13px",
                                boxSizing: "border-box",
                                fontWeight: "700",
                              }}
                            />
                          </div>

                          <div>
                            <label style={{ display: "block", fontSize: "11px", fontWeight: "700", color: "#475569", marginBottom: "4px" }}>
                              Detailed Content / Explanation
                            </label>
                            <textarea
                              rows={3}
                              value={sec.content}
                              onChange={(e) => handleSectionChange(idx, "content", e.target.value)}
                              style={{
                                width: "100%",
                                padding: "8px 12px",
                                borderRadius: "8px",
                                border: "1px solid #cbd5e1",
                                fontSize: "12.5px",
                                boxSizing: "border-box",
                                resize: "vertical",
                              }}
                            />
                          </div>

                          <div>
                            <label style={{ display: "block", fontSize: "11px", fontWeight: "700", color: "#475569", marginBottom: "4px" }}>
                              Bullet Points (Enter 1 point per line)
                            </label>
                            <textarea
                              rows={3}
                              value={(sec.points || []).join("\n")}
                              onChange={(e) => handlePointsChange(idx, e.target.value)}
                              placeholder="Point 1&#10;Point 2&#10;Point 3"
                              style={{
                                width: "100%",
                                padding: "8px 12px",
                                borderRadius: "8px",
                                border: "1px solid #cbd5e1",
                                fontSize: "12px",
                                boxSizing: "border-box",
                                resize: "vertical",
                                fontFamily: "sans-serif",
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Live Preview Side Column */}
        {isPreviewOpen && (
          <div
            style={{
              position: "sticky",
              top: "24px",
              backgroundColor: "#ffffff",
              borderRadius: "16px",
              border: "1px solid #cbd5e1",
              padding: "20px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
              maxHeight: "85vh",
              overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", borderBottom: "1px solid #e2e8f0", pb: "12px" }}>
              <span style={{ fontSize: "12px", fontWeight: "800", color: "#16a34a", textTransform: "uppercase", letterSpacing: "1px" }}>
                📱 Mobile & Web App Live View
              </span>
              <span style={{ fontSize: "11px", color: "#64748b" }}>Role: {activeRoleKey.toUpperCase()}</span>
            </div>

            <div style={{ backgroundColor: "#f8fafc", padding: "16px", borderRadius: "14px", border: "1px solid #e2e8f0", marginBottom: "16px" }}>
              <h3 style={{ margin: "0 0 6px 0", fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
                {policyData.roleTitle || "Privacy Policy"}
              </h3>
              <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "10px" }}>
                Version {policyData.version || "1.0.0"} • Effective {policyData.effectiveDate}
              </div>
              <p style={{ margin: 0, fontSize: "12px", color: "#475569", lineHeight: "1.6" }}>
                {policyData.summary || "No summary specified."}
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {policyData.sections.length === 0 ? (
                <p style={{ fontSize: "12px", color: "#94a3b8", textAlign: "center", padding: "20px" }}>No sections to preview.</p>
              ) : (
                policyData.sections.map((sec, idx) => (
                  <div
                    key={sec.id || idx}
                    style={{
                      backgroundColor: "#ffffff",
                      padding: "14px 16px",
                      borderRadius: "12px",
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <strong style={{ fontSize: "13px", color: "#0f172a", display: "block", marginBottom: "6px" }}>
                      {sec.title}
                    </strong>
                    <p style={{ margin: 0, fontSize: "12px", color: "#64748b", lineHeight: "1.5" }}>{sec.content}</p>
                    {sec.points && sec.points.length > 0 && (
                      <ul style={{ margin: "8px 0 0 0", paddingLeft: "18px", fontSize: "11.5px", color: "#475569", lineHeight: "1.6" }}>
                        {sec.points.map((pt, pIdx) => (
                          <li key={pIdx}>{pt}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PrivacyPolicyTab;
