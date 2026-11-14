// Flat vehicle illustrations for the parcel "Choose a vehicle" screens, drawn from plain shape data so the
// website (SVG) and the customer app (react-native-svg) render the same pictures. Keep the shapes identical
// to mobile-user/src/components/parcels/vehicleArt.js.
//
// Every picture uses a 96 × 64 canvas, faces left, and sits on a soft ground shadow.
// Shape: { t: 'path' | 'rect' | 'circle' | 'ellipse', ...SVG attributes in camelCase }.

export const VEHICLE_ART_VIEWBOX = '0 0 96 64';

const RED = '#D91430', RED_DARK = '#8E0A1B', YELLOW = '#FFC93C', YELLOW_DARK = '#E5A800';
const TYRE = '#1F2937', HUB = '#E5E7EB', GLASS = '#BFE3F5', BOX = '#D59A5B', TAPE = '#F2CF9B', GREEN = '#1F8A4C';

const shadow = { t: 'ellipse', cx: 48, cy: 58, rx: 40, ry: 3.5, fill: '#000000', opacity: 0.08 };
const wheel = (cx, cy, r) => [
  { t: 'circle', cx, cy, r, fill: TYRE },
  { t: 'circle', cx, cy, r: r * 0.45, fill: HUB },
];
// A cardboard delivery box with tape.
const parcelBox = (x, y, w, h) => [
  { t: 'rect', x, y, width: w, height: h, rx: 2, fill: BOX },
  { t: 'rect', x: x + w / 2 - 2, y, width: 4, height: h, fill: TAPE },
  { t: 'rect', x, y: y + 3, width: w, height: 2, fill: '#B97F43', opacity: 0.5 },
];

// Motorbike with a delivery box on the back.
const bike = [
  shadow,
  ...wheel(22, 47, 10),
  ...wheel(72, 47, 10),
  { t: 'path', d: 'M12 45 Q14 34 26 35', stroke: TYRE, strokeWidth: 3, fill: 'none', strokeLinecap: 'round' },
  { t: 'path', d: 'M28 45 L36 30 L58 30 Q66 30 68 38 L70 45 Z', fill: RED },
  { t: 'path', d: 'M36 30 L46 30 L42 40 L32 40 Z', fill: RED_DARK },
  { t: 'rect', x: 44, y: 25, width: 20, height: 5, rx: 2.5, fill: TYRE },
  { t: 'path', d: 'M22 47 L31 22', stroke: TYRE, strokeWidth: 3, strokeLinecap: 'round' },
  { t: 'path', d: 'M27 21 L37 21', stroke: TYRE, strokeWidth: 3, strokeLinecap: 'round' },
  { t: 'circle', cx: 30, cy: 28, r: 3, fill: YELLOW },
  { t: 'path', d: 'M70 46 L74 31', stroke: TYRE, strokeWidth: 3, strokeLinecap: 'round' },
  { t: 'rect', x: 60, y: 28, width: 28, height: 3, rx: 1.5, fill: TYRE },
  ...parcelBox(62, 10, 24, 18),
];

// Step-through scooter with a delivery box.
const scooter = [
  shadow,
  ...wheel(22, 48, 9),
  ...wheel(72, 48, 9),
  { t: 'path', d: 'M14 46 Q16 36 28 38 L44 44 L60 44 L64 34 Q72 30 80 34 Q84 38 82 46 Z', fill: RED },
  { t: 'path', d: 'M28 38 L34 18 L38 18 L33 40 Z', fill: RED_DARK },
  { t: 'rect', x: 60, y: 28, width: 20, height: 5, rx: 2.5, fill: TYRE },
  { t: 'path', d: 'M30 16 L40 16', stroke: TYRE, strokeWidth: 3, strokeLinecap: 'round' },
  { t: 'circle', cx: 31, cy: 24, r: 3, fill: YELLOW },
  { t: 'rect', x: 68, y: 27, width: 22, height: 3, rx: 1.5, fill: TYRE },
  ...parcelBox(69, 10, 20, 17),
];

// Auto rickshaw: sloped nose, curved dark canopy, open passenger side with a seat, one small front wheel.
const auto = [
  shadow,
  { t: 'path', d: 'M24 18 Q26 6 40 6 L80 6 Q88 6 88 14 L88 18 Z', fill: TYRE },
  { t: 'path', d: 'M10 48 L10 38 Q12 26 22 22 L28 18 L88 18 L88 48 Z', fill: YELLOW },
  { t: 'path', d: 'M27 21 L38 21 L38 34 L14 34 Q16 26 27 21 Z', fill: GLASS },
  { t: 'rect', x: 44, y: 21, width: 34, height: 18, rx: 3, fill: '#4B5563' },
  { t: 'rect', x: 58, y: 30, width: 18, height: 6, rx: 2, fill: RED_DARK },
  { t: 'rect', x: 72, y: 24, width: 4, height: 12, rx: 1.5, fill: RED_DARK },
  { t: 'rect', x: 82, y: 22, width: 6, height: 16, fill: YELLOW_DARK },
  { t: 'rect', x: 10, y: 41, width: 78, height: 4, fill: GREEN },
  { t: 'circle', cx: 12, cy: 38, r: 2.5, fill: '#FFFFFF' },
  ...wheel(22, 50, 7),
  ...wheel(72, 49, 8.5),
];

