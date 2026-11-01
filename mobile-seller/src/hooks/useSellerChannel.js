import { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';

// Retail storefronts this seller sells on: 'ecommerce' (Shop All) and/or 'grocery' (Quick Commerce).
// Same default as the web panel: Shop All when the seller profile doesn't say otherwise.
export const CHANNEL_LABEL = { ecommerce: 'Shop All', grocery: 'Quick Commerce' };

export default function useSellerChannel() {
  const { salesChannels } = useAuth();
  const channels = useMemo(() => {
    const retail = ['ecommerce', 'grocery'].filter((c) => salesChannels.includes(c));
    return retail.length ? retail : ['ecommerce'];
  }, [salesChannels]);
  const [channel, setChannel] = useState(channels[0]);
  const active = channels.includes(channel) ? channel : channels[0];
  return { channels, channel: active, setChannel, isHybrid: channels.length > 1 };
}
