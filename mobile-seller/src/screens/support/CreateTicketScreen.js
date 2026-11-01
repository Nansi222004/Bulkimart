import React, { useCallback, useState } from 'react';
import { Text, ToastAndroid } from 'react-native';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import OptionPicker from '../../components/OptionPicker';
import AttachmentPicker from '../../components/AttachmentPicker';
import UploadProgress from '../../components/UploadProgress';
import { InlineNotice } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { TICKET_MAX_ATTACHMENTS, createTicket, getTicketCategories } from '../../services/support.api';
import { type } from '../../theme';

// Same fields and rules as the web form: category (from the server list), subject and description are required.
export default function CreateTicketScreen({ navigation }) {
  const loader = useCallback(() => getTicketCategories(), []);
  const { data: categories, error: categoriesError, loading, reload } = useApiResource(loader, [loader]);
  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!category || !subject.trim() || !description.trim()) { setError('Please fill category, subject and description'); return; }
    setBusy(true); setProgress(0);
    try {
      const body = await createTicket({ category, subject: subject.trim(), description: description.trim() }, files, setProgress);
      ToastAndroid.show('Ticket created', ToastAndroid.SHORT);
      if (body?.data?._id) navigation.replace('TicketDetail', { id: body.data._id, title: body.data.ticketNumber });
      else navigation.goBack();
    } catch (e) {
      setError(e.code === 'NETWORK' || e.code === 'TIMEOUT'
        ? `${e.message} The ticket may already have been created; check your ticket history before trying again.`
        : e.message || 'Could not create the ticket');
    } finally { setBusy(false); setProgress(null); }
  };

  return (
    <Screen>
      <Card title="Create support ticket">
        {categoriesError ? (
          <><InlineNotice tone="error">Ticket categories could not be loaded.</InlineNotice><AppButton small variant="outline" title="Retry" onPress={reload} /></>
        ) : (
          <OptionPicker label="Category" required value={category} disabled={busy || loading}
            placeholder={loading ? 'Loading categories…' : 'Select a category'}
            options={(categories || []).map((c) => ({ value: c, label: c }))} onChange={setCategory} />
        )}
        <AppInput label="Subject" required maxLength={200} placeholder="What is your issue about?" value={subject} editable={!busy} onChangeText={setSubject} />
        <AppInput label="Description" required multiline maxLength={5000} placeholder="Provide as much detail as possible…" value={description} editable={!busy} onChangeText={setDescription} />
        <Text style={type.label}>Attachments (optional)</Text>
        <AttachmentPicker files={files} onChange={setFiles} max={TICKET_MAX_ATTACHMENTS} disabled={busy} />
        {busy ? <UploadProgress progress={progress} label={files.length ? 'Uploading attachments' : 'Sending'} /> : null}
        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        <AppButton title="Submit ticket" variant="accent" loading={busy} onPress={submit} />
      </Card>
    </Screen>
  );
}
