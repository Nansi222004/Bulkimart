// Root: providers (session → customer state → storefront theme) around one native stack.
// Shell elements that the web renders once for the whole customer app live here: promotional splash,
// location prompt, voice search, coupon celebration, toasts/dialogs.
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { hydrateStorage } from '../src/lib/storage';
import { SessionProvider } from '../src/context/SessionContext';
import { UserProvider, useUser } from '../src/context/UserContext';
import { StorefrontProvider } from '../src/context/StorefrontContext';
import { useAppTheme } from '../src/theme/ThemeContext';
import ErrorBoundary from '../src/components/ErrorBoundary';
import FeedbackHost from '../src/components/FeedbackHost';
import AppEvents from '../src/components/AppEvents';
import PromotionalSplash from '../src/components/storefront/PromotionalSplash';
import LocationPromptModal from '../src/components/LocationPromptModal';
import VoiceSearchModal from '../src/components/VoiceSearchModal';
import CouponSuccessCelebration from '../src/components/CouponSuccessCelebration';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Shell() {
  const theme = useAppTheme();
  const { couponCelebration, appliedCoupon, couponView, isVoiceModalOpen, closeVoiceSearch, setPendingVoiceQuery, setActiveNav } = useUser();
  return <View style={{ flex: 1, backgroundColor: theme.pageBackground }}>
    <StatusBar style="dark" />
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: theme.pageBackground } }}>
      <Stack.Screen name="index" options={{ animation: 'none' }} />
      <Stack.Screen name="product" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="order/[id]" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="campaign/[id]" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="review/[id]" options={{ animation: 'slide_from_bottom' }} />
    </Stack>
    <AppEvents />
    <VoiceSearchModal isOpen={isVoiceModalOpen} onClose={closeVoiceSearch} onSearch={queryText => {
      if (queryText && queryText.trim()) { setPendingVoiceQuery(queryText.trim()); setActiveNav('search'); }
    }} />
    <LocationPromptModal />
    <CouponSuccessCelebration event={couponCelebration} active={Boolean(couponView && appliedCoupon?.code === couponCelebration?.code)} />
    <PromotionalSplash />
    <FeedbackHost />
  </View>;
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => { hydrateStorage().finally(() => setReady(true)); }, []);
  if (!ready) return null;
  return <ErrorBoundary app>
    <SessionProvider>
      <UserProvider>
        <StorefrontProvider>
          <Shell />
        </StorefrontProvider>
      </UserProvider>
    </SessionProvider>
  </ErrorBoundary>;
}
