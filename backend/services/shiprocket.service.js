import { getShiprocketToken } from '../config/shiprocket.js';
import axios from 'axios';
import { isMockIntegrationEnabled } from '../config/runtime.js';
import { shiprocketEnvironment } from '../config/shiprocketEnvironment.js';

const baseUrl = () => shiprocketEnvironment().baseUrl;

export const getShiprocketCapabilities = (env = process.env) => {
  let mode = 'unavailable', configured = false;
  try { mode = shiprocketEnvironment(env).mode; configured = true; } catch { /* No secrets in diagnostics. */ }
  return {
    configured,
    mode: configured ? mode : 'unavailable',
    createOrder: configured,
    serviceability: configured,
    awbAssignment: configured,
    tracking: configured,
    pickupScheduling: configured,
    labelGeneration: configured,
    quickCommerce: env.SHIPROCKET_QUICK_COMMERCE_ENABLED === 'true',
  };
};

const authenticated = async () => ({
  headers: { Authorization: `Bearer ${await getShiprocketToken()}` },
  timeout: 15000,
  maxRedirects: 0,
});

const mockPickups = new Map(); // Explicit mock integration only; never live state.
export const listPickupLocations = async () => {
  if (isMockIntegrationEnabled('SHIPROCKET_MODE')) return [...mockPickups.values()];
  const response = await axios.get(`${baseUrl()}/v1/external/settings/company/pickup`, await authenticated());
  const rows = response.data?.data?.shipping_address;
  if (!Array.isArray(rows)) throw new Error('Pickup listing unavailable');
  return rows;
};
export const addPickupLocation = async payload => {
  if (isMockIntegrationEnabled('SHIPROCKET_MODE')) {
    if (!mockPickups.has(payload.pickup_location)) mockPickups.set(payload.pickup_location, { ...payload, id: `mock-${payload.pickup_location}`, status: 2, phone_verified: 1 });
    return { success: true };
  }
  await axios.post(`${baseUrl()}/v1/external/settings/company/addpickup`, payload, await authenticated());
  // Creation acknowledgement is not proof of usability. Caller re-reads listing.
  return { success: true };
};

