/** Classify job titles into seniority / function buckets for analytics. */
const ROLE_RULES = [
  {
    re: /\b(ceo|chief executive|founder|co-founder|cofounder|co founder|owner|president|managing director)\b/i,
    group: 'CEO / Founder',
    filterToken: 'CEO',
  },
  {
    re: /\b(cto|chief technology|chief technical)\b/i,
    group: 'CTO',
    filterToken: 'CTO',
  },
  {
    re: /\b(cfo|chief financial)\b/i,
    group: 'CFO',
    filterToken: 'CFO',
  },
  {
    re: /\b(coo|chief operating)\b/i,
    group: 'COO',
    filterToken: 'COO',
  },
  {
    re: /\b(cmo|chief marketing)\b/i,
    group: 'CMO',
    filterToken: 'CMO',
  },
  {
    re: /\b(cpo|chief product)\b/i,
    group: 'CPO',
    filterToken: 'CPO',
  },
  {
    re: /\b(svp|senior vice president|evp|executive vice president|vp|vice president)\b/i,
    group: 'VP',
    filterToken: 'VP',
  },
  {
    re: /\b(director|head of)\b/i,
    group: 'Director',
    filterToken: 'Director',
  },
  {
    re: /\b(product manager|product owner|\bpm\b)\b/i,
    group: 'Product',
    filterToken: 'Product',
  },
  {
    re: /\b(engineer|developer|architect|devops|sre|software|programmer)\b/i,
    group: 'Engineer',
    filterToken: 'Engineer',
  },
  {
    re: /\b(sales|account executive|business development|\bbd\b|growth)\b/i,
    group: 'Sales / BD',
    filterToken: 'Sales',
  },
  {
    re: /\b(marketing|brand|content|seo|demand gen)\b/i,
    group: 'Marketing',
    filterToken: 'Marketing',
  },
  {
    re: /\b(designer|design|\bux\b|\bui\b)\b/i,
    group: 'Design',
    filterToken: 'Design',
  },
  {
    re: /\b(manager|lead|principal)\b/i,
    group: 'Manager / Lead',
    filterToken: 'Manager',
  },
  {
    re: /\b(consultant|advisor|adviser|freelance)\b/i,
    group: 'Consultant / Advisor',
    filterToken: 'Consultant',
  },
  {
    re: /\b(recruiter|talent|\bhr\b|human resources|people ops)\b/i,
    group: 'HR / Talent',
    filterToken: 'Recruiter',
  },
  {
    re: /\b(investor|venture|\bvc\b|\bpartner\b)\b/i,
    group: 'Investor / Partner',
    filterToken: 'Investor',
  },
];

export function roleGroupForTitle(title) {
  const text = (title ?? '').trim();
  if (!text) return { group: 'Other roles', filterToken: null };

  for (const rule of ROLE_RULES) {
    if (rule.re.test(text)) {
      return { group: rule.group, filterToken: rule.filterToken };
    }
  }

  return { group: 'Other roles', filterToken: null };
}

export function aggregateRoleGroups(rows) {
  const buckets = new Map();

  for (const row of rows ?? []) {
    if (!row?.value && !row?.label) continue;
    const title = row.value ?? row.label;
    const { group, filterToken } = roleGroupForTitle(title);
    const existing = buckets.get(group) ?? {
      value: group,
      label: group,
      count: 0,
      filterToken: filterToken ?? null,
    };
    existing.count += row.count ?? 0;
    buckets.set(group, existing);
  }

  return [...buckets.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
