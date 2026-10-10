import { VENDOR_STATUS } from '../../constants/enums.js';
import { ID, img } from '../ids.js';

/**
 * ONE SELLER PER STATUS — this is the point of the file.
 * The Admin panel's whole job is handling the non-happy states; without seeded
 * rejected/suspended/incomplete records the frontend team has nothing to build against.
 */

const store = (name, city, pincode, lat, lng) => ({
  name,
  logo: img(name, 200, 200),
  banner: img(`${name} Store`, 1200, 300),
  description: `${name} — trusted local supplier.`,
  address: `Shop No. 14, Main Market, ${city}`,
  city,
  state: 'Maharashtra',
  pincode,
  lat,
  lng,
  phone: '9000000011',
});

const bank = (holderName) => ({
  accountNo: '00112233445566',
  ifsc: 'SBIN0001234',
  holderName,
  bankName: 'State Bank of India',
  upiId: `${holderName.split(' ')[0].toLowerCase()}@upi`,
  passbookUrl: img('Passbook'),
});

const aadhaar = (last4) => ({
  number: `XXXX-XXXX-${last4}`,
  frontUrl: img('Aadhaar Front'),
  backUrl: img('Aadhaar Back'),
});

export const sellers = [
  // ------------------------------------------------------------- APPROVED #1
  {
    _id: ID.seller(1),
    userId: ID.user(11),
    onboardingStep: 5,
    businessName: 'Joshi General Store',
    businessType: 'proprietorship',
    storeDetails: store('Joshi General Store', 'Pune', '411038', 18.5204, 73.8567),
    aadhaar: aadhaar('4521'),
    bankDetails: bank('Vikram Joshi'),
    gstin: '27AABCU9603R1ZX',
    pan: 'AABCU9603R',
    fssai: '11522998000123',
    status: VENDOR_STATUS.APPROVED,
    approvedAt: new Date('2026-02-10'),
    commissionRate: 10,
    rating: 4.4,
  },
  // ------------------------------------------------------------- APPROVED #2
  {
    _id: ID.seller(2),
    userId: ID.user(12),
    onboardingStep: 5,
    businessName: 'Meena Traders',
    businessType: 'partnership',
    storeDetails: store('Meena Traders', 'Nagpur', '440010', 21.1458, 79.0882),
    aadhaar: aadhaar('7788'),
    bankDetails: bank('Meena Traders'),
    gstin: '27AAFCM1234K1Z5',
    pan: 'AAFCM1234K',
    status: VENDOR_STATUS.APPROVED,
    approvedAt: new Date('2026-03-02'),
    commissionRate: 12,
    rating: 4.1,
  },
  // --------------------------------------------------------------- PENDING
  // use this one to demo the admin approval flow
  {
    _id: ID.seller(3),
    userId: ID.user(13),
    onboardingStep: 5,
    businessName: 'Nair Electronics',
    businessType: 'individual',
    storeDetails: store('Nair Electronics', 'Nashik', '422001', 19.9975, 73.7898),
    aadhaar: aadhaar('3390'),
    bankDetails: bank('Arjun Nair'),
    pan: 'BXYPN4567L',
    status: VENDOR_STATUS.PENDING,
    commissionRate: 10,
  },
  // ---------------------------------------------------------- UNDER_REVIEW
  {
    _id: ID.seller(4),
    userId: ID.user(14),
    onboardingStep: 5,
    businessName: 'Kavita Handicrafts',
    businessType: 'individual',
    storeDetails: store('Kavita Handicrafts', 'Aurangabad', '431001', 19.8762, 75.3433),
    aadhaar: aadhaar('9012'),
    bankDetails: bank('Kavita Singh'),
    status: VENDOR_STATUS.UNDER_REVIEW,
    commissionRate: 10,
  },
  // -------------------------------------------------------------- REJECTED
  {
    _id: ID.seller(5),
    userId: ID.user(15),
    onboardingStep: 5,
    businessName: 'Gupta Enterprises',
    businessType: 'proprietorship',
    storeDetails: store('Gupta Enterprises', 'Solapur', '413001', 17.6599, 75.9064),
    aadhaar: aadhaar('1177'),
    bankDetails: bank('Ramesh Gupta'),
    status: VENDOR_STATUS.REJECTED,
    rejectionReason: 'Aadhaar document is blurred and the name does not match the bank passbook.',
    commissionRate: 10,
  },
  // ------------------------------------------------------------- SUSPENDED
  {
    _id: ID.seller(6),
    userId: ID.user(16),
    onboardingStep: 5,
    businessName: 'Rao Kitchenware',
    businessType: 'company',
    storeDetails: store('Rao Kitchenware', 'Kolhapur', '416001', 16.7050, 74.2433),
    aadhaar: aadhaar('6644'),
    bankDetails: bank('Sunita Rao'),
    gstin: '27AAGCR7788M1Z2',
    status: VENDOR_STATUS.SUSPENDED,
    rejectionReason: 'Repeated customer complaints about counterfeit products.',
    commissionRate: 10,
    rating: 2.3,
  },
  // ------------------------------------------------------------ INCOMPLETE
  // stopped at step 2 — proves the resumable-onboarding UI
  {
    _id: ID.seller(7),
    userId: ID.user(4),
    onboardingStep: 2,
    businessName: 'Patil Provisions',
    businessType: 'individual',
    storeDetails: store('Patil Provisions', 'Satara', '415001', 17.6805, 73.9933),
    status: VENDOR_STATUS.INCOMPLETE,
    commissionRate: 10,
  },
];
