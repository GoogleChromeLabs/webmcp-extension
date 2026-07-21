/**
 * CDDS Design Kit & Gemini Foundations - Typography Specs
 */

export const fontFamilies = {
  body: "'Google Sans Text', -apple-system, BlinkMacSystemFont, sans-serif",
  flex: "'Google Sans Flex', -apple-system, BlinkMacSystemFont, sans-serif",
  inter: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  symbols: "'Google Symbols', sans-serif"
};

export const fontWeights = {
  regular: 400,
  medium: 500,
  semiBold: 600,
  bold: 700
};

export const typography = {
  header: { fontFamily: fontFamilies.inter, fontSize: '14px', lineHeight: '20px', fontWeight: fontWeights.semiBold },
  body1: { fontFamily: fontFamilies.body, fontSize: '16px', lineHeight: '24px', fontWeight: fontWeights.regular },
  body2: { fontFamily: fontFamilies.body, fontSize: '14px', lineHeight: '20px', fontWeight: fontWeights.regular },
  body3: { fontFamily: fontFamilies.body, fontSize: '13px', lineHeight: '20px', fontWeight: fontWeights.regular },
  body4: { fontFamily: fontFamilies.body, fontSize: '12px', lineHeight: '18px', fontWeight: fontWeights.medium },
  body5: { fontFamily: fontFamilies.body, fontSize: '11px', lineHeight: '16px', fontWeight: fontWeights.medium },
  button: { fontFamily: fontFamilies.flex, fontSize: '10px', lineHeight: '14px', fontWeight: fontWeights.medium }
};

export default typography;
