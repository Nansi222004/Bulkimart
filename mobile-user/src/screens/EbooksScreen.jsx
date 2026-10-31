// Port of modules/User/pages/DigitalLibraryPage.jsx (route /ebooks, sign-in required).
// Native replacements for the browser PDF handling:
//  - the PDF is fetched once per visit from the same authenticated endpoint into the app cache;
//  - "View PDF" opens it in the phone's PDF viewer (the web shows it in an <object> overlay; Android has no
//    built-in PDF view), falling back to the share sheet when no viewer is installed;
//  - "Download PDF" asks where to save it (system folder picker) and writes a copy there.
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Directory, File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { apiUrl, getToken, mediaUrl, request } from '../api/client';
import { local } from '../lib/storage';
import { CustomerPage, useNavPadding } from '../components/Shell';
import { Text } from '../components/ui';

const safeName = value => String(value || 'ebook').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'ebook';

export default function EbooksScreen() {
  const theme = useAppTheme();
  const primary = theme.primaryColor;
  const { setActiveNav } = useUser();
  const bottom = useNavPadding(16);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(null);
  const [downloaded, setDownloaded] = useState({});
  const [viewing, setViewing] = useState(null);
  const files = useRef({});

  useEffect(() => {
    let alive = true;
    request('/api/digital/library').then(({ ok, body }) => {
      if (!ok) throw new Error(body.message || 'Could not load your e-books');
      if (!alive) return;
      const list = body.data || [];
      setItems(list);
      const initial = {};
      list.forEach(entry => { if (entry.downloadCount > 0 || entry.lastDownloadedAt || local.getItem(`downloaded_ebook_${entry.id}`)) initial[entry.id] = true; });
      setDownloaded(prev => ({ ...prev, ...initial }));
    }).catch(err => alive && setError(err.message)).finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      Object.values(files.current).forEach(file => { try { file.delete(); } catch { /* already gone */ } });
    };
  }, []);

  const pdfFileFor = async (entry, inline = false) => {
    if (files.current[entry.id]?.exists) return files.current[entry.id];
    const path = `/api/digital/library/${entry.id}/download${inline ? '?inline=1' : ''}`;
    const target = new File(Paths.cache, `ebook-${entry.id}.pdf`);
    try {
      const file = await File.downloadFileAsync(apiUrl(path), target, { headers: { Authorization: `Bearer ${getToken() || ''}` }, idempotent: true });
      return (files.current[entry.id] = file);
    } catch {
      // The download failed (non-2xx or network): ask the endpoint for its message.
      const { body } = await request(path).catch(() => ({ body: {} }));
      throw new Error(body?.message || 'Download is temporarily unavailable');
    }
  };

  const download = async entry => {
    setDownloading(entry.id); setError('');
    try {
      const file = await pdfFileFor(entry);
      const name = `${safeName(entry.product?.name)}.pdf`;
      let saved = false;
      if (Platform.OS === 'android') {
        let folder = null;
        try { folder = await Directory.pickDirectoryAsync(); } catch { folder = null; }
        if (folder) {
          const copy = folder.createFile(name, 'application/pdf');
          await copy.write(await file.bytes());
          saved = true;
        }
      }
      if (!saved) {
        if (!(await Sharing.isAvailableAsync())) throw new Error('Saving files is not available on this device.');
        await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: name, UTI: 'com.adobe.pdf' });
      }
      local.setItem(`downloaded_ebook_${entry.id}`, 'true');
      setDownloaded(current => ({ ...current, [entry.id]: true }));
    } catch (err) { setError(err.message); } finally { setDownloading(null); }
  };

  const view = async entry => {
    setViewing(entry.id); setError('');
    try {
      const file = await pdfFileFor(entry, true);
      try {
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: file.contentUri, type: 'application/pdf', flags: 1 });
      } catch {
        if (!(await Sharing.isAvailableAsync())) throw new Error('No PDF viewer is installed on this device.');
        await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: entry.product?.name || 'E-book Reader' });
      }
    } catch (err) { setError(err.message); } finally { setViewing(null); }
  };

  const renderItem = ({ item: entry }) => <View style={[styles.card, { borderColor: theme.border }]}>
    <Image source={{ uri: mediaUrl(entry.product?.images?.[0]) || undefined }} style={styles.cover} contentFit="cover" />
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={{ fontSize: 10, fontWeight: '900', color: primary, textTransform: 'uppercase' }}>Digital E-book</Text>
      <Text style={{ marginVertical: 4, fontSize: 15, fontWeight: '700' }}>{entry.product?.name || 'E-book'}</Text>
      <Text style={{ fontSize: 12, color: '#64748b' }}>{entry.product?.digital?.author || 'Unknown author'}</Text>
      <Text style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>Purchased {new Date(entry.activatedAt).toLocaleDateString('en-IN')} · {entry.order?.orderNo}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        <Pressable disabled={!entry.downloadAvailable || downloading === entry.id} onPress={() => download(entry)}
          style={[styles.primaryBtn, { backgroundColor: primary, opacity: entry.downloadAvailable ? 1 : 0.55 }]}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{downloading === entry.id ? 'Preparing…' : !entry.downloadAvailable ? 'Unavailable' : downloaded[entry.id] ? 'Downloaded ✓' : 'Download PDF'}</Text>
        </Pressable>
        {entry.downloadAvailable && <Pressable disabled={viewing === entry.id} onPress={() => view(entry)} style={[styles.outlineBtn, { borderColor: primary }]}>
          <Text style={{ color: primary, fontWeight: '700', fontSize: 13 }}>{viewing === entry.id ? 'Opening…' : 'View PDF'}</Text>
        </Pressable>}
      </View>
    </View>
  </View>;

  return <CustomerPage protectedPage headerColor="#ffffff" background="#ffffff">
    <View style={styles.headerRow}>
      <Pressable onPress={() => setActiveNav('account')} accessibilityLabel="Back to account" hitSlop={10}><Text style={{ fontSize: 26, lineHeight: 28 }}>‹</Text></Pressable>
      <Text style={styles.title}>MY E-BOOKS</Text>
      <View style={{ width: 20 }} />
    </View>
    <View style={{ height: 1.5, backgroundColor: '#f1f5f9' }} />
    {error ? <View style={styles.error}><Text style={{ color: '#b91c1c' }} accessibilityRole="alert">{error}</Text></View> : null}
    {loading ? <Text style={{ padding: 32, textAlign: 'center' }}>Loading your library…</Text>
      : <FlatList data={items} keyExtractor={entry => String(entry.id)} renderItem={renderItem} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: bottom }}
        ListEmptyComponent={<View style={{ padding: 24, alignItems: 'center' }}>
          <Text style={{ fontSize: 42 }}>📚</Text>
          <Text style={{ marginTop: 8, color: '#0f172a', fontWeight: '700' }}>No purchased e-books yet</Text>
          <Text style={{ color: '#64748b', textAlign: 'center' }}>Verified purchases will appear here automatically.</Text>
        </View>} />}
  </CustomerPage>;
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, paddingHorizontal: 16, paddingBottom: 8, backgroundColor: '#fff' },
  title: { fontSize: 14, fontWeight: '800', letterSpacing: 0.8 },
  error: { margin: 16, padding: 12, borderRadius: 10, backgroundColor: '#fef2f2' },
  card: { padding: 14, flexDirection: 'row', gap: 14, borderWidth: 1, borderRadius: 14, backgroundColor: '#fff' },
  cover: { width: 76, height: 104, borderRadius: 9, backgroundColor: '#e2e8f0' },
  primaryBtn: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12 },
  outlineBtn: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5, backgroundColor: '#fff' },
});
