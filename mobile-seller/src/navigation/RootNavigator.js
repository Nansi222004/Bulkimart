import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import SplashScreen from '../screens/auth/SplashScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import NoSellerAccountScreen from '../screens/auth/NoSellerAccountScreen';
import StatusGateScreen from '../screens/auth/StatusGateScreen';
import OnboardingScreen from '../screens/onboarding/OnboardingScreen';
import ReturnsScreen from '../screens/returns/ReturnsScreen';
import ReturnDetailScreen from '../screens/returns/ReturnDetailScreen';
import SupportScreen from '../screens/support/SupportScreen';
import CreateTicketScreen from '../screens/support/CreateTicketScreen';
import TicketDetailScreen from '../screens/support/TicketDetailScreen';
import BusinessSettingsScreen from '../screens/profile/BusinessSettingsScreen';
import KycDetailsScreen from '../screens/profile/KycDetailsScreen';
import PushManager from '../components/PushManager';
import ProductFaqsScreen from '../screens/products/ProductFaqsScreen';
import WholesalePricingScreen from '../screens/products/WholesalePricingScreen';
import StoreLocationScreen from '../screens/profile/StoreLocationScreen';
import AdvertisingScreen from '../screens/advertising/AdvertisingScreen';
import CampaignDetailScreen from '../screens/advertising/CampaignDetailScreen';
import CampaignBuilderScreen from '../screens/advertising/CampaignBuilderScreen';
import AppTabs from './AppTabs';
import OrderDetailScreen from '../screens/orders/OrderDetailScreen';
import PayoutRequestScreen from '../screens/finance/PayoutRequestScreen';
import PayoutHistoryScreen from '../screens/finance/PayoutHistoryScreen';
import TaxStatementScreen from '../screens/finance/TaxStatementScreen';
import NotificationsScreen from '../screens/notifications/NotificationsScreen';
import EditProfileScreen from '../screens/profile/EditProfileScreen';
import PickupSyncScreen from '../screens/profile/PickupSyncScreen';
import ProductDetailScreen from '../screens/products/ProductDetailScreen';
import ProductFormScreen from '../screens/products/ProductFormScreen';
import StockScreen from '../screens/inventory/StockScreen';
import FulfillmentScreen from '../screens/orders/FulfillmentScreen';
import TrackOrdersScreen from '../screens/orders/TrackOrdersScreen';
import InvoicesScreen from '../screens/invoices/InvoicesScreen';
import InvoiceDetailScreen from '../screens/invoices/InvoiceDetailScreen';
import SalesReportScreen from '../screens/reports/SalesReportScreen';
import { colors } from '../theme';

const Stack = createNativeStackNavigator();

const screenOptions = {
  headerTintColor: colors.deepBlue,
  headerTitleStyle: { fontWeight: '700' },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.surface },
};

// The gate comes from the server (see AuthContext). Each gate has its own stack,
// so a seller who isn't approved can never navigate into the panel.
export default function RootNavigator() {
  const { gate } = useAuth();

  if (gate === 'loading' || gate === 'verifyError') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Splash" component={SplashScreen} />
      </Stack.Navigator>
    );
  }

  if (gate === 'signedOut') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
      </Stack.Navigator>
    );
  }

  if (gate === 'noSeller') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="NoSellerAccount" component={NoSellerAccountScreen} />
      </Stack.Navigator>
    );
  }

  if (gate === 'onboarding') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      </Stack.Navigator>
    );
  }

  if (gate === 'status') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="StatusGate" component={StatusGateScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <>
    <PushManager />
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Tabs" component={AppTabs} options={{ headerShown: false }} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Order details' }} />
      <Stack.Screen name="PayoutRequest" component={PayoutRequestScreen} options={{ title: 'Payout request' }} />
      <Stack.Screen name="PayoutHistory" component={PayoutHistoryScreen} options={{ title: 'Payout history' }} />
      <Stack.Screen name="TaxStatement" component={TaxStatementScreen} options={{ title: 'Tax statement' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: 'Edit profile' }} />
      <Stack.Screen name="PickupSync" component={PickupSyncScreen} options={{ title: 'Pickup registration' }} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} options={{ title: 'Product' }} />
      <Stack.Screen name="ProductForm" component={ProductFormScreen} options={{ title: 'Product' }} />
      <Stack.Screen name="Stock" component={StockScreen} options={{ title: 'Stock' }} />
      <Stack.Screen name="Fulfillment" component={FulfillmentScreen} options={{ title: 'Choose delivery method' }} />
      <Stack.Screen name="TrackOrders" component={TrackOrdersScreen} options={{ title: 'Track orders' }} />
      <Stack.Screen name="Invoices" component={InvoicesScreen} options={{ title: 'Invoices' }} />
      <Stack.Screen name="InvoiceDetail" component={InvoiceDetailScreen} options={{ title: 'Invoice' }} />
      <Stack.Screen name="SalesReport" component={SalesReportScreen} options={{ title: 'Sales report' }} />
      <Stack.Screen name="Returns" component={ReturnsScreen} options={{ title: 'Returns' }} />
      <Stack.Screen name="ReturnDetail" component={ReturnDetailScreen} options={{ title: 'Return' }} />
      <Stack.Screen name="Support" component={SupportScreen} options={{ title: 'Support' }} />
      <Stack.Screen name="CreateTicket" component={CreateTicketScreen} options={{ title: 'New ticket' }} />
      <Stack.Screen name="TicketDetail" component={TicketDetailScreen} options={{ title: 'Ticket' }} />
      <Stack.Screen name="BusinessSettings" component={BusinessSettingsScreen} options={{ title: 'Business settings' }} />
      <Stack.Screen name="KycDetails" component={KycDetailsScreen} options={{ title: 'KYC & payout details' }} />
      <Stack.Screen name="ProductFaqs" component={ProductFaqsScreen} options={{ title: 'Product questions' }} />
      <Stack.Screen name="WholesalePricing" component={WholesalePricingScreen} options={{ title: 'Wholesale prices' }} />
      <Stack.Screen name="StoreLocation" component={StoreLocationScreen} options={{ title: 'Store location' }} />
      <Stack.Screen name="Advertising" component={AdvertisingScreen} options={{ title: 'Advertising' }} />
      <Stack.Screen name="CampaignDetail" component={CampaignDetailScreen} options={{ title: 'Campaign' }} />
      <Stack.Screen name="CampaignBuilder" component={CampaignBuilderScreen} options={{ title: 'Campaign' }} />
    </Stack.Navigator>
    </>
  );
}
