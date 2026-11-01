// Sidebar menu (opened from the ☰ button in the header). Every route here is a built screen.
export const MENU_SECTIONS = [
  {
    title: 'Selling',
    items: [
      { title: 'Stock', route: 'Stock', glyph: '▤', hint: 'Stock levels and adjustments' },
      { title: 'Track orders', route: 'TrackOrders', glyph: '⇄', hint: 'Partners, couriers and status trails' },
      { title: 'Returns', route: 'Returns', glyph: '↺', hint: 'Review returns and arrange pickups' },
      { title: 'Product questions', route: 'ProductFaqs', glyph: '?', hint: 'Answer customer questions' },
      { title: 'Advertising', route: 'Advertising', glyph: '✦', hint: 'Sponsored-category campaigns' },
    ],
  },
  {
    title: 'Money & reports',
    items: [
      { title: 'Sales report', route: 'SalesReport', glyph: '↗', hint: 'Sales figures by storefront' },
      { title: 'Invoices', route: 'Invoices', glyph: '▦', hint: 'Tax invoices for delivered orders' },
      { title: 'Payout history', route: 'PayoutHistory', glyph: '₹', hint: 'Requests and bank transfers' },
      { title: 'Tax statement', route: 'TaxStatement', glyph: '%', hint: 'TCS and TDS withheld' },
    ],
  },
  {
    title: 'Store',
    items: [
      { title: 'Business settings', route: 'BusinessSettings', glyph: '⚙', hint: 'Channels, same-day, Wholesale, branding' },
      { title: 'Store location', route: 'StoreLocation', glyph: '⌖', hint: 'Pin your store with GPS' },
      { title: 'Pickup registration', route: 'PickupSync', glyph: '⛟', hint: 'Shiprocket pickup location' },
      { title: 'KYC & payout details', route: 'KycDetails', glyph: '🛡', hint: 'Bank, GST, PAN and documents' },
      { title: 'Notifications', route: 'Notifications', glyph: '🔔', hint: 'Order, return and payout updates' },
      { title: 'Support', route: 'Support', glyph: '☎', hint: 'Help line and support tickets' },
    ],
  },
];

export const WEB_ONLY_NOTE = 'E-books, new Wholesale-only listings, bulk upload, advertising payments, GST assistance and services are on the Bulkimart seller website for now.';
