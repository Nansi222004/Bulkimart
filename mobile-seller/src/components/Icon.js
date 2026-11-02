import React from 'react';
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

// Line icons (24×24, stroke-based) so tabs and menus look the same on every phone.
// Text glyphs like ◉ or ⚙ render differently per font and looked like plain dots.
const ICONS = {
  home: <><Path d="M3 10.5 12 3l9 7.5" /><Path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></>,
  orders: <><Path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><Rect x="8" y="2" width="8" height="4" rx="1" /><Line x1="8" y1="12" x2="16" y2="12" /><Line x1="8" y1="16" x2="13" y2="16" /></>,
  products: <><Path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><Polyline points="3 8 12 13 21 8" /><Line x1="12" y1="13" x2="12" y2="21" /></>,
  wallet: <><Path d="M20 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-4a2 2 0 0 0 0 4h4v-4" /><Path d="M3 6v12a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-2" /></>,
  user: <><Circle cx="12" cy="8" r="4" /><Path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></>,
  layers: <><Path d="m12 2 10 5-10 5L2 7l10-5Z" /><Path d="m2 17 10 5 10-5" /><Path d="m2 12 10 5 10-5" /></>,
  truck: <><Path d="M1 4h13v12H1z" /><Path d="M14 9h4l3 3v4h-7" /><Circle cx="5.5" cy="18.5" r="2" /><Circle cx="17.5" cy="18.5" r="2" /></>,
  returns: <><Polyline points="9 14 4 9 9 4" /><Path d="M20 20v-7a4 4 0 0 0-4-4H4" /></>,
  help: <><Circle cx="12" cy="12" r="10" /><Path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><Line x1="12" y1="17" x2="12.01" y2="17" /></>,
  megaphone: <><Path d="m3 11 15-6v14L3 13v-2Z" /><Path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>,
  chart: <><Polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><Polyline points="16 7 22 7 22 13" /></>,
  file: <><Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><Polyline points="14 2 14 8 20 8" /><Line x1="8" y1="13" x2="16" y2="13" /><Line x1="8" y1="17" x2="13" y2="17" /></>,
  rupee: <><Path d="M6 3h12" /><Path d="M6 8h12" /><Path d="m6 13 8.5 8" /><Path d="M6 13h3a5 5 0 0 0 0-10" /></>,
  percent: <><Line x1="19" y1="5" x2="5" y2="19" /><Circle cx="6.5" cy="6.5" r="2.5" /><Circle cx="17.5" cy="17.5" r="2.5" /></>,
  settings: <><Circle cx="12" cy="12" r="3" /><Path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  mapPin: <><Path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><Circle cx="12" cy="10" r="3" /></>,
  shield: <><Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><Polyline points="9 12 11 14 15 10" /></>,
  bell: <><Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><Path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>,
  headset: <><Path d="M3 14v-2a9 9 0 0 1 18 0v2" /><Path d="M21 15a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2Z" /><Path d="M3 15a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2Z" /><Path d="M18 17v1a3 3 0 0 1-3 3h-3" /></>,
  logout: <><Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><Polyline points="16 17 21 12 16 7" /><Line x1="21" y1="12" x2="9" y2="12" /></>,
  trash: <><Polyline points="3 6 5 6 21 6" /><Path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><Path d="M10 11v6" /><Path d="M14 11v6" /><Path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></>,
  edit: <><Path d="M12 20h9" /><Path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  close: <><Line x1="18" y1="6" x2="6" y2="18" /><Line x1="6" y1="6" x2="18" y2="18" /></>,
  external: <><Path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><Polyline points="15 3 21 3 21 9" /><Line x1="10" y1="14" x2="21" y2="3" /></>,
};

export default function Icon({ name, size = 20, color = '#000', strokeWidth = 2 }) {
  const shape = ICONS[name];
  if (!shape) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" accessible={false}>
      {shape}
    </Svg>
  );
}
