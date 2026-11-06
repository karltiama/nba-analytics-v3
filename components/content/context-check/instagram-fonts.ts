import { Archivo_Black, Barlow_Condensed, Inter, Manrope } from 'next/font/google';
import localFont from 'next/font/local';

/**
 * Instagram card fonts only. Applied as CSS variables on the card —
 * not on the document body, so web Context Check typography is unchanged.
 */
export const ccArchivoBlack = Archivo_Black({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-cc-archivo-black',
  display: 'swap',
});

export const ccManrope = Manrope({
  weight: ['500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-cc-manrope',
  display: 'swap',
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

export const ccInter = Inter({
  weight: ['500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-cc-inter',
  display: 'swap',
});

export const ccBarlowCondensed = Barlow_Condensed({
  weight: ['600', '700'],
  subsets: ['latin'],
  variable: '--font-cc-barlow-condensed',
  display: 'swap',
});

export const instagramFontVariableClassName = [
  ccArchivoBlack.variable,
  ccManrope.variable,
  ccLeagueSpartan.variable,
  ccInter.variable,
  ccBarlowCondensed.variable,
].join(' ');
