import { ROLE } from '../../constants/enums.js';
import { ID, img } from '../ids.js';

/**
 * Buyers 1–5, then the accounts that back each vendor profile.
 * All phones are 90000000NN so they are trivially memorable during testing.
 * With OTP_MODE=mock the OTP is always "1234".
 */
export const users = [
  // ---------------------------------------------------------------- buyers
  {
    _id: ID.user(1),
    phone: '9000000001',
    name: 'Rahul Sharma',
    email: 'rahul.sharma@example.com',
    avatar: img('RS', 128, 128),
    roles: [ROLE.BUYER],
    addresses: [{
      label: 'Home', name: 'Rahul Sharma', phone: '9000000001',
      line1: 'Flat 402, Shivaji Residency', line2: 'Kothrud',
      city: 'Pune', state: 'Maharashtra', pincode: '411038',
      lat: 18.5074, lng: 73.8077, isDefault: true,
    }],
    wallet: { balance: 1500, transactions: [] },
    isActive: true,
  },
  {
    // Second test buyer account.
    _id: ID.user(2),
    phone: '9000000002',
    name: 'प्रिया देशमुख',
    email: 'priya.deshmukh@example.com',
    roles: [ROLE.BUYER],
    addresses: [{
      label: 'Home', name: 'प्रिया देशमुख', phone: '9000000002',
      line1: '12, Gandhi Nagar', line2: 'Near Zilla Parishad',
      city: 'Nagpur', state: 'Maharashtra', pincode: '440010',
      lat: 21.1458, lng: 79.0882, isDefault: true,
    }],
    wallet: { balance: 3200, transactions: [] },
    isActive: true,
  },
  {
    _id: ID.user(3),
    phone: '9000000003',
    name: 'Anjali Verma',
    roles: [ROLE.BUYER],
    addresses: [{
      label: 'Work', name: 'Anjali Verma', phone: '9000000003',
      line1: 'Tower B, Cyber Park', city: 'Indore', state: 'Madhya Pradesh',
      pincode: '452010', lat: 22.7196, lng: 75.8577, isDefault: true,
    }],
    wallet: { balance: 0, transactions: [] },
    isActive: true,
  },
  {
    _id: ID.user(4),
    phone: '9000000004',
    name: 'Suresh Patil',
    roles: [ROLE.BUYER],
    addresses: [],
    wallet: { balance: 250, transactions: [] },
    isActive: true,
  },
  {
    // deactivated — proves the 403 path in protect()
    _id: ID.user(5),
    phone: '9000000005',
    name: 'Blocked Test User',
    roles: [ROLE.BUYER],
    wallet: { balance: 0, transactions: [] },
    isActive: false,
  },

  // ------------------------------------------------- seller-backing accounts
  // roles are assigned by the seeder based on each vendor's approval status
  { _id: ID.user(11), phone: '9000000011', name: 'Vikram Joshi', roles: [ROLE.BUYER], isActive: true },
  { _id: ID.user(12), phone: '9000000012', name: 'Meena Traders Owner', roles: [ROLE.BUYER], isActive: true },
  { _id: ID.user(13), phone: '9000000013', name: 'Arjun Nair', roles: [ROLE.BUYER], isActive: true },
  { _id: ID.user(14), phone: '9000000014', name: 'Kavita Singh', roles: [ROLE.BUYER], isActive: true },
  { _id: ID.user(15), phone: '9000000015', name: 'Ramesh Gupta', roles: [ROLE.BUYER], isActive: true },
  { _id: ID.user(16), phone: '9000000016', name: 'Sunita Rao', roles: [ROLE.BUYER], isActive: true },

  // ---------------------------------------------------- SHG-backing accounts
  { _id: ID.user(21), phone: '9000000021', name: 'Lakshmi Bai', roles: [ROLE.BUYER], isActive: true },
  { _id: ID.user(22), phone: '9000000022', name: 'Sarita Devi', roles: [ROLE.BUYER], isActive: true },
  { _id: ID.user(23), phone: '9000000023', name: 'Geeta Kumari', roles: [ROLE.BUYER], isActive: true },

  // ----------------------------------------- delivery-partner accounts (Day 2)
  { _id: ID.user(31), phone: '9000000031', name: 'Imran Shaikh', roles: [ROLE.BUYER], isActive: true },
  { _id: ID.user(32), phone: '9000000032', name: 'Deepak Yadav', roles: [ROLE.BUYER], isActive: true },
  { _id: ID.user(33), phone: '9000000033', name: 'Sanjay Kale', roles: [ROLE.BUYER], isActive: true },
];
