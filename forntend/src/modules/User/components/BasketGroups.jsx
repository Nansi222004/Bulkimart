import React from 'react';
import { CartSection, CartTotalRow } from './CartUI';
import './BasketGroups.css';

export const channelLabel = group => group.salesChannel === 'wholesale' ? 'Wholesale (B2B)' : group.channel === 'grocery' ? 'Quick Commerce' : 'E-Commerce';
export const basketMoney = value => value == null ? 'Unavailable' : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function BasketItem({ item, group, busy, onQuantity, onRemove, onMessage, onWishlist }) {
  const wholesale = group.salesChannel === 'wholesale';
  const minimum = wholesale ? item.wholesaleSnapshot?.minimumQuantity : 1;
  const increment = wholesale ? item.wholesaleSnapshot?.quantityIncrement : 1;
  const maximum = Math.min(item.stock ?? 0, wholesale ? 100000 : 20);
  const editable = onQuantity && item.available !== false && minimum && increment && item.fulfillmentType !== 'digital';
  return <article className="basket-item" data-channel={wholesale ? 'wholesale' : group.channel}>
    {item.image && <img src={typeof item.image === 'string' ? item.image : item.image.url} alt="" />}
    <div className="basket-item-info">
      <h3>{item.name}</h3>
      <p>{item.variantName}{item.variantAttributes?.map(attr => ` · ${attr.name}: ${attr.value}`).join('')}</p>
      <p>{group.seller?.name || 'Vendor unavailable'} · {channelLabel(group)}</p>
      <p>{basketMoney(item.price)} per {item.unitSnapshot || 'unit'} · {item.qty} units</p>
      {item.fulfillmentType === 'digital' ? <p>Digital delivery · one licence</p> : <p>{item.available === false ? 'Unavailable — review or remove this item' : `Stock: ${item.stock}`}</p>}
      {item.priceChanged && <p role="status">Price changed. Review the current price before checkout.</p>}
      {wholesale && item.wholesaleSnapshot && <p>MOQ {minimum} · increments of {increment} · tier from {item.wholesaleSnapshot.tierMinimumQuantity}</p>}
      {editable && <div className="basket-quantity">
        <button type="button" aria-label={`Decrease ${item.name}`} disabled={busy || item.qty - increment < minimum} onClick={() => onQuantity(item, group, item.qty - increment)}>−</button>
        <label><span className="visually-hidden">Quantity for {item.name}</span><input aria-label={`Quantity for ${item.name}`} type="number" inputMode="numeric" min={minimum} max={maximum} step={increment} key={item.qty} defaultValue={item.qty} disabled={busy} onInput={event => event.target.setCustomValidity('')} onBlur={event => {
          const input = event.target;
          const quantity = Number(input.value);
          const valid = Number.isSafeInteger(quantity) && quantity >= minimum && quantity <= maximum && (quantity - minimum) % increment === 0;
          input.value = item.qty;
          if (valid && quantity !== item.qty) onQuantity(item, group, quantity);
          else if (!valid) { input.setCustomValidity?.(`Choose ${minimum} to ${maximum} units in increments of ${increment}.`); input.reportValidity?.(); }
        }} /></label>
        <button type="button" aria-label={`Increase ${item.name}`} disabled={busy || item.qty + increment > maximum} onClick={() => onQuantity(item, group, item.qty + increment)}>+</button>
      </div>}
      {onMessage && !wholesale && <details><summary>Seller instructions</summary><textarea aria-label={`Instructions for ${item.name}`} defaultValue={item.additionalMessage || ''} maxLength={500} disabled={busy} onBlur={event => { if (event.target.value !== (item.additionalMessage || '')) onMessage(item, event.target.value); }} /></details>}
      {onWishlist && !wholesale && <button type="button" className="basket-link" disabled={busy} onClick={() => onWishlist(item, group)}>Move to Wishlist</button>}
    </div>
    <div className="basket-item-actions"><strong>{basketMoney(item.lineTotal)}</strong>{onRemove && <button type="button" className="cart-secondary-btn" aria-label={`Remove ${item.name}`} disabled={busy} onClick={() => onRemove(item, group)}>Remove</button>}</div>
  </article>;
}

export function BasketGroups({ groups, busy, onMode, ...actions }) {
  return <div className="basket-groups">{groups.map(group => <CartSection key={group.key} title={`${channelLabel(group)} · ${group.seller?.name || 'Vendor unavailable'}`}>
    <p className="basket-note">{group.fulfillmentType === 'digital' ? 'Digital delivery' : group.channel === 'grocery' ? 'Quick Commerce delivery' : group.deliveryMode === 'same_day' ? 'Same-Day delivery' : 'Regular delivery'}{group.salesChannel === 'wholesale' ? ' · Wholesale prices' : ''}</p>
    {group.items.map(item => <BasketItem key={item.itemId} item={item} group={group} busy={busy} {...actions} />)}
    {onMode && group.salesChannel !== 'wholesale' && group.fulfillmentType !== 'digital' && group.channel === 'ecommerce' && group.sameDayOption?.available && <div className="basket-delivery" role="group" aria-label={`Delivery for ${group.seller?.name}`}>
      {['scheduled', 'same_day'].map(mode => <button key={mode} type="button" className="cart-secondary-btn" aria-pressed={group.deliveryMode === mode} disabled={busy} onClick={() => onMode(group, mode)}>{mode === 'same_day' ? 'Same-Day' : 'Scheduled'}</button>)}
    </div>}
    {group.total != null && <div className="basket-group-totals"><CartTotalRow label="Items" value={basketMoney(group.subtotal)} /><CartTotalRow label="Delivery" value={basketMoney(group.deliveryCharge)} /><CartTotalRow label="Group total" value={basketMoney(group.total)} strong /></div>}
  </CartSection>)}</div>;
}

export function BasketSummary({ data }) {
  const deliveryCharge = data?.totals?.deliveryCharge ?? 0;
  return <CartSection title="Basket total">{data?.totals ? <>
    <CartTotalRow label="Items" value={basketMoney(data.totals.subtotal)} />
    <CartTotalRow label="Delivery Charges" value={deliveryCharge === 0 ? <span style={{ color: '#16a34a', fontWeight: 700 }}>FREE</span> : basketMoney(deliveryCharge)} />
    <CartTotalRow label="Total" value={basketMoney(data.totals.totalAmount)} strong />
  </> : <p className="basket-note">Please resolve unavailable items before checkout.</p>}</CartSection>;
}
