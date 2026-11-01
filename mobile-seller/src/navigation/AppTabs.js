import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import OrdersScreen from '../screens/orders/OrdersScreen';
import ProductsScreen from '../screens/products/ProductsScreen';
import EarningsScreen from '../screens/finance/EarningsScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import SellerHeader from '../components/SellerHeader';
import { colors } from '../theme';

const Tab = createBottomTabNavigator();

const renderHeader = ({ options, route }) => <SellerHeader title={options.title || route.name} />;

// Text glyphs keep Stage 1 free of an icon-font dependency (the web nav uses glyphs too).
const icon = (glyph) => ({ color }) => <Text style={{ color, fontSize: 18 }} accessible={false}>{glyph}</Text>;

export default function AppTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        header: renderHeader,
        tabBarActiveTintColor: colors.primaryDark,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ tabBarIcon: icon('⌂') }} />
      <Tab.Screen name="Orders" component={OrdersScreen} options={{ tabBarIcon: icon('▣') }} />
      <Tab.Screen name="Products" component={ProductsScreen} options={{ tabBarIcon: icon('◫') }} />
      <Tab.Screen name="Earnings" component={EarningsScreen} options={{ title: 'Earnings', tabBarIcon: icon('₹') }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarIcon: icon('◉') }} />
    </Tab.Navigator>
  );
}
