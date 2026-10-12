// Google Maps API Service. Mock results require an authorized mock runtime.
import { isMockIntegrationEnabled } from '../config/runtime.js';

export const geocodeAddress = async (address) => {
  if (isMockIntegrationEnabled('MAPS_MODE')) {
    // Return hardcoded standard lat/lng
    return { lat: 20.5937, lng: 78.9629, formattedAddress: address };
  }
  
  throw new Error('Real Google Maps geocoding is not implemented');
};

export const getRoute = async (origin, destination) => {
  if (isMockIntegrationEnabled('MAPS_MODE')) {
    return {
      distanceKm: 5.2,
      durationMin: 18,
      polyline: 'mock_polyline_encoded_string_data'
    };
  }

  throw new Error('Real Google Maps directions are not implemented');
};

export const getDistanceMatrix = async (origins, destinations) => {
  if (isMockIntegrationEnabled('MAPS_MODE')) {
    return [{ distanceKm: 5.2, durationMin: 18 }];
  }

  throw new Error('Real Google Maps distance matrix is not implemented');
};
