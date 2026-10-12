import PrivacyPolicy from "../models/PrivacyPolicy.js";

export const DEFAULT_PRIVACY_POLICIES = [
  {
    role: "user",
    roleTitle: "Customer & User Privacy Policy",
    slug: "user-policy",
    summary:
      "Your privacy and data security are our highest priorities across all shopping, quick-commerce, and delivery interactions on Bulkimart.",
    version: "1.0.0",
    sections: [
      {
        id: "user-sec-1",
        title: "1. Information We Collect",
        content:
          "We collect essential account details (mobile number, profile name, optional email), saved delivery addresses, order history, and secure payment tokens to process your orders efficiently.",
        points: [
          "Basic Profile: Name, Phone Number, Email Address",
          "Delivery Data: Saved addresses, landmarks, geolocated coordinates",
          "Order & Financial: Order history, cart items, tokenized payment references",
        ],
        order: 1,
      },
      {
        id: "user-sec-2",
        title: "2. Location & Live Order Tracking",
        content:
          "Location data is accessed only when granted permission to accurately pin your delivery address, match nearby dark stores/sellers, and enable live order dispatch tracking.",
        points: [
          "Address Pinpoint Accuracy during checkout",
          "Finding nearest active Dark Stores & Fulfillment Centers",
          "Real-time Rider Tracking during active delivery dispatches",
        ],
        order: 2,
      },
      {
        id: "user-sec-3",
        title: "3. Data Protection & Encryption Security",
        content:
          "All network requests are transmitted over encrypted HTTPS/TLS protocols. Sensitive payment credentials or raw credit/debit card numbers are never stored on our servers.",
        points: [
          "End-to-End SSL Encryption for all API traffic",
          "RBI & PCI-DSS Compliant Payment Gateway integration",
          "Strict Database Access Control & audit logs",
        ],
        order: 3,
      },
      {
        id: "user-sec-4",
        title: "4. Partner Information Sharing",
        content:
          "Order information is shared strictly on a need-to-know basis with fulfillment sellers and assigned delivery partners necessary to complete your delivery. We never sell user data to 3rd party brokers.",
        points: [
          "Seller gets item list & anonymized delivery destination",
          "Delivery rider gets delivery address & contact number during active trip",
          "No third-party advertising tracking or data selling",
        ],
        order: 4,
      },
      {
        id: "user-sec-5",
        title: "5. User Rights & Support Contact",
        content:
          "You have full rights to inspect, update, or request deletion of your account details. For any privacy queries or data requests, reach out via Help & Support or support@nhcone.com.",
        points: [
          "Right to update profile details anytime",
          "Right to delete saved delivery addresses",
          "24/7 Support ticket system for data privacy inquiries",
        ],
        order: 5,
      },
    ],
  },
  {
    role: "seller",
    roleTitle: "Vendor & Seller Privacy Policy",
    slug: "seller-policy",
    summary:
      "Policies governing seller registration details, GST/FSSAI records, product catalogs, order fulfillment logs, and financial payout processing.",
    version: "1.0.0",
    sections: [
      {
        id: "seller-sec-1",
        title: "1. Seller Identity & Verification Data",
        content:
          "We collect seller business profiles, owner contact numbers, shop addresses, GSTIN, FSSAI certificates, and bank account details required for identity verification and legally compliant payout transfers.",
        points: [
          "Business Registration & PAN/GST details",
          "FSSAI license numbers for food & grocery sellers",
          "Verified Bank Account details for automated payouts",
        ],
        order: 1,
      },
      {
        id: "seller-sec-2",
        title: "2. Product Catalog & Pricing Transparency",
        content:
          "Product images, prices, stock levels, and store opening hours published by sellers are displayed on the platform to facilitate customer ordering and dynamic inventory management.",
        points: [
          "Stock levels updated in real-time",
          "Store operating hours & surge capacity status",
          "Product approval audit logs for compliance",
        ],
        order: 2,
      },
      {
        id: "seller-sec-3",
        title: "3. Order Fulfillment & Payout Audit Trails",
        content:
          "All order acceptances, preparation times, platform commission deductions, and daily/weekly payout summaries are recorded to provide full accounting transparency to vendors.",
        points: [
          "Immutable transaction history for seller payouts",
          "Commission & platform fee breakdown for every order",
          "Return & refund adjustment tracking",
        ],
        order: 3,
      },
      {
        id: "seller-sec-4",
        title: "4. Data Confidentiality & Protection",
        content:
          "Seller financial records and customer order details shared with vendors must be handled in strict confidentiality. Misuse of customer personal contact details for off-platform sales is prohibited.",
        points: [
          "Customer phone numbers masked where feasible",
          "Strict prohibition against off-platform contact",
          "Encrypted storage of seller banking details",
        ],
        order: 4,
      },
    ],
  },
  {
    role: "delivery",
    roleTitle: "Delivery Partner & Rider Privacy Policy",
    slug: "delivery-policy",
    summary:
      "Guidelines regarding background location tracking, rider identity verification, trip dispatches, earnings calculation, and rider safety.",
    version: "1.0.0",
    sections: [
      {
        id: "delivery-sec-1",
        title: "1. Continuous Background Location Tracking",
        content:
          "To assign nearby delivery orders, calculate optimal navigation routes, and provide customers with live order dispatch tracking, the delivery partner app accesses location data even when running in the background while duty mode is ON.",
        points: [
          "Location collected ONLY when Duty Status is set to ACTIVE/ON",
          "Used for automated order dispatching & optimal route calculation",
          "Location tracking pauses automatically when duty is OFF",
        ],
        order: 1,
      },
      {
        id: "delivery-sec-2",
        title: "2. Rider Verification & KYC Records",
        content:
          "We collect Driving License details, Vehicle Registration documents, Aadhaar/ID proof, and selfie photos to verify rider identity and maintain platform safety standards.",
        points: [
          "Driving License & Vehicle Registration Verification",
          "Identity proof for background verification",
          "Profile photo for customer delivery identification",
        ],
        order: 2,
      },
      {
        id: "delivery-sec-3",
        title: "3. Rider Earnings, Tips & Payout Logs",
        content:
          "Trip distances, order delivery completions, customer tips, and payout disbursements are tracked accurately to ensure transparent daily/weekly rider payouts.",
        points: [
          "100% Customer Tips passed directly to delivery partner",
          "Transparent distance-based base pay + surge incentives",
          "Direct Bank/UPI Payout transfer logs",
        ],
        order: 3,
      },
      {
        id: "delivery-sec-4",
        title: "4. Rider Safety & Emergency Contacts",
        content:
          "Emergency contact details and SOS alerts raised in the delivery app are processed instantly by our dispatch and support safety desk.",
        points: [
          "SOS emergency button location sharing",
          "24/7 Rider support desk access",
          "Accident insurance claim assistance data",
        ],
        order: 4,
      },
    ],
  }

];

export const seedPrivacyPolicies = async () => {
  try {
    for (const policyData of DEFAULT_PRIVACY_POLICIES) {
      const existing = await PrivacyPolicy.findOne({ role: policyData.role });
      if (!existing) {
        await PrivacyPolicy.create(policyData);
        console.log(`[SEED] Created default privacy policy for role: ${policyData.role} (${policyData.slug})`);
      }
    }
  } catch (error) {
    console.warn(`[SEED] Error seeding privacy policies:`, error.message);
  }
};
