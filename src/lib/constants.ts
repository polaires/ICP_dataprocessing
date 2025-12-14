// Atomic weights for lanthanides (g/mol)
export const ATOMIC_WEIGHTS: Record<string, number> = {
  La: 138.905,
  Ce: 140.116,
  Pr: 140.908,
  Nd: 144.242,
  Pm: 145.0, // radioactive, rarely measured
  Sm: 150.36,
  Eu: 151.964,
  Gd: 157.25,
  Tb: 158.925,
  Dy: 162.500,
  Ho: 164.930,
  Er: 167.259,
  Tm: 168.934,
  Yb: 173.045,
  Lu: 174.967,
};

// Ionic radii for lanthanides (Å, +3 oxidation state, CN=6)
export const IONIC_RADII: Record<string, number> = {
  La: 1.032,
  Ce: 1.01,
  Pr: 0.99,
  Nd: 0.983,
  Pm: 0.97,
  Sm: 0.958,
  Eu: 0.947,
  Gd: 0.938,
  Tb: 0.923,
  Dy: 0.912,
  Ho: 0.901,
  Er: 0.89,
  Tm: 0.88,
  Yb: 0.868,
  Lu: 0.861,
};

// Standard order of lanthanides (by atomic number)
export const LANTHANIDE_ORDER = [
  'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd',
  'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu'
];

// Light vs Heavy REE classification
export const LIGHT_REE = ['La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu'];
export const HEAVY_REE = ['Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu'];

// Element colors for charts
export const ELEMENT_COLORS: Record<string, string> = {
  La: '#e6194b',
  Ce: '#3cb44b',
  Pr: '#ffe119',
  Nd: '#4363d8',
  Pm: '#f58231',
  Sm: '#911eb4',
  Eu: '#46f0f0',
  Gd: '#f032e6',
  Tb: '#bcf60c',
  Dy: '#fabebe',
  Ho: '#008080',
  Er: '#e6beff',
  Tm: '#9a6324',
  Yb: '#fffac8',
  Lu: '#800000',
};

// Common buffer keywords for auto-detection
export const BUFFER_KEYWORDS = ['buffer', 'blank', 'control', 'bg', 'background'];

// Common condition keywords
export const CONDITION_KEYWORDS = {
  water: ['h2o', 'water', 'aqueous', 'aq'],
  acid: ['atc', 'acetic', 'acid', 'hac', 'acetate'],
};

// Water exchange rates (k_ex) in units of 10^8 s^-1
// Reference: Helm & Merbach, Chem. Rev. 2005
export const WATER_EXCHANGE_RATES: Record<string, number> = {
  La: 2.1,
  Ce: 3.3,
  Pr: 4.4,
  Nd: 5.2,
  Sm: 7.4,
  Eu: 6.6,
  Gd: 6.7,
  Tb: 5.2,
  Dy: 4.2,
  Ho: 2.8,
  Er: 1.9,
  Tm: 1.4,
  Yb: 0.8,
  Lu: 0.6,
};

// Unpaired electrons for lanthanide 3+ ions
export const UNPAIRED_ELECTRONS: Record<string, number> = {
  La: 0,
  Ce: 1,
  Pr: 2,
  Nd: 3,
  Pm: 4,
  Sm: 5,
  Eu: 6,
  Gd: 7,
  Tb: 6,
  Dy: 5,
  Ho: 4,
  Er: 3,
  Tm: 2,
  Yb: 1,
  Lu: 0,
};

// Ionic radii in pm (for display, same as Å * 100)
export const IONIC_RADII_PM: Record<string, number> = {
  La: 103.2,
  Ce: 101.0,
  Pr: 99.0,
  Nd: 98.3,
  Sm: 95.8,
  Eu: 94.7,
  Gd: 93.8,
  Tb: 92.3,
  Dy: 91.2,
  Ho: 90.1,
  Er: 89.0,
  Tm: 88.0,
  Yb: 86.8,
  Lu: 86.1,
};
