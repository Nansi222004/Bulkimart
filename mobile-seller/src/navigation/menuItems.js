// Sidebar menu (opened from the ☰ button in the header). Every route here is a built screen.
export const MENU_SECTIONS = [
  {
    title: 'Selling',
    items: [
      { title: 'Stock', route: 'Stock', icon: 'layers', hint: 'Stock levels and adjustments' },
      { title: 'Track orders', route: 'TrackOrders', icon: 'truck', hint: 'Partners, couriers and status trails' },
      { title: 'Returns', route: 'Returns', icon: 'returns', hint: 'Review returns and arrange pickups' },
      { title: 'Product questions', route: 'ProductFaqs', icon: 'help', hint: 'Answer customer questions' },
      { title: 'Advertising', route: 'Advertising', icon: 'megaphone', hint: 'Sponsored-category campaigns' },
    ],
  },
  {
    title: 'Money & reports',
    items: [
      { title: 'Sales report', route: 'SalesReport', icon: 'chart', hint: 'Sales figures by storefront' },
      { title: 'Invoices', route: 'Invoices', icon: 'file', hint: 'Tax invoices for delivered orders' },
      { title: 'Payout history', route: 'PayoutHistory', icon: 'rupee', hint: 'Requests and bank transfers' },
      { title: 'Tax statement', route: 'TaxStatement', icon: 'percent', hint: 'TCS and TDS withheld' },
    ],
  },
  {
    title: 'Store',
    items: [
      { title: 'Business settings', route: 'BusinessSettings', icon: 'settings', hint: 'Channels, same-day, Wholesale, branding' },
      { title: 'Store location', route: 'StoreLocation', icon: 'mapPin', hint: 'Pin your store with GPS' },
      { title: 'Pickup registration', route: 'PickupSync', icon: 'truck', hint: 'Shiprocket pickup location' },
      { title: 'KYC & payout details', route: 'KycDetails', icon: 'shield', hint: 'Bank, GST, PAN and documents' },
      { title: 'Notifications', route: 'Notifications', icon: 'bell', hint: 'Order, return and payout updates' },
      { title: 'Support', route: 'Support', icon: 'headset', hint: 'Help line and support tickets' },
      { title: 'Privacy policy', route: 'PrivacyPolicy', icon: 'file', hint: 'How Bulkimart uses seller data' },
    ],
  },
];

export const WEB_ONLY_NOTE = 'E-books, new Wholesale-only listings, bulk upload, advertising payments, GST assistance and services are on the Bulkimart seller website for now.';
