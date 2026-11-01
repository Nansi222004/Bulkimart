import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import StatusPill from '../../components/StatusPill';
import KeyValueRow from '../../components/KeyValueRow';
import ReasonPrompt from '../../components/ReasonPrompt';
import { ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import OrderFinanceSection from './OrderFinanceSection';
import { getSellerOrder, updateOrderStatus } from '../../services/seller.api';
import { ORDER_LABEL, actionsFor, byCourier, sellerPricingRows, sellerTimeline } from '../../utils/orderAmounts';
import { addressText, detailMoney, fullDate, statusText } from '../../utils/format';
import { spacing, type } from '../../theme';

// Port of OrdersTab detail mode + orderDetailSections.jsx.
// Buttons come only from order.permittedActions (server-authorized); with no data, there are no buttons.
const POLL_MS = 15000; // Same interval the web uses while an order detail is open.

const notify = (message) => ToastAndroid.show(message, ToastAndroid.LONG);
const httpsLink = (url) => { try { return new URL(url).protocol === 'https:' ? url : null; } catch { return null; } };

export default function OrderDetailScreen({ route, navigation }) {
  const { id, orderNo } = route.params;
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState(null); // { kind: 'reject' | 'dispatch', action }
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { navigation.setOptions({ title: orderNo || 'Order details' }); }, [navigation, orderNo]);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(''); }
    try {
      const body = await getSellerOrder(id);
      if (!alive.current) return;
      if (!body?.data) throw new Error('Order unavailable or access denied');
      setOrder(body.data); setError('');
    } catch (e) {
      if (alive.current && !silent) { setOrder(null); setError(e.status === 403 || e.status === 404 ? 'Order unavailable or access denied' : e.message || 'Could not load order. Please retry.'); }
    } finally { if (alive.current && !silent) setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  // Background refresh only while this screen is visible. Returning from delivery setup re-reads at once.
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) firstFocus.current = false; else load(true);
    const timer = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [load]));

  const run = async (to, extra = {}) => {
    setBusy(true);
    try {
      const body = await updateOrderStatus(order._id, to, { version: order.version, ...extra });
      notify(body?.message || 'Order updated');
      await load(true);
      return true;
    } catch (e) {
      notify(e.message || 'Could not update this order');
      if (e.status === 409) await load(true); // The order changed on the server; show the current state.
      return false;
    } finally { if (alive.current) setBusy(false); }
  };

  const onAction = (action) => {
    if (action.reject) { setPrompt({ kind: 'reject', action }); return; }
    if (action.setup) {
      navigation.navigate('Fulfillment', { orderId: order._id, orderNo: order.orderNo, channel: order.channel });
      return;
    }
    if (byCourier(order) && action.to === 'dispatched' && !(order.shiprocket?.awb && order.shiprocket?.courier)) {
      setPrompt({ kind: 'dispatch', action });
      return;
    }
    Alert.alert(action.label, `Update order ${order.orderNo}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: action.label, onPress: () => run(action.to) },
    ]);
  };

  const submitPrompt = async (values) => {
    const ok = prompt.kind === 'reject'
      ? await run('cancelled', { reason: values.reason })
      : await run('dispatched', { courier: values.courier, awb: values.awb });
    if (ok && alive.current) setPrompt(null);
  };

  if (loading && !order) return <LoadingView message="Loading order…" />;
  if (error && !order) return <ErrorView message={error} onRetry={() => load()} />;
  if (!order) return null;

  const actions = actionsFor(order);
  const shipment = order.shiprocket;
  const delivery = order.deliveryAssignment;
  const returnReason = order.returnReason || order.returnRequest?.reason;
  const returnDescription = order.returnDescription || order.returnRequest?.customerDescription;

  return (
    <Screen onRefresh={() => load()} refreshing={false}>
      <Card title={order.orderNo} right={<StatusPill status={order.status} label={order.displayStatus || ORDER_LABEL[order.status] || order.status} />}>
        <Text style={type.small} selectable>Reference: {order._id}</Text>
        <KeyValueRow label="Placed" value={fullDate(order.placedAt)} />
        <KeyValueRow label="Storefront" value={order.channel === 'grocery' ? 'Quick Commerce' : 'E-Commerce'} />
        <KeyValueRow label="Payment" value={`${order.paymentMethod} · ${order.paymentStatus}`} />
        {order.cancellationReason ? <InlineNotice tone="error">Cancellation/rejection reason: {order.cancellationReason}</InlineNotice> : null}
        {(returnReason || returnDescription) ? (
          <InlineNotice tone="warning">
            Customer return request{returnReason ? ` — ${String(returnReason).replace(/_/g, ' ')}` : ''}{returnDescription ? `: “${returnDescription}”` : ''}
          </InlineNotice>
        ) : null}
        {order.customerInstructions ? <Text style={type.body}>Customer instructions: {order.customerInstructions}</Text> : null}
      </Card>

      {actions.length ? (
        <Card title="Actions">
          {actions.map((action) => (
            <AppButton key={`${action.label}:${action.to}`} title={action.label} loading={busy}
              variant={action.reject ? 'danger' : 'primary'} onPress={() => onAction(action)} />
          ))}
        </Card>
      ) : null}

      <Card title="Order & payment summary">
        {sellerPricingRows(order).map(([label, value]) => (
          <KeyValueRow key={label} label={label} strong={label === 'Order total'}
            value={`${label.toLowerCase().includes('discount') ? '−' : ''}${detailMoney(value)}`} />
        ))}
        {!order.pricing ? <Text style={type.small}>Full basket pricing is withheld for multi-store orders.</Text> : null}
      </Card>

      <OrderFinanceSection orderId={order._id} />

      <Card title={`Order items (${order.items?.length || 0})`}>
        {(order.items || []).map((item, index) => (
          <View key={item.productId || index} style={styles.item}>
            <Text style={type.label}>{item.name}</Text>
            <Text style={type.small}>SKU: {item.sku || 'Not recorded'} · {item.variantName || item.unit || 'Standard item'}</Text>
            <Text style={type.small}>Quantity: {item.qty} · Unit price: {detailMoney(item.price)} · Line total: {detailMoney(item.lineTotal)}</Text>
            {item.additionalMessage ? <Text style={type.small}>Customer message: {item.additionalMessage}</Text> : null}
          </View>
        ))}
      </Card>

      <Card title="Customer & delivery address">
        <Text style={type.label}>{order.shippingAddress?.name || order.customer?.name || 'Not recorded'}</Text>
        {order.shippingAddress?.phone ? <Text style={type.body} selectable>{order.shippingAddress.phone}</Text> : null}
        <Text style={type.body} selectable>{addressText(order.shippingAddress)}</Text>
        {order.shippingAddress?.landmark ? <Text style={type.small}>Landmark: {order.shippingAddress.landmark}</Text> : null}
        {order.shippingAddress?.instructions ? <Text style={type.small}>Delivery instructions: {order.shippingAddress.instructions}</Text> : null}
      </Card>

      <Card title="Store & pickup location">
        <Text style={type.label}>{order.store?.name || 'Not recorded'}</Text>
        <Text style={type.body}>{addressText(order.store?.pickupAddress)}</Text>
        <Text style={type.small}>Shiprocket pickup: {order.store?.pickupLocation || 'Not linked. Contact platform support to register and link your store pickup location.'}</Text>
      </Card>

      <Card title="Bulkimart delivery">
        {delivery ? (
          <>
            <KeyValueRow label="Rider" value={delivery.rider?.name || 'Name not recorded'} />
            <KeyValueRow label="Contact" value={delivery.rider?.phone || 'Not recorded'} />
            <KeyValueRow label="Assignment status" value={delivery.status} />
            <KeyValueRow label="Assigned" value={fullDate(delivery.assignedAt)} />
            {delivery.completedAt ? <KeyValueRow label="Completed" value={`${fullDate(delivery.completedAt)} · OTP verified: ${delivery.otpVerified ? 'Yes' : 'No'}`} /> : null}
          </>
        ) : (
          <Text style={type.small}>{order.fulfillment?.method === 'manual' ? 'Waiting for an eligible rider to accept. Sellers do not assign riders directly.' : 'Manual delivery not assigned.'}</Text>
        )}
      </Card>

      <Card title="Courier shipment">
        {shipment ? (
          <>
            <KeyValueRow label="Courier" value={shipment.courier || 'Not assigned'} />
            <KeyValueRow label="Shipment" value={shipment.shipmentId || 'Not created'} />
            <KeyValueRow label="AWB" value={shipment.awb || 'Not assigned'} />
            <KeyValueRow label="Status" value={shipment.status || 'Not recorded'} />
            {shipment.package ? <Text style={type.small}>Parcel: {shipment.package.length} × {shipment.package.breadth} × {shipment.package.height} cm · {shipment.package.weight} kg</Text> : null}
            <Text style={type.small}>Latest tracking: {shipment.webhookEvents?.at(-1)?.status || shipment.status} · {fullDate(shipment.webhookEvents?.at(-1)?.receivedAt)}</Text>
            <View style={styles.links}>
              {httpsLink(shipment.trackingUrl) ? <AppButton small variant="outline" title="Track shipment" onPress={() => Linking.openURL(shipment.trackingUrl)} /> : null}
              {httpsLink(shipment.labelUrl) ? <AppButton small variant="outline" title="Download label" onPress={() => Linking.openURL(shipment.labelUrl)} /> : null}
              {httpsLink(shipment.invoiceUrl) ? <AppButton small variant="outline" title="Courier invoice" onPress={() => Linking.openURL(shipment.invoiceUrl)} /> : null}
            </View>
            {shipment.lastError ? <InlineNotice tone="error">{shipment.lastError}</InlineNotice> : null}
            {shipment.status === 'reconciliation_required' ? <Text style={type.small}>Contact platform support to reconcile this order with Shiprocket before retrying. Shipment creation is locked.</Text> : null}
          </>
        ) : <Text style={type.small}>No courier shipment created.</Text>}
      </Card>

      <Card title="Status timeline">
        {sellerTimeline(order.timeline).map((event, index, all) => {
          const repeat = index > 0 && all[index - 1].status === event.status && event.note;
          return (
            <View key={index} style={styles.timelineItem}>
              <Text style={type.label}>{repeat ? event.note : statusText(event.status)}</Text>
              <Text style={type.small}>{fullDate(event.timestamp)}</Text>
              {event.note && !repeat ? <Text style={type.small}>{event.note}</Text> : null}
            </View>
          );
        })}
        {!order.timeline?.length ? <Text style={type.small}>No status updates recorded yet.</Text> : null}
      </Card>

      {(order.deliveredAt || order.status === 'delivered') ? (
        <AppButton title="View invoice" variant="outline" onPress={() => navigation.navigate('InvoiceDetail', { orderId: order._id, orderNo: order.orderNo })} />
      ) : null}
      {actions.some((a) => a.to === 'ready_for_pickup') ? (
        <InlineNotice tone="info">Mark this parcel Ready for pickup to see both delivery methods and their eligibility.</InlineNotice>
      ) : null}

      <ReasonPrompt
        visible={!!prompt}
        busy={busy}
        title={prompt?.kind === 'dispatch' ? 'Hand to courier' : 'Provide a reason'}
        message={prompt?.kind === 'dispatch' ? 'Enter the courier name and tracking number. The customer sees these on their tracking screen.' : undefined}
        fields={prompt?.kind === 'dispatch'
          ? [{ key: 'courier', label: 'Courier name' }, { key: 'awb', label: 'Tracking (AWB) number' }]
          : [{ key: 'reason', label: prompt?.action?.label === 'Reject' ? 'Reason for rejection' : 'Reason for cancellation', multiline: true }]}
        confirmLabel={prompt?.kind === 'dispatch' ? 'Mark dispatched' : prompt?.action?.label || 'Submit'}
        onCancel={() => setPrompt(null)}
        onSubmit={submitPrompt}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: '#f1f5f9', gap: 2 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  timelineItem: { paddingVertical: 6, borderLeftWidth: 2, borderLeftColor: '#cde9ed', paddingLeft: spacing.md },
});
