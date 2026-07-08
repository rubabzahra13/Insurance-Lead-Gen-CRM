/** Map free-text location strings to a display region (country / macro area). */
const REGION_RULES = [
  { re: /pakistan|lahore|karachi|islamabad|punjab|sindh|rawalpindi/i, region: 'Pakistan', flag: '🇵🇰' },
  { re: /india|mumbai|bangalore|bengaluru|delhi|hyderabad|pune|chennai|kolkata/i, region: 'India', flag: '🇮🇳' },
  { re: /bangladesh|dhaka/i, region: 'Bangladesh', flag: '🇧🇩' },
  {
    re: /united states|u\.s\.|usa\b|america|san francisco|sf bay|silicon valley|new york|nyc|los angeles|chicago|austin|seattle|boston|miami|denver|atlanta|washington,?\s*dc/i,
    region: 'United States',
    flag: '🇺🇸',
  },
  { re: /canada|toronto|vancouver|montreal|calgary/i, region: 'Canada', flag: '🇨🇦' },
  { re: /united kingdom|uk\b|england|london|manchester|scotland/i, region: 'United Kingdom', flag: '🇬🇧' },
  { re: /germany|berlin|munich|deutschland/i, region: 'Germany', flag: '🇩🇪' },
  { re: /france|paris/i, region: 'France', flag: '🇫🇷' },
  { re: /uae|dubai|abu dhabi|united arab emirates/i, region: 'UAE', flag: '🇦🇪' },
  { re: /saudi|riyadh|jeddah/i, region: 'Saudi Arabia', flag: '🇸🇦' },
  { re: /australia|sydney|melbourne|brisbane/i, region: 'Australia', flag: '🇦🇺' },
  { re: /singapore/i, region: 'Singapore', flag: '🇸🇬' },
  { re: /china|beijing|shanghai|shenzhen/i, region: 'China', flag: '🇨🇳' },
  { re: /japan|tokyo|osaka/i, region: 'Japan', flag: '🇯🇵' },
  { re: /brazil|são paulo|sao paulo|rio de janeiro/i, region: 'Brazil', flag: '🇧🇷' },
  { re: /mexico|m[eé]xico/i, region: 'Mexico', flag: '🇲🇽' },
  { re: /netherlands|amsterdam|holland/i, region: 'Netherlands', flag: '🇳🇱' },
  { re: /spain|madrid|barcelona/i, region: 'Spain', flag: '🇪🇸' },
  { re: /italy|rome|milan/i, region: 'Italy', flag: '🇮🇹' },
  { re: /turkey|türkiye|istanbul/i, region: 'Turkey', flag: '🇹🇷' },
  { re: /south africa|johannesburg|cape town/i, region: 'South Africa', flag: '🇿🇦' },
  { re: /nigeria|lagos/i, region: 'Nigeria', flag: '🇳🇬' },
  { re: /kenya|nairobi/i, region: 'Kenya', flag: '🇰🇪' },
  { re: /egypt|cairo/i, region: 'Egypt', flag: '🇪🇬' },
  { re: /israel|tel aviv/i, region: 'Israel', flag: '🇮🇱' },
  { re: /philippines|manila/i, region: 'Philippines', flag: '🇵🇭' },
  { re: /vietnam|ho chi minh|hanoi/i, region: 'Vietnam', flag: '🇻🇳' },
  { re: /indonesia|jakarta/i, region: 'Indonesia', flag: '🇮🇩' },
  { re: /malaysia|kuala lumpur/i, region: 'Malaysia', flag: '🇲🇾' },
  { re: /thailand|bangkok/i, region: 'Thailand', flag: '🇹🇭' },
  { re: /ireland|dublin/i, region: 'Ireland', flag: '🇮🇪' },
  { re: /sweden|stockholm/i, region: 'Sweden', flag: '🇸🇪' },
  { re: /norway|oslo/i, region: 'Norway', flag: '🇳🇴' },
  { re: /switzerland|zurich|geneva/i, region: 'Switzerland', flag: '🇨🇭' },
  { re: /poland|warsaw/i, region: 'Poland', flag: '🇵🇱' },
  { re: /argentina|buenos aires/i, region: 'Argentina', flag: '🇦🇷' },
  { re: /colombia|bogot[aá]/i, region: 'Colombia', flag: '🇨🇴' },
  { re: /new zealand|auckland/i, region: 'New Zealand', flag: '🇳🇿' },
  { re: /hong kong/i, region: 'Hong Kong', flag: '🇭🇰' },
  { re: /taiwan|taipei/i, region: 'Taiwan', flag: '🇹🇼' },
  { re: /korea|seoul/i, region: 'South Korea', flag: '🇰🇷' },
];

export function regionForLocation(label) {
  if (!label?.trim()) {
    return { region: 'Unknown', flag: '🌍', shareKey: 'unknown' };
  }

  const text = label.trim();
  if (text === 'Other') {
    return { region: 'Other regions', flag: '🌐', shareKey: 'other' };
  }

  for (const rule of REGION_RULES) {
    if (rule.re.test(text)) {
      return { region: rule.region, flag: rule.flag, shareKey: rule.region };
    }
  }

  const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    const tail = parts[parts.length - 1];
    return { region: tail, flag: '📍', shareKey: tail.toLowerCase() };
  }

  return { region: text, flag: '📍', shareKey: text.toLowerCase() };
}

export function aggregateRegions(rows) {
  const buckets = new Map();

  for (const row of rows ?? []) {
    if (!row?.value && !row?.label) continue;
    const { region, flag, shareKey } = regionForLocation(row.value ?? row.label);
    const key = shareKey;
    const existing = buckets.get(key) ?? { region, flag, count: 0 };
    existing.count += row.count ?? 0;
    buckets.set(key, existing);
  }

  return [...buckets.values()].sort((a, b) => b.count - a.count || a.region.localeCompare(b.region));
}

export function buildRegionInsight(regions) {
  if (!regions.length) return null;

  const total = regions.reduce((sum, row) => sum + row.count, 0) || 1;
  const top = regions[0];
  const topShare = Math.round((top.count / total) * 100);

  if (regions.length === 1) {
    return `All mapped leads in this view are from ${top.region}.`;
  }

  const topTwoShare = Math.round(
    (regions.slice(0, 2).reduce((sum, row) => sum + row.count, 0) / total) * 100,
  );

  if (topShare >= 60) {
    return `${top.region} accounts for ${topShare}% of leads here · ${regions.length} regions total`;
  }

  return `Top regions cover ${topTwoShare}% of leads · ${regions.length} regions represented`;
}
