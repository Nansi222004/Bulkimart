// The inline SVG icons the web customer app draws (Feather-style paths), as react-native-svg components.
// Lucide icons used by the web (lucide-react) come from lucide-react-native with the same names.
import React from 'react';
import Svg, { Circle, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';

const S = ({ size = 20, color = '#172b4d', width = 2, fill = 'none', children, style }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" style={style}>{children}</Svg>
);

export const SearchIcon = p => <S {...p}><Circle cx="11" cy="11" r="8" /><Line x1="21" y1="21" x2="16.65" y2="16.65" /></S>;
export const MicIcon = p => <S {...p}><Path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><Path d="M19 10v2a7 7 0 0 1-14 0v-2" /><Line x1="12" y1="19" x2="12" y2="23" /><Line x1="8" y1="23" x2="16" y2="23" /></S>;
export const CameraIcon = p => <S {...p}><Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><Circle cx="12" cy="13" r="4" /></S>;
export const HeartIcon = ({ filled, ...p }) => <S {...p} fill={filled ? p.color : 'none'}><Path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></S>;
export const BellIcon = p => <S {...p}><Path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><Path d="M13.73 21a2 2 0 0 1-3.46 0" /></S>;
export const UserIcon = p => <S {...p}><Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><Circle cx="12" cy="7" r="4" /></S>;
export const CartIcon = p => <S {...p}><Circle cx="9" cy="20" r="1" /><Circle cx="19" cy="20" r="1" /><Path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L22 8H6" /></S>;
export const PinIcon = p => <S {...p}><Path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><Circle cx="12" cy="10" r="2.5" /></S>;
export const ChevronDown = p => <S {...p}><Polyline points="6 9 12 15 18 9" /></S>;
export const ChevronRight = p => <S {...p}><Polyline points="9 18 15 12 9 6" /></S>;
export const ChevronLeft = p => <S {...p}><Polyline points="15 18 9 12 15 6" /></S>;
export const ArrowLeft = p => <S {...p}><Line x1="19" y1="12" x2="5" y2="12" /><Polyline points="12 19 5 12 12 5" /></S>;
export const ArrowRight = p => <S {...p}><Line x1="5" y1="12" x2="19" y2="12" /><Polyline points="12 5 19 12 12 19" /></S>;
export const CloseIcon = p => <S {...p}><Line x1="18" y1="6" x2="6" y2="18" /><Line x1="6" y1="6" x2="18" y2="18" /></S>;
export const BoltIcon = ({ size = 14, color }) => <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></Svg>;
export const HomeIcon = ({ filled, ...p }) => <S {...p} fill={filled ? p.color : 'none'}><Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><Polyline points="9 22 9 12 15 12 15 22" /></S>;
export const GridIcon = ({ radius = 1.5, ...p }) => <S {...p}><Rect x="3" y="3" width="7" height="7" rx={radius} /><Rect x="14" y="3" width="7" height="7" rx={radius} /><Rect x="14" y="14" width="7" height="7" rx={radius} /><Rect x="3" y="14" width="7" height="7" rx={radius} /></S>;
export const OrdersIcon = p => <S {...p}><Path d="M6 2h12l3 5-9 5-9-5 3-5z" /><Path d="M3 7v10l9 5 9-5V7" /><Path d="M12 12v10" /></S>;
export const TicketIcon = p => <S {...p}><Path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><Line x1="7" y1="7" x2="7.01" y2="7" /></S>;
export const BulkIcon = p => <S {...p}><Path d="m3 7 9-4 9 4-9 4-9-4Z" /><Path d="M3 7v10l9 4 9-4V7" /><Path d="M12 11v10" /><Path d="m7.5 5 9 4" /></S>;
export const PlusIcon = p => <S {...p}><Line x1="12" y1="5" x2="12" y2="19" /><Line x1="5" y1="12" x2="19" y2="12" /></S>;
export const MinusIcon = p => <S {...p}><Line x1="5" y1="12" x2="19" y2="12" /></S>;
export const TrashIcon = p => <S {...p}><Polyline points="3 6 5 6 21 6" /><Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></S>;
export const CheckIcon = p => <S {...p}><Polyline points="20 6 9 17 4 12" /></S>;
export const StarIcon = ({ filled, ...p }) => <S {...p} fill={filled ? p.color : 'none'}><Polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></S>;
export const LogoutIcon = p => <S {...p}><Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><Polyline points="16 17 21 12 16 7" /><Line x1="21" y1="12" x2="9" y2="12" /></S>;
export const FilterIcon = p => <S {...p}><Line x1="4" y1="6" x2="20" y2="6" /><Line x1="7" y1="12" x2="17" y2="12" /><Line x1="10" y1="18" x2="14" y2="18" /></S>;
export const ClockIcon = p => <S {...p}><Circle cx="12" cy="12" r="10" /><Polyline points="12 6 12 12 16 14" /></S>;
export const PhoneIcon = p => <S {...p}><Path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></S>;
export const DownloadIcon = p => <S {...p}><Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><Polyline points="7 10 12 15 17 10" /><Line x1="12" y1="15" x2="12" y2="3" /></S>;
export const ImageIcon = p => <S {...p}><Rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><Circle cx="8.5" cy="8.5" r="1.5" /><Polyline points="21 15 16 10 5 21" /></S>;
export const EditIcon = p => <S {...p}><Path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><Path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></S>;
export const InfoIcon = p => <S {...p}><Circle cx="12" cy="12" r="10" /><Line x1="12" y1="16" x2="12" y2="12" /><Line x1="12" y1="8" x2="12.01" y2="8" /></S>;
export const ShieldIcon = p => <S {...p}><Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></S>;
export const WalletIcon = p => <S {...p}><Rect x="2" y="5" width="20" height="14" rx="2" /><Path d="M16 12h.01" /><Path d="M2 10h20" /></S>;
export const HelpIcon = p => <S {...p}><Circle cx="12" cy="12" r="10" /><Path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><Line x1="12" y1="17" x2="12.01" y2="17" /></S>;
export const BookIcon = p => <S {...p}><Path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><Path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></S>;
export const TruckIcon = p => <S {...p}><Rect x="1" y="3" width="15" height="13" /><Polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><Circle cx="5.5" cy="18.5" r="2.5" /><Circle cx="18.5" cy="18.5" r="2.5" /></S>;
export const ShareIcon = p => <S {...p}><Circle cx="18" cy="5" r="3" /><Circle cx="6" cy="12" r="3" /><Circle cx="18" cy="19" r="3" /><Line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><Line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></S>;
export const RefreshIcon = p => <S {...p}><Polyline points="23 4 23 10 17 10" /><Polyline points="1 20 1 14 7 14" /><Path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></S>;
export const ScooterIcon = p => <S {...p}><Circle cx="5" cy="18" r="3" /><Circle cx="19" cy="18" r="3" /><Path d="M12 18V8h6a4 4 0 0 1 4 4v3" /><Line x1="8" y1="18" x2="16" y2="18" /><Polyline points="10 5 12 8 16 8" /></S>;
export const BagIcon = p => <S {...p}><Path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><Line x1="3" y1="6" x2="21" y2="6" /><Path d="M16 10a4 4 0 0 1-8 0" /></S>;
export const StoreIcon = p => <S {...p}><Path d="M2 9l3-6h14l3 6v1a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-3-1V9z" /><Path d="M4 10v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V10" /><Path d="M9 22V12h6v10" /></S>;
