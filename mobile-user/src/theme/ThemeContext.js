import { createContext, useContext } from 'react';
import { themeFrom } from './index';
import { DEFAULT_TOKENS } from '../shared/storefront';

// Provided by StorefrontProvider with the published Storefront Studio theme; the default is the brand fallback
// the web uses before (or without) a published theme.
export const ThemeContext = createContext(themeFrom(DEFAULT_TOKENS));
export const useAppTheme = () => useContext(ThemeContext);
