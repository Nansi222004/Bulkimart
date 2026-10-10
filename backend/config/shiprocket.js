import axios from 'axios';

let shiprocketToken = null;
let tokenExpiry = null;

/**
 * Get cached/fresh authorization token from Shiprocket API
 */
export const getShiprocketToken = async () => {
  if (process.env.SHIPROCKET_MODE === 'mock') {
    return 'mock_shiprocket_jwt_token_12345';
  }

  // If token exists and is not expired (expiry is usually 10 days)
  if (shiprocketToken && tokenExpiry && Date.now() < tokenExpiry) {
    return shiprocketToken;
  }

  try {
    const response = await axios.post(`${process.env.SHIPROCKET_BASE_URL}/api/v1/external/auth/login`, {
      email: process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD
    });

    if (response.data && response.data.token) {
      shiprocketToken = response.data.token;
      // Set expiry to 9 days to be safe (864000 * 9 seconds)
      tokenExpiry = Date.now() + (9 * 24 * 60 * 60 * 1000);
      return shiprocketToken;
    }
    throw new Error('Token not found in response');
  } catch (error) {
    console.error('Shiprocket Authentication Failed:', error.message);
    throw new Error('Shiprocket Auth Failed');
  }
};
