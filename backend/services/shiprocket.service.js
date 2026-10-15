import { getShiprocketToken } from '../config/shiprocket.js';
import axios from 'axios';
import { isMockIntegrationEnabled } from '../config/runtime.js';

const baseUrl = () => (process.env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in').replace(/\/$/, '');

export const getShiprocketCapabilities = (env = process.env) => {
  const mode = env.SHIPROCKET_MODE;
  const configured = mode === 'mock' || Boolean(env.SHIPROCKET_EMAIL && env.SHIPROCKET_PASSWORD && env.SHIPROCKET_WEBHOOK_SECRET);
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
});

export const checkServiceability = async ({ pickupPostcode, deliveryPostcode, weight, cod }) => {
  if (isMockIntegrationEnabled('SHIPROCKET_MODE')) {
    return { available: true, couriers: [{ courier_company_id: 1, courier_name: 'Mock courier', rate: 50, freight_charge: 50 }] };
  }
  const response = await axios.get(`${baseUrl()}/api/v1/external/courier/serviceability/`, {
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
      `${baseUrl()}/api/v1/external/orders/create/adhoc`,
      orderData,
      {
        headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
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
      `${baseUrl()}/api/v1/external/courier/assign/awb`,
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
    console.error('Shiprocket AWB assignment failed:', error.response?.status || error.message);
    throw new Error('Failed to assign a courier on Shiprocket');
  }
};

export const generateLabel = async (shipmentId) => {
  if (isMockIntegrationEnabled('SHIPROCKET_MODE')) return { label_url: 'https://example.invalid/mock-label.pdf' };
  const response = await axios.post(`${baseUrl()}/api/v1/external/courier/generate/label`, { shipment_id: [shipmentId] }, await authenticated());
  return { label_url: typeof response.data?.label_url === 'string' ? response.data.label_url : undefined };
};

export const schedulePickup = async (shipmentId) => {
  if (isMockIntegrationEnabled('SHIPROCKET_MODE')) return { pickup_status: 1 };
  const response = await axios.post(`${baseUrl()}/api/v1/external/courier/generate/pickup`, { shipment_id: [shipmentId] }, await authenticated());
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
      `${baseUrl()}/api/v1/external/courier/track/awb/${awb}`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Shiprocket Track AWB Failed:', error.response?.data || error.message);
    throw new Error('Failed to track shipment on Shiprocket');
  }
};
