import localFont from 'next/font/local';

/**
 * Instagram card fonts only. Applied as CSS variables on the card —
 * not on the document body, so web Context Check typography is unchanged.
 *
 * Latin WOFF2 files are self-hosted. The production build must not fetch
 * these families from Google Fonts.
 */
export const ccArchivoBlack = localFont({
  src: './fonts/archivo-black-latin-400.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-cc-archivo-black',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

export const ccManrope = localFont({
  src: [
    { path: './fonts/manrope-latin-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/manrope-latin-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/manrope-latin-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-cc-manrope',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

/**
 * Self-hosted: Google sometimes serves League Spartan as `/l/font?kit=...&skey=...` URLs,
 * which Turbopack's next/font/google loader cannot parse ("queries have exactly one entry"),
 * failing the production build. File is the Google Fonts v15 latin variable woff2.
 */
export const ccLeagueSpartan = localFont({
  src: './fonts/LeagueSpartan-latin-variable.woff2',
  weight: '600 700',
  style: 'normal',
  variable: '--font-cc-league-spartan',
  display: 'swap',
});

export const ccInter = localFont({
  src: [
    { path: './fonts/inter-latin-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/inter-latin-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/inter-latin-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-cc-inter',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

export const ccBarlowCondensed = localFont({
  src: [
    { path: '../../../app/fonts/barlow-condensed-latin-600.woff2', weight: '600', style: 'normal' },
    { path: '../../../app/fonts/barlow-condensed-latin-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-cc-barlow-condensed',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

export const instagramFontVariableClassName = [
  ccArchivoBlack.variable,
  ccManrope.variable,
  ccLeagueSpartan.variable,
  ccInter.variable,
  ccBarlowCondensed.variable,
].join(' ');
