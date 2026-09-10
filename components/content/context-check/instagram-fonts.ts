import {
  Archivo_Black,
  Barlow_Condensed,
  Inter,
  League_Spartan,
  Manrope,
} from 'next/font/google';

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

export const ccLeagueSpartan = League_Spartan({
  weight: ['600', '700'],
  subsets: ['latin'],
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
