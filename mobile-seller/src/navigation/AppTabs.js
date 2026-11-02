import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import OrdersScreen from '../screens/orders/OrdersScreen';
import ProductsScreen from '../screens/products/ProductsScreen';
import EarningsScreen from '../screens/finance/EarningsScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import SellerHeader from '../components/SellerHeader';
import Icon from '../components/Icon';
import { colors } from '../theme';

const Tab = createBottomTabNavigator();

const renderHeader = ({ options, route }) => <SellerHeader title={options.title || route.name} />;

// SVG line icons (react-native-svg), same style as the web seller nav.
const icon = (name) => ({ color, focused }) => <Icon name={name} size={22} color={color} strokeWidth={focused ? 2.4 : 2} />;

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
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ tabBarIcon: icon('home') }} />
      <Tab.Screen name="Orders" component={OrdersScreen} options={{ tabBarIcon: icon('orders') }} />
      <Tab.Screen name="Products" component={ProductsScreen} options={{ tabBarIcon: icon('products') }} />
      <Tab.Screen name="Earnings" component={EarningsScreen} options={{ title: 'Earnings', tabBarIcon: icon('wallet') }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarIcon: icon('user') }} />
    </Tab.Navigator>
  );
}
