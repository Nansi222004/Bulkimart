// Port of usePromotionNavigation.js: where an admin-configured banner/splash/header destination leads.
import { Linking } from 'react-native';
import { useUser } from '../context/UserContext';

export default function usePromotionNavigation() {
  const { setSelectedCategoryFilter, setSelectedCampaignId, setActiveNav, setActiveSubNav, openProductById } = useUser();
  return destination => {
    if (!destination) return;
    if (destination.type === 'CATEGORY') setSelectedCategoryFilter({ _id: destination.id, slug: destination.slug, name: destination.name });
    if (destination.type === 'CAMPAIGN') setSelectedCampaignId(destination.id);
    if (destination.type === 'SUBNAV' && ['groceries', 'electronics', 'fashion', 'smart-buy', 'hot-deals'].includes(destination.id)) { setActiveNav('home'); setActiveSubNav(destination.id); }
    if (destination.type === 'NAV' && ['cart', 'categories', 'account', 'orders'].includes(destination.id)) setActiveNav(destination.id);
    if (destination.type === 'PRODUCT' && /^[a-f\d]{24}$/i.test(destination.id)) openProductById(destination.id);
    if (destination.type === 'EXTERNAL_URL') {
      try {
        const url = new URL(destination.url);
        if (url.protocol === 'https:' && !url.username && !url.password) Linking.openURL(url.href).catch(() => {});
      } catch { /* invalid destination */ }
    }
  };
}
