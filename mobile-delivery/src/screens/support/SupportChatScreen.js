import React from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { Text, TextInput } from '../../components/AppText';
import SupportChatView from '../../components/SupportChatView';
import { checkPickedFile } from '../../components/DocumentPhotoField';
import { useAppSupportChat } from '../../hooks/useAppSupportChat';
import { colors } from '../../theme';

const OPTIONS = { mediaType: 'photo', quality: 0.7, maxWidth: 1600, maxHeight: 1600 };

/** Photos from the camera or gallery — the same limits as ticket photos. */
const pickAttachments = () => new Promise((resolve, reject) => {
  const handle = (result) => {
    if (result?.didCancel || !result?.assets) return resolve([]);
    const bad = result.assets.map(checkPickedFile).find(Boolean);
    if (bad) return reject(new Error(bad));
    return resolve(result.assets.map((a) => ({ uri: a.uri, name: a.fileName || 'photo.jpg', type: a.type || 'image/jpeg', size: a.fileSize })));
  };
  Alert.alert('Attach a photo', 'JPG, PNG or WEBP, up to 5 MB', [
    { text: 'Camera', onPress: () => launchCamera(OPTIONS).then(handle).catch(() => reject(new Error('Could not open the camera.'))) },
    { text: 'Gallery', onPress: () => launchImageLibrary({ ...OPTIONS, selectionLimit: 3 }).then(handle).catch(() => reject(new Error('Could not open the gallery.'))) },
    { text: 'Cancel', style: 'cancel', onPress: () => resolve([]) },
  ], { cancelable: true, onDismiss: () => resolve([]) });
});

/** Live chat with Bulkimart Support (delivery partner session). Route: SupportChat { orderId?, orderNo? }. */
export default function SupportChatScreen({ navigation, route }) {
  const chat = useAppSupportChat();
  const orderId = route?.params?.orderId || '';
  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <View style={styles.root}>
        <SupportChatView
          chat={chat}
          colors={{ primary: colors.primary, primaryDark: colors.primaryDark, accent: colors.orange, text: colors.text, textMuted: colors.textSecondary, border: colors.border, surface: colors.surface, white: colors.white, error: colors.error }}
          Text={Text}
          TextInput={TextInput}
          pickAttachments={pickAttachments}
          onCreateTicket={() => navigation.navigate('Support', orderId ? { orderId, orderNo: route?.params?.orderNo } : undefined)}
          relatedOrders={orderId ? [{ id: orderId, label: route?.params?.orderNo || 'This delivery' }] : []}
          initialRelatedOrderId={orderId}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.surface } });
