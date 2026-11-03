import React from 'react';
import { ActionSheetIOS, Alert, Platform, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import SupportChatView from '../components/SupportChatView';
import BackButton from '../components/BackButton';
import { Text, TextInput } from '../components/ui';
import { toUploadFile } from '../components/AttachmentUploader';
import { useSupportChat } from '../hooks/useSupportChat';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 5 * 1024 * 1024;

const accept = (files) => {
  const ok = files.filter((f) => ALLOWED.includes(f.type) && (!f.size || f.size <= MAX_BYTES));
  if (ok.length < files.length) throw new Error('Only JPG, PNG, WEBP or PDF files up to 5 MB can be attached.');
  return ok.slice(0, 3);
};

/** Camera, photos or files — the same sources and types as ticket attachments. */
const pickAttachments = () => new Promise((resolve, reject) => {
  const from = async (source) => {
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error('Camera access was denied. Choose a photo or file instead.');
        const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
        return resolve(r.canceled ? [] : accept(r.assets.map((a) => toUploadFile(a, 'photo.jpg'))));
      }
      if (source === 'photos') {
        const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: true, selectionLimit: 3 });
        return resolve(r.canceled ? [] : accept(r.assets.map((a) => toUploadFile(a))));
      }
      const r = await DocumentPicker.getDocumentAsync({ type: ALLOWED, multiple: true, copyToCacheDirectory: true });
      return resolve(r.canceled ? [] : accept(r.assets.map((a) => toUploadFile(a))));
    } catch (err) { return reject(err); }
  };
  const options = [['Camera', 'camera'], ['Photos', 'photos'], ['Files', 'files']];
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions({ options: [...options.map((o) => o[0]), 'Cancel'], cancelButtonIndex: 3 },
      (i) => (i < 3 ? from(options[i][1]) : resolve([])));
  } else {
    Alert.alert('Attach', 'JPG, PNG, WEBP or PDF, up to 5 MB', options.map(([text, source]) => ({ text, onPress: () => from(source) })),
      { cancelable: true, onDismiss: () => resolve([]) });
  }
});

/** Route /support/chat[?order=<id>] — live chat with Bulkimart Support (customer session). */
export default function SupportChatScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { order } = useLocalSearchParams();
  const { orders, currentUser } = useUser();
  const chat = useSupportChat({ enabled: !!currentUser });
  const orderId = /^[a-f\d]{24}$/i.test(String(order || '')) ? String(order) : '';
  const relatedOrders = (Array.isArray(orders) ? orders : []).slice(0, 30).map((o) => ({ id: o._id, label: o.orderNo || String(o._id).slice(-6) }));
  const back = () => (router.canGoBack() ? router.back() : router.replace('/account'));

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: theme.pageBackground || '#f8fafc' }]}>
      <View style={styles.header}>
        <BackButton onPress={back} />
        <Text style={styles.title}>Help & Support</Text>
      </View>
      {!currentUser ? (
        <View style={styles.signin}><Text style={styles.signinText}>Sign in to chat with Bulkimart Support.</Text></View>
      ) : (
        <SupportChatView
          chat={chat}
          colors={{ primary: theme.primary || '#08b9e8', primaryDark: theme.action || '#078ccb', accent: '#ff8500', text: '#0f172a', textMuted: '#64748b', border: '#e2e8f0', surface: '#f8fafc', white: '#ffffff', error: '#dc2626' }}
          Text={Text}
          TextInput={TextInput}
          pickAttachments={pickAttachments}
          onCreateTicket={back}
          relatedOrders={orderId && !relatedOrders.some((o) => o.id === orderId) ? [{ id: orderId, label: 'This order' }, ...relatedOrders] : relatedOrders}
          initialRelatedOrderId={orderId}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
  title: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  signin: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  signinText: { fontSize: 15, color: '#475569', textAlign: 'center' },
});
