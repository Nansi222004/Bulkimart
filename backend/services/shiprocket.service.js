import { getShiprocketToken } from '../config/shiprocket.js';
import axios from 'axios';
import { isMockIntegrationEnabled } from '../config/runtime.js';

export const createShiprocketOrder = async (orderData) => {
  if (isMockIntegrationEnabled('SHIPROCKET_MODE')) {
    return {
      success: true,
      shiprocket_order_id: `SR-MOCK-${Date.now()}`,
      shipment_id: `SHIP-MOCK-${Math.floor(Math.random() * 1000000)}`,
      status: 'NEW',
      message: 'Mock Shiprocket order created successfully'
    };
  }

  try {
    const token = await getShiprocketToken();
    const response = await axios.post(
      `${process.env.SHIPROCKET_BASE_URL}/api/v1/external/orders/create/adhoc`,
      orderData,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Shiprocket Create Order Failed:', error.response?.data || error.message);
    throw new Error('Failed to create order on Shiprocket');
  }
};

export const assignCourier = async (shiprocketOrderId) => {
  if (isMockIntegrationEnabled('SHIPROCKET_MODE')) {
    return {
      success: true,
      awb: `AWB-MOCK-${Date.now()}`,
      courier_name: 'Delhivery',
      label_url: 'https://example.com/mock-shiprocket-label.pdf',
      tracking_url: 'https://example.com/track/mock'
    };
  }

  // Never report simulated fulfilment as a real Shiprocket assignment.
  throw new Error('Real Shiprocket courier assignment is not implemented');
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
      `${process.env.SHIPROCKET_BASE_URL}/api/v1/external/courier/track/awb/${awb}`,
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
