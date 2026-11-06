/**
 * Where a user bets. Used to order the sportsbook list in onboarding and settings.
 * This never blocks a choice: people travel and bet across borders.
 */

export const BETTING_COUNTRIES = ['US', 'CA', 'OTHER'] as const;
export type BettingCountry = (typeof BETTING_COUNTRIES)[number];

export const COUNTRY_LABELS: Record<BettingCountry, string> = {
  US: 'United States',
  CA: 'Canada',
  OTHER: 'Somewhere else',
};

export type Subdivision = { code: string; name: string };

export const US_STATES: readonly Subdivision[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

export const CA_PROVINCES: readonly Subdivision[] = [
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' },
  { code: 'ON', name: 'Ontario' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'QC', name: 'Quebec' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'YT', name: 'Yukon' },
];

export function isBettingCountry(value: unknown): value is BettingCountry {
  return typeof value === 'string' && (BETTING_COUNTRIES as readonly string[]).includes(value);
}

export function subdivisionsFor(country: BettingCountry | null | undefined): readonly Subdivision[] {
  if (country === 'US') return US_STATES;
  if (country === 'CA') return CA_PROVINCES;
  return [];
}

export function isValidSubdivision(country: BettingCountry | null | undefined, code: unknown): boolean {
  if (typeof code !== 'string') return false;
  return subdivisionsFor(country).some((s) => s.code === code);
}

export function subdivisionLabel(country: BettingCountry | null | undefined): string {
  if (country === 'CA') return 'Province or territory';
  return 'State';
}

export function subdivisionName(country: BettingCountry | null | undefined, code: string | null | undefined): string | null {
  if (!code) return null;
  return subdivisionsFor(country).find((s) => s.code === code)?.name ?? null;
}
