// Port of NotificationDrawer.jsx: the customer's notification list as a bottom sheet.
import React, { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useNotifications } from '../hooks/useNotifications';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { Text } from './ui';

const EVENT_ICON = { order: '📦', delivery: '🚴', promotion: '🎉', system: 'ℹ️', broadcast: '📢' };
const timeAgo = iso => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

export default function NotificationDrawer({ isOpen, onClose }) {
  const theme = useAppTheme();
  const router = useRouter();
  const { setActiveNav } = useUser();
  const { notifications, loading, markRead, markAllRead } = useNotifications({ autoFetch: isOpen });
  const [lightbox, setLightbox] = useState(null);
  const visible = notifications.filter(item => !['subscription', 'membership'].includes(item.type));
  const unread = visible.filter(item => !item.isRead).length;
  const handlePress = n => {
    if (!n.isRead) markRead(n._id);
    const legal = (n.route || '').match(/^\/legal-services\/requests\/([a-f\d]{24})$/i);
    if (legal) { onClose(); router.push(`/legal-services?request=${legal[1]}`); return; }
    if ((n.route || '').startsWith('/orders')) { setActiveNav('orders'); onClose(); }
  };
  return <Modal visible={isOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={() => (lightbox ? setLightbox(null) : onClose())}>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: theme.cardBackground }]}>
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.title}>🔔 Notifications</Text>
            {unread > 0 && <Text style={styles.badge}>{unread} New</Text>}
          </View>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.close}><Text style={{ fontSize: 16, color: '#64748b' }}>✕</Text></Pressable>
        </View>
        <View style={styles.actions}>
          <Pressable onPress={markAllRead} disabled={unread === 0} style={{ opacity: unread === 0 ? 0.4 : 1, alignSelf: 'flex-start' }}><Text style={{ color: theme.primaryColor, fontSize: 11, fontWeight: '800' }}>Mark all read</Text></Pressable>
        </View>
        <FlatList data={visible} keyExtractor={n => String(n._id)} contentContainerStyle={{ padding: 8 }}
          ListEmptyComponent={loading ? <Text style={styles.empty}>Loading…</Text> : <View style={{ paddingVertical: 40, alignItems: 'center' }}><Text style={{ fontSize: 24, marginBottom: 8 }}>📭</Text><Text style={styles.empty}>No notifications yet</Text></View>}
          renderItem={({ item: n }) => <Pressable onPress={() => handlePress(n)} style={[styles.item, n.isRead ? styles.read : { backgroundColor: theme.primaryLight, borderColor: theme.primaryColor }]}>
            <Text style={{ fontSize: 18 }}>{EVENT_ICON[n.type] || 'ℹ️'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemTitle, { color: theme.textPrimary, fontWeight: n.isRead ? '700' : '800' }]}>{n.title}</Text>
              <Text style={[styles.itemMsg, { color: theme.textSecondary }]}>{n.message}</Text>
              {n.media?.url ? <Pressable onPress={() => setLightbox(n.media.url)}><Image source={{ uri: n.media.url }} style={styles.thumb} contentFit="cover" /></Pressable> : null}
              <Text style={styles.time}>{timeAgo(n.createdAt)}</Text>
            </View>
            {!n.isRead && <View style={styles.dot} />}
          </Pressable>} />
      </View>
      {lightbox && <View style={styles.lightbox}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setLightbox(null)} />
        <Image source={{ uri: lightbox }} style={{ width: '100%', height: '80%', borderRadius: 8 }} contentFit="contain" />
        <Pressable onPress={() => setLightbox(null)} accessibilityLabel="Close" style={styles.lightboxClose}><Text style={{ color: '#fff', fontSize: 16 }}>✕</Text></Pressable>
      </View>}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '82%', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  title: { fontSize: 15, fontWeight: '800' },
  badge: { fontSize: 10, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10, backgroundColor: '#ef4444', color: '#fff', fontWeight: '800', overflow: 'hidden' },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  actions: { paddingVertical: 8, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', backgroundColor: '#f8fafc' },
  empty: { textAlign: 'center', color: '#94a3b8', fontSize: 12 },
  item: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 12, marginBottom: 6, backgroundColor: '#fff', borderWidth: 1, borderColor: '#f1f5f9' },
  read: { opacity: 0.72 },
  itemTitle: { fontSize: 12.5 },
  itemMsg: { fontSize: 11, marginTop: 3 },
  thumb: { width: '100%', maxWidth: 220, height: 120, borderRadius: 8, marginTop: 8 },
  time: { fontSize: 9.5, color: '#94a3b8', fontWeight: '700', marginTop: 5 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444', marginTop: 4 },
  lightbox: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  lightboxClose: { position: 'absolute', top: 40, right: 18, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
});