export const verifyPickupLocation = async (location, store, expected) => {
  if (!location) return null;
  if (isMockIntegrationEnabled('SHIPROCKET_MODE')) return { pickup_location: location, address: store.address, city: store.city, state: store.state, pin_code: store.pincode, verificationMode: 'mock' };
  const response = await axios.get(`${baseUrl()}/v1/external/settings/company/pickup`, await authenticated());
  const rows = response.data?.data?.shipping_address;
  if (!Array.isArray(rows)) throw new Error('Pickup verification unavailable');
  const found = rows.find(row => row.pickup_location === location && String(row.pin_code) === String(store.pincode));
  if (!found || found.is_verified === 0 || found.is_verified === false || found.is_active === 0 || found.is_active === false) return null;
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if ((found.status !== undefined && Number(found.status) !== 2) || (found.phone_verified !== undefined && Number(found.phone_verified) !== 1)) return null;
  if (store.address && normalize(found.address) !== normalize(store.address)) return null;
  if (expected) {
    const payload = expected.payload;
    if (String(found.id) !== String(expected.providerId) || Number(found.status) !== 2 || Number(found.phone_verified) !== 1) return null;
    if (['name','email','address','city','state','country','pin_code'].some(key => normalize(found[key]) !== normalize(payload[key]))) return null;
    const normalizedPhone = String(found.phone || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    if (normalizedPhone !== payload.phone) return null;
  }
  return { pickup_location: found.pickup_location, address: found.address, address_2: found.address_2, city: found.city, state: found.state, pin_code: found.pin_code, verificationMode: 'provider' };
};

export const checkServiceability = async ({ pickupPostcode, deliveryPostcode, weight, cod }) => {
  if (isMockIntegrationEnabled('SHIPROCKET_MODE')) {
    return { available: true, couriers: [{ courier_company_id: 1, courier_name: 'Mock courier', rate: 50, freight_charge: 50 }] };
  }
  const response = await axios.get(`${baseUrl()}/v1/external/courier/serviceability/`, {
    ...(await authenticated()),
    params: {
      pickup_postcode: pickupPostcode,
      delivery_postcode: deliveryPostcode,
      weight: Math.max(0.01, Number(weight || 0.5)),
      cod: cod ? 1 : 0,
    },
  });
  const couriers = response.data?.data?.available_courier_companies || [];
  return { available: couriers.length > 0, couriers };
};

export const createShiprocketOrder = async (orderData) => {
  if (isMockIntegrationEnabled('SHIPROCKET_MODE')) {
    const reference = String(orderData?.order_id || 'UNKNOWN').replace(/[^A-Za-z0-9-]/g, '');
    return {
      success: true,
      order_id: `SR-MOCK-${reference}`,
      shiprocket_order_id: `SR-MOCK-${reference}`,
      shipment_id: `SHIP-MOCK-${reference}`,
      status: 'NEW',
      message: 'Mock Shiprocket order created successfully'
    };
  }

  try {
    const token = await getShiprocketToken();
    const response = await axios.post(
      `${baseUrl()}/v1/external/orders/create/adhoc`,
      orderData,
      {
        headers: { Authorization: `Bearer ${token}` }, timeout: 15000, maxRedirects: 0,
      }
    );
    return response.data;
  } catch (error) {
    console.error('Shiprocket Create Order Failed:', error.response?.status || 'provider_unavailable');
    throw new Error('Failed to create order on Shiprocket');
  }
};

export const assignCourier = async (shipmentId, courierId) => {
  if (isMockIntegrationEnabled('SHIPROCKET_MODE')) {
    return {
      success: true,
      awb: `AWB-MOCK-${Date.now()}`,
      courier_name: 'Delhivery',
      label_url: 'https://example.com/mock-shiprocket-label.pdf',
      tracking_url: 'https://example.com/track/mock'
    };
  }

  try {
    const response = await axios.post(
      `${baseUrl()}/v1/external/courier/assign/awb`,
      { shipment_id: shipmentId, ...(courierId ? { courier_id: courierId } : {}) },
      await authenticated(),
    );
    const data = response.data?.response?.data || response.data;
    if (!data?.awb_code) throw new Error('Shiprocket did not return an AWB');
    return {
      success: true,
      awb: String(data.awb_code),
      courier_name: data.courier_name,
      tracking_url: data.tracking_url,
    };
  } catch (error) {
    console.error('Shiprocket AWB assignment failed:', error.response?.status || 'provider_unavailable');
    throw new Error('Failed to assign a courier on Shiprocket');
  }
};

export const generateLabel = async (shipmentId) => {
  if (isMockIntegrationEnabled('SHIPROCKET_MODE')) return { label_url: 'https://example.invalid/mock-label.pdf' };
  const response = await axios.post(`${baseUrl()}/v1/external/courier/generate/label`, { shipment_id: [shipmentId] }, await authenticated());
  return { label_url: typeof response.data?.label_url === 'string' ? response.data.label_url : undefined };
};

export const schedulePickup = async (shipmentId) => {
  if (isMockIntegrationEnabled('SHIPROCKET_MODE')) return { pickup_status: 1 };
  const response = await axios.post(`${baseUrl()}/v1/external/courier/generate/pickup`, { shipment_id: [shipmentId] }, await authenticated());
  return response.data;
};

export const trackShipment = async (awb) => {
  if (isMockIntegrationEnabled('SHIPROCKET_MODE')) {
    return {
      success: true,
      current_status: 'In Transit',
      tracking_data: [
        { activity: 'Order Received', location: 'Warehouse', time: new Date() },
        { activity: 'In Transit', location: 'Hub', time: new Date() }
      ]
    };
  }

  try {
    const token = await getShiprocketToken();
    const response = await axios.get(
      `${baseUrl()}/v1/external/courier/track/awb/${awb}`,
      {
        headers: { Authorization: `Bearer ${token}` }, timeout: 15000, maxRedirects: 0,
      }
    );
    return response.data;
  } catch (error) {
    console.error('Shiprocket Track AWB Failed:', error.response?.status || 'provider_unavailable');
    throw new Error('Failed to track shipment on Shiprocket');
  }
};
