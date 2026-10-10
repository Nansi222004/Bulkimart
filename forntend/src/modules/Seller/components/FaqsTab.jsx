import React, { useState, useEffect } from 'react';
import { apiUrl } from '../../../utils/api';

export const FaqsTab = () => {
  const [faqs, setFaqs] = useState([]);
  const [filter, setFilter] = useState('unanswered');
  const [loading, setLoading] = useState(true);
  const [answerTexts, setAnswerTexts] = useState({});
  const [submittingId, setSubmittingId] = useState(null);

  const fetchFaqs = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('userToken');
      const res = await fetch(apiUrl('/api/sellers/faqs'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      setFaqs(body.data?.faqs || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchFaqs(); }, []);

  const handleAnswerSubmit = async (faqId) => {
    const answer = answerTexts[faqId]?.trim();
    if (!answer) return;
    setSubmittingId(faqId);
    try {
      const token = localStorage.getItem('userToken');
      const res = await fetch(apiUrl(`/api/sellers/faqs/${faqId}/answer`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ answer }),
      });
      if (res.ok) {
        setAnswerTexts((prev) => { const next = { ...prev }; delete next[faqId]; return next; });
        fetchFaqs();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingId(null);
    }
  };

  const unansweredCount = faqs.filter((f) => f.status === 'unanswered').length;
  const answeredCount = faqs.filter((f) => f.status === 'answered').length;
  const filteredFaqs = faqs.filter((f) => f.status === filter);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Product Questions & Answers</h2>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <button
          onClick={() => setFilter('unanswered')}
          style={{ padding: '8px 16px', borderRadius: 8, background: filter === 'unanswered' ? '#4f46e5' : '#e2e8f0', color: filter === 'unanswered' ? '#fff' : '#475569', border: 'none', fontWeight: 700, cursor: 'pointer' }}
        >
          Unanswered ({unansweredCount})
        </button>
        <button
          onClick={() => setFilter('answered')}
          style={{ padding: '8px 16px', borderRadius: 8, background: filter === 'answered' ? '#4f46e5' : '#e2e8f0', color: filter === 'answered' ? '#fff' : '#475569', border: 'none', fontWeight: 700, cursor: 'pointer' }}
        >
          Answered ({answeredCount})
        </button>
      </div>

      {/* List */}
      {filteredFaqs.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>
          {filter === 'unanswered' ? 'No unanswered questions right now.' : 'No answered questions yet.'}
        </div>
      ) : (
        filteredFaqs.map((faq) => (
          <div key={faq._id} style={{ background: '#fff', padding: 16, borderRadius: 12, border: '1px solid #e2e8f0', marginBottom: 12 }}>
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 800 }}>{faq.productName}</span>
            <h4 style={{ margin: '4px 0 2px 0', fontSize: 14 }}>Q. {faq.question}</h4>
            <p style={{ margin: '0 0 8px', fontSize: 10.5, color: '#94a3b8' }}>
              Asked by {faq.userName || 'Shopper'} · {faq.createdAt ? new Date(faq.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
            </p>
            {faq.status === 'unanswered' ? (
              <div>
                <textarea
                  value={answerTexts[faq._id] || ''}
                  onChange={(e) => setAnswerTexts({ ...answerTexts, [faq._id]: e.target.value })}
                  placeholder="Type your official answer..."
                  rows={2}
                  style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'inherit', fontSize: 12.5, resize: 'vertical' }}
                />
                <button
                  onClick={() => handleAnswerSubmit(faq._id)}
                  disabled={submittingId === faq._id || !(answerTexts[faq._id] || '').trim()}
                  style={{ marginTop: 8, padding: '8px 16px', background: submittingId === faq._id ? '#94a3b8' : '#16a34a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: submittingId === faq._id ? 'not-allowed' : 'pointer' }}
                >
                  {submittingId === faq._id ? 'Submitting...' : 'Submit Answer'}
                </button>
              </div>
            ) : (
              <p style={{ color: '#16a34a', margin: 0, fontSize: 13 }}><strong>Ans:</strong> {faq.answer}</p>
            )}
          </div>
        ))
      )}
    </div>
  );
};

export default FaqsTab;
