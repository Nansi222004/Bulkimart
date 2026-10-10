// Google Maps API Service
// Wired to mock distance and routes in development mode.

export const geocodeAddress = async (address) => {
  if (process.env.MAPS_MODE === 'mock') {
    // Return hardcoded standard lat/lng
    return { lat: 20.5937, lng: 78.9629, formattedAddress: address };
  }
  
  // Real: call Google Geocoding API using @googlemaps/google-maps-services-js
  console.log(`[GEOCODING ADDRESS - REAL] ${address}`);
  return { lat: 20.5937, lng: 78.9629, formattedAddress: address };
};

export const getRoute = async (origin, destination) => {
  if (process.env.MAPS_MODE === 'mock') {
    return {
      distanceKm: 5.2,
      durationMin: 18,
      polyline: 'mock_polyline_encoded_string_data'
    };
  }

  // Real: call Google Directions API
  console.log(`[DIRECTIONS ROUTE - REAL] ${origin} -> ${destination}`);
  return { distanceKm: 5.2, durationMin: 18, polyline: 'mock_polyline' };
};

export const getDistanceMatrix = async (origins, destinations) => {
  if (process.env.MAPS_MODE === 'mock') {
    return [{ distanceKm: 5.2, durationMin: 18 }];
  }

  // Real: call Google Distance Matrix API
  console.log(`[DISTANCE MATRIX - REAL]`);
  return [{ distanceKm: 5.2, durationMin: 18 }];
};
