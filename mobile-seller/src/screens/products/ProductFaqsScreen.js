import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, ToastAndroid, View } from 'react-native';
import { Text } from '../../components/AppText';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import ChipRow from '../../components/ChipRow';
import { EmptyView, ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { answerSellerFaq, listSellerFaqs } from '../../services/faqs.api';
import { dateTime } from '../../utils/format';
import { colors, radius, spacing, type } from '../../theme';

// Port of FaqsTab.jsx: customer questions on this seller's products; the seller answers once.
// The backend has no moderation state beyond unanswered/answered, and an answer cannot be edited afterwards.
export default function ProductFaqsScreen() {
  const loader = useCallback(() => listSellerFaqs(), []);
  const { data, error, loading, refreshing, refresh, reload } = useApiResource(loader, [loader]);
  const [filter, setFilter] = useState('unanswered');
  const [drafts, setDrafts] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [rowError, setRowError] = useState({});

  const faqs = useMemo(() => data || [], [data]);
  const counts = { unanswered: faqs.filter((f) => f.status === 'unanswered').length, answered: faqs.filter((f) => f.status === 'answered').length };
  const shown = faqs.filter((f) => f.status === filter);

  const submit = async (faq) => {
    const answer = (drafts[faq._id] || '').trim();
    if (!answer) { setRowError((e) => ({ ...e, [faq._id]: 'Please type an answer' })); return; }
    setBusyId(faq._id); setRowError((e) => ({ ...e, [faq._id]: '' }));
    try {
      await answerSellerFaq(faq._id, answer);
      setDrafts((d) => { const next = { ...d }; delete next[faq._id]; return next; });
      ToastAndroid.show('Answer submitted', ToastAndroid.SHORT);
      await refresh();
    } catch (e) { setRowError((x) => ({ ...x, [faq._id]: e.message || 'Could not submit the answer' })); }
    finally { setBusyId(null); }
  };

  if (loading && !data) return <LoadingView message="Loading product questions…" />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;

  return (
    <FlatList
      data={shown}
      keyExtractor={(f) => String(f._id)}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primaryDark]} />}
      ListHeaderComponent={(
        <View style={styles.header}>
          <Text style={type.small}>Questions customers asked on your product pages. Your answer is shown publicly on the product.</Text>
          <ChipRow value={filter} onChange={setFilter} accessibilityLabel="Question status"
            options={[{ value: 'unanswered', label: 'Unanswered', count: counts.unanswered }, { value: 'answered', label: 'Answered', count: counts.answered }]} />
        </View>
      )}
      ListEmptyComponent={<EmptyView title={filter === 'unanswered' ? 'No open questions' : 'No answered questions yet'} message="Customer questions on your products appear here." />}
      renderItem={({ item: f }) => (
        <View style={styles.card}>
          <Text style={type.small} numberOfLines={1}>{f.productName}</Text>
          <Text style={type.label}>Q: {f.question}</Text>
          <Text style={type.small}>{f.userName || 'Customer'} · {dateTime(f.createdAt)}</Text>
          {f.status === 'answered' ? (
            <View style={styles.answer}>
              <Text style={type.body}>A: {f.answer}</Text>
              <Text style={type.small}>Answered {dateTime(f.answeredAt)}</Text>
            </View>
          ) : (
            <>
              <AppInput multiline maxLength={2000} placeholder="Type your answer" value={drafts[f._id] || ''} editable={busyId !== f._id}
                onChangeText={(t) => setDrafts((d) => ({ ...d, [f._id]: t }))} />
              {rowError[f._id] ? <InlineNotice tone="error">{rowError[f._id]}</InlineNotice> : null}
              <AppButton small title="Submit answer" loading={busyId === f._id} disabled={!!busyId} onPress={() => submit(f)} />
            </>
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surface, paddingBottom: spacing.xxl },
  header: { gap: spacing.md },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  answer: { backgroundColor: colors.aquaLight, borderRadius: radius.md, padding: spacing.md, gap: 2 },
});
