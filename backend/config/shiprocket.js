import axios from 'axios';
import { isMockIntegrationEnabled } from './runtime.js';
import { shiprocketEnvironment } from './shiprocketEnvironment.js';

let shiprocketToken = null;
let tokenExpiry = null;
let tokenEnvironment = null;

/**
 * Get cached/fresh authorization token from Shiprocket API
 */
export const getShiprocketToken = async () => {
  const environment = shiprocketEnvironment();
  if (isMockIntegrationEnabled('SHIPROCKET_MODE')) {
    return 'mock_shiprocket_jwt_token_12345';
  }

  // If token exists and is not expired (expiry is usually 10 days)
  const identity = JSON.stringify([environment.mode, environment.baseUrl, environment.email, environment.password]);
  if (tokenEnvironment === identity && shiprocketToken && tokenExpiry && Date.now() < tokenExpiry) {
    return shiprocketToken;
  }

  try {
    const response = await axios.post(`${environment.baseUrl}/v1/external/auth/login`, {
      email: environment.email,
      password: environment.password
    }, { timeout: 15000, maxRedirects: 0 });

    if (response.data && response.data.token) {
      shiprocketToken = response.data.token;
      tokenEnvironment = identity;
      // Set expiry to 9 days to be safe (864000 * 9 seconds)
      tokenExpiry = Date.now() + (9 * 24 * 60 * 60 * 1000);
      return shiprocketToken;
    }
    throw new Error('Token not found in response');
  } catch (error) {
    console.error('Shiprocket Authentication Failed:', error.response?.status || 'provider_unavailable');
    throw new Error('Shiprocket Auth Failed');
  }
};
