// Legacy single-recipient offers remain readable while they expire naturally.
export const parcelOfferRecipients = offer => offer?.partnerIds || (offer?.partnerId ? [String(offer.partnerId)] : []);
export const parcelOfferFilter = partnerId => ({
  status: 'searching_for_driver',
  'assignment.offer.expiresAt': { $gt: new Date() },
  $or: [
    { 'assignment.offer.partnerIds': String(partnerId) },
    { 'assignment.offer.partnerId': String(partnerId) },
  ],
});
