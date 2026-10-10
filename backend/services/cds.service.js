// CDS membership verification — stub that connects to a 3rd party membership system in future
// Currently, any membership number starting with "CDS" is verified successfully.

export const verifyCDSMembership = async (membershipNo) => {
  if (process.env.CDS_MODE === 'mock') {
    const isValid = membershipNo?.toUpperCase().startsWith('CDS');
    const discount = isValid ? parseInt(process.env.CDS_DISCOUNT_PERCENT || '5') : 0;
    return {
      isValid,
      discount,
      message: isValid ? 'CDS membership verified successfully' : 'Invalid membership number'
    };
  }

  // Placeholder for real 3rd party API integration:
  // try {
  //   const response = await axios.post(process.env.CDS_API_URL, { membershipNo });
  //   return { isValid: response.data.valid, discount: response.data.discountPercent };
  // } catch (e) {
  //   return { isValid: false, discount: 0, message: 'Verification API error' };
  // }
  
  return { isValid: false, discount: 0, message: 'CDS verification mode not configured' };
};