// Hatchback car.
const car = [
  shadow,
  { t: 'path', d: 'M6 46 L6 36 Q6 31 12 30 L24 28 L34 17 Q36 15 40 15 L66 15 Q70 15 73 18 L82 28 L86 29 Q90 30 90 36 L90 46 Z', fill: RED },
  { t: 'path', d: 'M37 19 L50 19 L50 28 L28 28 Z', fill: GLASS },
  { t: 'path', d: 'M54 19 L66 19 Q68 19 70 21 L76 28 L54 28 Z', fill: GLASS },
  { t: 'path', d: 'M52 19 L52 44', stroke: RED_DARK, strokeWidth: 1.5 },
  { t: 'rect', x: 6, y: 33, width: 6, height: 4, rx: 1, fill: YELLOW },
  { t: 'rect', x: 86, y: 32, width: 4, height: 5, rx: 1, fill: RED_DARK },
  { t: 'rect', x: 6, y: 42, width: 84, height: 4, fill: RED_DARK, opacity: 0.6 },
  ...wheel(25, 46, 9),
  ...wheel(71, 46, 9),
];

// Delivery van.
const van = [
  shadow,
  { t: 'path', d: 'M6 46 L6 30 Q6 26 10 25 L20 23 L28 12 Q30 10 34 10 L88 10 Q90 10 90 12 L90 46 Z', fill: '#FFFFFF', stroke: '#D1D5DB', strokeWidth: 1 },
  { t: 'path', d: 'M30 14 L42 14 L42 25 L20 25 Z', fill: GLASS },
  { t: 'rect', x: 46, y: 14, width: 40, height: 22, rx: 2, fill: RED },
  { t: 'rect', x: 46, y: 22, width: 40, height: 4, fill: YELLOW },
  { t: 'path', d: 'M44 14 L44 44', stroke: '#D1D5DB', strokeWidth: 1.5 },
  { t: 'rect', x: 6, y: 32, width: 5, height: 4, rx: 1, fill: YELLOW },
  { t: 'rect', x: 6, y: 42, width: 84, height: 4, fill: '#9CA3AF' },
  ...wheel(24, 46, 9),
  ...wheel(72, 46, 9),
];

// Truck: cab in front, open cargo with parcels.
const truck = [
  shadow,
  { t: 'rect', x: 34, y: 8, width: 56, height: 32, rx: 2, fill: YELLOW },
  { t: 'rect', x: 34, y: 8, width: 56, height: 5, fill: YELLOW_DARK },
  ...parcelBox(40, 16, 14, 12),
  ...parcelBox(58, 20, 12, 10),
  ...parcelBox(73, 14, 13, 14),
  { t: 'path', d: 'M6 46 L6 28 Q6 22 12 20 L20 16 Q22 15 26 15 L34 15 L34 46 Z', fill: RED },
  { t: 'path', d: 'M14 22 L22 19 L30 19 L30 30 L12 30 Q12 25 14 22 Z', fill: GLASS },
  { t: 'rect', x: 6, y: 34, width: 5, height: 4, rx: 1, fill: YELLOW },
  { t: 'rect', x: 6, y: 40, width: 84, height: 6, fill: '#4B5563' },
  ...wheel(20, 47, 9),
  ...wheel(58, 47, 9),
  ...wheel(78, 47, 9),
];

// No vehicle chosen (single "Doorstep delivery" service): a parcel box.
const parcel = [
  shadow,
  { t: 'path', d: 'M28 22 L48 12 L68 22 L48 32 Z', fill: TAPE },
  { t: 'path', d: 'M28 22 L48 32 L48 56 L28 46 Z', fill: BOX },
  { t: 'path', d: 'M68 22 L48 32 L48 56 L68 46 Z', fill: '#B97F43' },
  { t: 'path', d: 'M38 17 L58 27 L58 35 L54 33 L54 29 L34 19 Z', fill: '#FFFFFF', opacity: 0.55 },
  { t: 'rect', x: 31, y: 36, width: 10, height: 6, rx: 1, fill: '#FFFFFF', opacity: 0.8 },
];

export const VEHICLE_ART = { bike, scooter, auto, car, van, truck, parcel };
export const vehicleArt = icon => VEHICLE_ART[icon] || VEHICLE_ART.parcel;
