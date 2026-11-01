import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../context/AuthContext';
import { DutyProvider, useDuty } from '../context/DutyContext';
import { OrderOfferModal, ReturnOfferModal } from '../components/OfferModal';
import PushManager from '../components/PushManager';
import LoginScreen from '../screens/auth/LoginScreen';
import { ApplicationStatusScreen, SessionErrorScreen, SplashScreen } from '../screens/auth/SessionScreens';
import OnboardingScreen from '../screens/onboarding/OnboardingScreen';
import DutyScreen from '../screens/duty/DutyScreen';
import EarningsScreen from '../screens/earnings/EarningsScreen';
import CashScreen from '../screens/earnings/CashScreen';
import HistoryScreen from '../screens/history/HistoryScreen';
import { ReturnDetailScreen, ReturnPickupsScreen } from '../screens/returns/ReturnPickupsScreens';
import { ParcelDetailScreen, ParcelsScreen } from '../screens/parcels/ParcelScreens';
import ProfileScreen from '../screens/profile/ProfileScreen';
import NotificationsScreen from '../screens/notifications/NotificationsScreen';
import { SupportScreen, TicketDetailScreen } from '../screens/support/SupportScreens';
import { colors } from '../theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Emoji ignore tint colours, so the inactive state is shown by fading instead.
const icon = (glyph) => ({ focused }) => <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.45 }}>{glyph}</Text>;

// Branded header used on every tab: logo + screen title on the left, notification bell on the right.
function BrandTitle({ title }) {
  return (
    <View style={styles.brand}>
      <Image source={require('../assets/delivery-logo.png')} style={styles.brandLogo} accessibilityIgnoresInvertColors />
      <Text style={styles.brandTitle} numberOfLines={1}>{title}</Text>
    </View>
  );
}

function BellButton({ navigation }) {
  const { unreadCount } = useDuty();
  const count = unreadCount > 99 ? '99+' : String(unreadCount);
  return (
    <Pressable onPress={() => navigation.navigate('Notifications')} accessibilityRole="button"
      accessibilityLabel={unreadCount ? `Notifications, ${count} unread` : 'Notifications'} hitSlop={8} style={styles.bell}>
      <Text style={styles.bellIcon}>🔔</Text>
      {unreadCount > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View> : null}
    </Pressable>
  );
}

function MainTabs() {
  const { activeOrder, returnPickups } = useDuty();
  const insets = useSafeAreaInsets();
  // The tab bar sits above the phone's gesture / navigation bar instead of under it.
  const bottom = Math.max(insets.bottom, 8);
  return (
    <Tab.Navigator screenOptions={({ navigation, route }) => ({
      headerTitle: () => <BrandTitle title={route.name === 'Duty' && activeOrder ? 'Current delivery' : TAB_TITLES[route.name]} />,
      headerTitleAlign: 'left',
      headerRight: () => <BellButton navigation={navigation} />,
      headerStyle: styles.header,
      headerShadowVisible: false,
      tabBarActiveTintColor: colors.primaryDark, tabBarInactiveTintColor: colors.textSecondary,
      tabBarLabelStyle: styles.tabLabel,
      tabBarStyle: [styles.tabBar, { height: 58 + bottom, paddingBottom: bottom }],
      tabBarItemStyle: styles.tabItem,
      tabBarHideOnKeyboard: true,
    })}>
      <Tab.Screen name="Duty" component={DutyScreen} options={{ tabBarLabel: activeOrder ? 'Delivery' : 'Duty', tabBarIcon: icon('🛵') }} />
      <Tab.Screen name="Earnings" component={EarningsScreen} options={{ tabBarIcon: icon('💰') }} />
      <Tab.Screen name="History" component={HistoryScreen} options={{ tabBarIcon: icon('🕘') }} />
      <Tab.Screen name="Returns" component={ReturnPickupsScreen} options={{ tabBarIcon: icon('↩️'),
        tabBarBadge: returnPickups.pending.length || undefined, tabBarBadgeStyle: styles.tabBadge }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarIcon: icon('👤') }} />
    </Tab.Navigator>
  );
}

