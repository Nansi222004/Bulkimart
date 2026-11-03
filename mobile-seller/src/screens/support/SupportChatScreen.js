import React from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, TextInput } from '../../components/AppText';
import SupportChatView from '../../components/SupportChatView';
import { useAppSupportChat } from '../../hooks/useAppSupportChat';
import { pickDocument } from '../../utils/documents';
import { MediaError } from '../../utils/media';
import { colors } from '../../theme';

/** Camera / gallery / files, same sources and limits as ticket attachments. */
const pickAttachments = () => new Promise((resolve, reject) => {
  const from = (source) => pickDocument(source, { multiple: source !== 'camera', limit: 3 })
    .then(resolve)
    .catch((e) => reject(new Error(e instanceof MediaError ? e.message : 'Could not attach the file.')));
  Alert.alert('Attach', 'JPG, PNG, WEBP or PDF, up to 5 MB each', [
    { text: 'Camera', onPress: () => from('camera') },
    { text: 'Gallery', onPress: () => from('gallery') },
    { text: 'Files', onPress: () => from('files') },
    { text: 'Cancel', style: 'cancel', onPress: () => resolve([]) },
  ], { cancelable: true, onDismiss: () => resolve([]) });
});

/** Live chat with Bulkimart Support (seller session). Route: SupportChat { orderId? }. */
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
          onCreateTicket={() => navigation.navigate('CreateTicket')}
          relatedOrders={orderId ? [{ id: orderId, label: route?.params?.orderNo || 'This order' }] : []}
          initialRelatedOrderId={orderId}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.surface } });
