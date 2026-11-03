// Text and TextInput with the bundled Inter font and a cap on the phone's font-size setting, so phone
// font themes (e.g. handwriting fonts) and very large system text don't restyle or break the layouts.
import React from 'react';
import { Text as RNText, TextInput as RNTextInput } from 'react-native';

export const APP_FONT = 'Inter';
export const MAX_FONT_SCALE = 1.1;
const font = { fontFamily: APP_FONT };

export function Text({ style, maxFontSizeMultiplier = MAX_FONT_SCALE, ...props }) {
  return <RNText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} style={[font, style]} />;
}

export function TextInput({ style, maxFontSizeMultiplier = MAX_FONT_SCALE, ...props }) {
  return <RNTextInput maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} style={[font, style]} />;
}