const STACK_OPTIONS = { headerTitleStyle: { fontWeight: '800', color: colors.deepBlue }, headerTintColor: colors.deepBlue, headerShadowVisible: false, headerStyle: { backgroundColor: colors.white } };
const TAB_TITLES = { Duty: 'Duty', Earnings: 'Earnings', History: 'Trip history', Returns: 'Return pickups', Profile: 'My profile' };

const styles = StyleSheet.create({
  header: { backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 260 },
  brandLogo: { width: 36, height: 36, borderRadius: 8 },
  brandTitle: { fontSize: 19, fontWeight: '800', color: colors.deepBlue, flexShrink: 1 },
  bell: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 8, backgroundColor: colors.aquaLight },
  bellIcon: { fontSize: 20 },
  badge: { position: 'absolute', top: 2, right: 0, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: '800' },
  tabBar: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6, elevation: 8 },
  tabItem: { paddingVertical: 2 },
  tabLabel: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  tabBadge: { backgroundColor: colors.orange, color: colors.white, fontSize: 11, fontWeight: '800' },
});

// Offer pop-ups sit above every screen, as on the web portal (offers can arrive on any tab).
function OfferHost() {
  const d = useDuty();
  if (d.offer) return <OrderOfferModal offer={d.offer} onAccept={d.acceptOffer} onDecline={d.declineOffer} onExpire={d.expireOffer} />;
  if (d.returnOffer) return <ReturnOfferModal offer={d.returnOffer} onAccept={d.acceptReturn} onDecline={d.declineReturn} onExpire={d.expireReturn} />;
  return null;
}

function ApprovedStack() {
  return (
    <DutyProvider>
      <Stack.Navigator screenOptions={STACK_OPTIONS}>
        <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="Cash" component={CashScreen} options={{ title: 'COD cash & earnings records' }} />
        <Stack.Screen name="Parcels" component={ParcelsScreen} options={{ title: 'Parcel deliveries' }} />
        <Stack.Screen name="ParcelDetail" component={ParcelDetailScreen} options={{ title: 'Parcel' }} />
        <Stack.Screen name="ReturnDetail" component={ReturnDetailScreen} options={{ title: 'Return pickup' }} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} />
        <Stack.Screen name="Support" component={SupportScreen} options={{ title: 'Help & support' }} />
        <Stack.Screen name="TicketDetail" component={TicketDetailScreen} options={{ title: 'Ticket' }} />
      </Stack.Navigator>
      <OfferHost />
      <PushManager />
    </DutyProvider>
  );
}

function ApplicantStack({ status }) {
  return (
    <Stack.Navigator screenOptions={STACK_OPTIONS}>
      {status === 'incomplete'
        ? <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
        : <Stack.Screen name="Status" component={ApplicationStatusScreen} options={{ headerShown: false }} />}
      {status === 'rejected' ? <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ title: 'Update application' }} /> : null}
      <Stack.Screen name="Support" component={SupportScreen} options={{ title: 'Help & support' }} />
      <Stack.Screen name="TicketDetail" component={TicketDetailScreen} options={{ title: 'Ticket' }} />
    </Stack.Navigator>
  );
}

/**
 * Which part of the app the rider may see is decided only by the server's answer:
 * signed out -> login; session check failed -> retry; application not approved -> onboarding or status;
 * approved -> the rider app. Suspended and rejected riders never reach the duty screens.
 */
export default function RootNavigator() {
  const { phase, profile } = useAuth();
  if (phase === 'loading') return <SplashScreen />;
  if (phase === 'error') return <SessionErrorScreen />;
  if (phase !== 'signedIn' || !profile) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
      </Stack.Navigator>
    );
  }
  if (profile.status === 'approved') return <ApprovedStack key={`approved:${profile._id}`} />;
  return <ApplicantStack key={`applicant:${profile._id}:${profile.status}`} status={profile.status} />;
}
