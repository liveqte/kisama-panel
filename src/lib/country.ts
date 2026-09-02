const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  'Afghanistan': 'AF', 'Albania': 'AL', 'Algeria': 'DZ', 'Andorra': 'AD', 'Angola': 'AO',
  'Anguilla': 'AI', 'Antigua and Barbuda': 'AG', 'Argentina': 'AR', 'Armenia': 'AM',
  'Aruba': 'AW', 'Australia': 'AU', 'Austria': 'AT', 'Azerbaijan': 'AZ', 'Bahamas': 'BS',
  'Bahrain': 'BH', 'Bangladesh': 'BD', 'Barbados': 'BB', 'Belarus': 'BY', 'Belgium': 'BE',
  'Belize': 'BZ', 'Benin': 'BJ', 'Bhutan': 'BT', 'Bolivia': 'BO', 'Bosnia and Herzegovina': 'BA',
  'Botswana': 'BW', 'Brazil': 'BR', 'British Virgin Islands': 'VG', 'Brunei': 'BN',
  'Bulgaria': 'BG', 'Burkina Faso': 'BF', 'Burundi': 'BI', 'Cambodia': 'KH', 'Cameroon': 'CM',
  'Canada': 'CA', 'Cape Verde': 'CV', 'Cayman Islands': 'KY', 'Central African Republic': 'CF',
  'Chad': 'TD', 'Chile': 'CL', 'China': 'CN', 'Colombia': 'CO', 'Comoros': 'KM',
  'Congo': 'CG', 'Democratic Republic of the Congo': 'CD', 'Cook Islands': 'CK',
  'Costa Rica': 'CR', "Cote d'Ivoire": 'CI', 'Croatia': 'HR', 'Cuba': 'CU', 'Curacao': 'CW',
  'Cyprus': 'CY', 'Czechia': 'CZ', 'Czech Republic': 'CZ', 'Denmark': 'DK', 'Djibouti': 'DJ',
  'Dominica': 'DM', 'Dominican Republic': 'DO', 'Ecuador': 'EC', 'Egypt': 'EG',
  'El Salvador': 'SV', 'Equatorial Guinea': 'GQ', 'Eritrea': 'ER', 'Estonia': 'EE',
  'Eswatini': 'SZ', 'Swaziland': 'SZ', 'Ethiopia': 'ET', 'Falkland Islands': 'FK',
  'Fiji': 'FJ', 'Finland': 'FI', 'France': 'FR', 'French Guiana': 'GF', 'French Polynesia': 'PF',
  'Gabon': 'GA', 'Gambia': 'GM', 'Georgia': 'GE', 'Germany': 'DE', 'Ghana': 'GH',
  'Gibraltar': 'GI', 'Greece': 'GR', 'Greenland': 'GL', 'Grenada': 'GD', 'Guadeloupe': 'GP',
  'Guam': 'GU', 'Guatemala': 'GT', 'Guernsey': 'GG', 'Guinea': 'GN', 'Guinea-Bissau': 'GW',
  'Guyana': 'GY', 'Haiti': 'HT', 'Honduras': 'HN', 'Hong Kong': 'HK', 'Hungary': 'HU',
  'Iceland': 'IS', 'India': 'IN', 'Indonesia': 'ID', 'Iran': 'IR', 'Iraq': 'IQ',
  'Ireland': 'IE', 'Isle of Man': 'IM', 'Israel': 'IL', 'Italy': 'IT', 'Jamaica': 'JM',
  'Japan': 'JP', 'Jersey': 'JE', 'Jordan': 'JO', 'Kazakhstan': 'KZ', 'Kenya': 'KE',
  'Kiribati': 'KI', 'Kosovo': 'XK', 'Kuwait': 'KW', 'Kyrgyzstan': 'KG', 'Laos': 'LA',
  'Latvia': 'LV', 'Lebanon': 'LB', 'Lesotho': 'LS', 'Liberia': 'LR', 'Libya': 'LY',
  'Liechtenstein': 'LI', 'Lithuania': 'LT', 'Luxembourg': 'LU', 'Macau': 'MO',
  'Macedonia': 'MK', 'North Macedonia': 'MK', 'Madagascar': 'MG', 'Malawi': 'MW',
  'Malaysia': 'MY', 'Maldives': 'MV', 'Mali': 'ML', 'Malta': 'MT', 'Marshall Islands': 'MH',
  'Martinique': 'MQ', 'Mauritania': 'MR', 'Mauritius': 'MU', 'Mexico': 'MX',
  'Moldova': 'MD', 'Monaco': 'MC', 'Mongolia': 'MN', 'Montenegro': 'ME', 'Montserrat': 'MS',
  'Morocco': 'MA', 'Mozambique': 'MZ', 'Myanmar': 'MM', 'Namibia': 'NA', 'Nauru': 'NR',
  'Nepal': 'NP', 'Netherlands': 'NL', 'New Caledonia': 'NC', 'New Zealand': 'NZ',
  'Nicaragua': 'NI', 'Niger': 'NE', 'Nigeria': 'NG', 'Niue': 'NU', 'North Korea': 'KP',
  'Northern Mariana Islands': 'MP', 'Norway': 'NO', 'Oman': 'OM', 'Pakistan': 'PK',
  'Palau': 'PW', 'Palestine': 'PS', 'Panama': 'PA', 'Papua New Guinea': 'PG', 'Paraguay': 'PY',
  'Peru': 'PE', 'Philippines': 'PH', 'Poland': 'PL', 'Portugal': 'PT', 'Puerto Rico': 'PR',
  'Qatar': 'QA', 'Reunion': 'RE', 'Romania': 'RO', 'Russia': 'RU', 'Rwanda': 'RW',
  'Saint Kitts and Nevis': 'KN', 'Saint Lucia': 'LC', 'Saint Vincent and the Grenadines': 'VC',
  'Samoa': 'WS', 'San Marino': 'SM', 'Sao Tome and Principe': 'ST', 'Saudi Arabia': 'SA',
  'Senegal': 'SN', 'Serbia': 'RS', 'Seychelles': 'SC', 'Sierra Leone': 'SL', 'Singapore': 'SG',
  'Slovakia': 'SK', 'Slovenia': 'SI', 'Solomon Islands': 'SB', 'Somalia': 'SO',
  'South Africa': 'ZA', 'South Korea': 'KR', 'South Sudan': 'SS', 'Spain': 'ES',
  'Sri Lanka': 'LK', 'Sudan': 'SD', 'Suriname': 'SR', 'Sweden': 'SE', 'Switzerland': 'CH',
  'Syria': 'SY', 'Taiwan': 'TW', 'Tajikistan': 'TJ', 'Tanzania': 'TZ', 'Thailand': 'TH',
  'Timor-Leste': 'TL', 'Togo': 'TG', 'Tonga': 'TO', 'Trinidad and Tobago': 'TT',
  'Tunisia': 'TN', 'Turkey': 'TR', 'Turkmenistan': 'TM', 'Turks and Caicos Islands': 'TC',
  'Tuvalu': 'TV', 'U.S. Virgin Islands': 'VI', 'Uganda': 'UG', 'Ukraine': 'UA',
  'United Arab Emirates': 'AE', 'United Kingdom': 'GB', 'United States': 'US',
  'Uruguay': 'UY', 'Uzbekistan': 'UZ', 'Vanuatu': 'VU', 'Vatican': 'VA',
  'Venezuela': 'VE', 'Vietnam': 'VN', 'Yemen': 'YE', 'Zambia': 'ZM', 'Zimbabwe': 'ZW'
};

const COUNTRY_CODE_PATTERN = /^[A-Za-z]{2}$/;

const COUNTRY_NAME_INDEX: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_NAME_TO_CODE).map(([name, code]) => [name.toLowerCase(), code])
);

export function countryNameToCode(name?: string): string | undefined {
  if (!name) return undefined;
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  if (COUNTRY_CODE_PATTERN.test(trimmed)) return trimmed.toUpperCase();
  return COUNTRY_NAME_INDEX[trimmed.toLowerCase()] ?? undefined;
}