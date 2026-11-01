import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';

// Background/quit-state FCM messages: the system tray shows the notification itself.
// Taps are handled in src/components/PushManager.js. Nothing is processed here.
setBackgroundMessageHandler(getMessaging(), async () => {});

AppRegistry.registerComponent(appName, () => App);
