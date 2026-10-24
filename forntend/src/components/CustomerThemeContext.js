import { createContext } from 'react';
// Presentation only. Undefined outside the customer provider preserves portal isolation.
export const CustomerThemeContext = createContext(undefined);
