export const adminParcelStatus = value => ({
  payment_pending:'Awaiting payment',payment_failed:'Payment not completed',searching_for_driver:'Finding a delivery partner',needs_admin_assignment:'Needs a delivery partner',
  driver_assigned:'Partner assigned',driver_arriving:'Partner on the way to pickup',arrived_at_pickup:'Partner at pickup',picked_up:'Parcel collected',in_transit:'On the way to the recipient',arrived_at_dropoff:'Partner at delivery address',delivered:'Delivered',cancellation_review:'Cancellation requested',cancelled:'Cancelled',delivery_failed:'Delivery needs help',
}[value]||'Update available');
export const adminPaymentText = booking => booking.paymentStatus==='paid'?'Paid online':booking.paymentMethod==='online'?'Online payment not completed':({cash_due:'Cash to collect',cash_collected:'Cash collected',cash_reconciled:'Cash received by the company'}[booking.paymentStatus]||'Cash payment');
export const adminOfferOutcome = value => ({offered:'Waiting for a reply',accepted:'Accepted',rejected:'Declined',timeout:'No reply in time',withdrawn:'Another partner accepted',cancelled:'Request cancelled'}[value]||'Request closed');
export const adminAssignmentReason = value => ({
  no_eligible_driver:'No available delivery partner matched this pickup. Find partners below to try again.',
  attempts_exhausted:'The pickup requests were not accepted. Choose an available partner to send another request.',
  admin_reassignment:'A different delivery partner is needed for this pickup.',
}[value]||'Choose an available delivery partner for this pickup.');
export const adminShortReference = booking => 'Parcel #'+String(booking.reference||booking._id||'').slice(-6).toUpperCase();
export const adminDate = value => value&&Number.isFinite(new Date(value).getTime())?new Date(value).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'Time not recorded';
export const adminActivityNote = value => ({no_eligible_driver:'No available partner matched this pickup.',attempts_exhausted:'The pickup requests were not accepted.',admin_reassignment:'A different delivery partner was requested.',unreachable_recipient:'The recipient could not be reached.',invalid_address:'The address needs checking.',prohibited_parcel:'The parcel contains an item that is not allowed.',recipient_refusal:'The recipient declined the parcel.',payment_refusal:'The cash payment was not received.',operational_failure:'The delivery partner reported a problem.'}[value] || (value?.includes('_')&&!value.includes(' ')?'':value));
export function adminUnavailableReason(partner) {
  const limit=Math.max(1,Math.round((partner.locationMaxAgeSeconds||300)/60));
  return ({
    location_outdated:`Location needs updating. This booking requires an update within ${limit} minutes. Ask the partner to tap Update location on their duty screen.`,
    missing_location:'No live location is available. Ask the partner to allow location access and tap Update location.',
    location_clock_invalid:'The saved location time is invalid. Ask the partner to update their location again.',
    off_duty:'Not available for a new pickup. The partner may be off duty or already carrying a delivery.',
    reserved_for_another_parcel:'Already assigned to another parcel.',
    return_pickup_in_progress:'A return pickup is being accepted. Try again after it finishes.',
    busy_with_delivery:'Already carrying a delivery or return pickup.',
    outside_pickup_radius:`Outside this booking’s ${partner.assignmentRadiusKm} km pickup search area.`,
    outside_rider_radius:'This pickup is outside the distance the partner is willing to travel.',
    zones_mismatch:'Neither the pickup nor the drop pincode is in the partner’s service area, and the drop is beyond their service radius.',
    account_unavailable:'The rider account is inactive or does not have delivery access.',
    approval_required:'The rider account needs approval before receiving pickup requests.',
    tasks_disabled:'The partner cannot take another task under the current delivery settings.',
  })[partner.reason]||'This partner cannot take this pickup right now.';
}
