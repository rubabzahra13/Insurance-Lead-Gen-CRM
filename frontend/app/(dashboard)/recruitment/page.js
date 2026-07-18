'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { individualShortLabel } from '../../../lib/avatar-labels';
import { LEAD_SEGMENTS, useIndividualSegment } from '../../../context/IndividualSegmentContext';
import { COLORS, GRADIENT, RGBA } from '../../../lib/colors';
import IndividualSearchPanel from '../../../components/IndividualSearchPanel';
import DotScrollArea from '../../../components/DotScrollArea';
import SearchableFilterSelect from '../../../components/SearchableFilterSelect';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  API_CACHE_KEYS,
  fetchCachedJson,
  getApiCache,
  invalidateApiCache,
  setApiCache,
} from '../../../lib/api-cache';
import { getApiBaseUrl } from '../../../lib/apiBaseUrl';
import { 
  Sparkles, AlertCircle, Search, MapPin, 
  Briefcase, Filter, X, RotateCcw, AlertTriangle, 
  CheckCircle2, ArrowUpRight, User, FileText, ChevronLeft, ChevronRight, Loader2,
  Clock, Activity, MessageSquare, TrendingUp, ArrowUpDown, Copy, Check,
  Pencil, Building2, ExternalLink, Mail
} from 'lucide-react';

const LIST_PAGE_SIZE = 10;
const ANALYTICS_PAGE_SIZE = 10;

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name_asc', label: 'Name A → Z' },
  { value: 'name_desc', label: 'Name Z → A' },
  { value: 'company_asc', label: 'Company A → Z' },
  { value: 'status', label: 'Outreach status' },
];

/** Hardcoded Job Seeker draft for manual intake-funnel QA (matches DB seed). */
const FUNNEL_TEST_LEAD_ID = 'f11e1000-0000-4000-8000-000000000001';
const FUNNEL_TEST_EMAIL = 'rubabzahra248@gmail.com';
const FUNNEL_TEST_LEAD = {
  id: FUNNEL_TEST_LEAD_ID,
  avatar_type: 'avatar1',
  name: 'Rubab Zahra',
  headline: 'Funnel Test, Insurance Sales Professional',
  role: 'Insurance Sales Representative',
  company: 'InsureLead Demo',
  past_experience: 'Hardcoded test lead for intake funnel verification.',
  location: 'Islamabad, Pakistan',
  linkedin_url: null,
  contact_email: FUNNEL_TEST_EMAIL,
  search_prompt: 'funnel test lead',
  source_query: 'funnel test lead',
  draft_count: 1,
  latest_draft: {
    id: 'funnel-test-draft',
    avatar12_lead_id: FUNNEL_TEST_LEAD_ID,
    status: 'draft',
    message: '',
    reasoning: 'Hardcoded funnel test fixture.',
    created_at: new Date().toISOString(),
  },
};

function withFunnelTestLead(items) {
  const list = Array.isArray(items) ? [...items] : [];
  const idx = list.findIndex((lead) => String(lead.id) === FUNNEL_TEST_LEAD_ID);
  if (idx >= 0) {
    const [existing] = list.splice(idx, 1);
    return [{
      ...FUNNEL_TEST_LEAD,
      ...existing,
      contact_email: existing.contact_email || FUNNEL_TEST_EMAIL,
    }, ...list];
  }
  return [FUNNEL_TEST_LEAD, ...list];
}

/**
 * Identity for matching a lead the pipeline just returned against a row in the
 * drafts list. The LinkedIn URL is the reliable key; fall back to the name so a
 * profile without a link still matches.
 */
function leadIdentityKey(lead) {
  const url = lead?.linkedin_url || lead?.link || '';
  const slug = String(url).match(/\/in\/([^/?#]+)/i)?.[1];
  if (slug) return `in:${slug.toLowerCase()}`;
  const name = String(lead?.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return name ? `name:${name}` : null;
}

function draftStatusLabel(status) {
  if (status === 'sent') return 'Sent';
  if (status === 'failed') return 'Failed';
  // Unsent outreach — not "draft person"; the lead still has profile + funnel.
  return 'Not sent';
}

function stripEmDashes(text) {
  if (!text) return '';
  return text.replace(/\s*[\u2014\u2013]\s*/g, ', ').trim();
}

function stripAvatarWording(text) {
  if (!text) return '';
  return String(text)
    .replace(/\bavatar\s*[12]\b/gi, '')
    .replace(/\bavatars?\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function formatLeadInsight(text) {
  return stripAvatarWording(stripEmDashes(text));
}

function displayField(value, label = 'details') {
  const text = String(value || '').trim();
  return text || `Add ${label}`;
}

function isMissingField(value) {
  return !String(value || '').trim();
}

/** Prefer stored location; if blank, reuse the place from the search query ("role in Place"). */
function resolveLeadLocation(lead) {
  const stored = String(lead?.location || '').trim();
  if (stored) return stored;
  const query = String(lead?.source_query || lead?.search_prompt || '').trim();
  const match = query.match(/\sin\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

/** Prefer a clean employer; never show LinkedIn Experience dumps as company. */
function displayCompanyOrExperience(lead) {
  const company = String(lead?.company || '').trim();
  if (company && company.length <= 60 && !/\b(present|years?|months?|sep|oct|nov|dec|jan|feb|mar|apr|may|jun|jul|aug)\b/i.test(company) && (company.match(/\./g) || []).length < 2) {
    return company;
  }
  const experience = String(lead?.past_experience || '').trim();
  if (experience && experience.length <= 80 && (experience.match(/\./g) || []).length < 2) {
    return experience;
  }
  return 'Add company';
}

function isCompanyOrExperienceMissing(lead) {
  const shown = displayCompanyOrExperience(lead);
  return shown === 'Add company';
}

// Query-only filter options (role/location typed when running a search).
// v2 keys abandon the old lead-title backfill lists.
const FILTER_ROLES_KEY = 'insurelead-draft-filter-roles-query-v2';
const FILTER_LOCATIONS_KEY = 'insurelead-draft-filter-locations-query-v2';
const FILTER_RECENT_ROLES_KEY = 'insurelead-draft-filter-recent-roles-query-v2';
const FILTER_RECENT_LOCATIONS_KEY = 'insurelead-draft-filter-recent-locations-query-v2';
const LEGACY_FILTER_KEYS = [
  'insurelead-draft-filter-roles',
  'insurelead-draft-filter-locations',
  'insurelead-draft-filter-recent-roles',
  'insurelead-draft-filter-recent-locations',
];
const MAX_RECENT_FILTERS = 8;

function loadFilterOptions(key) {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed)
      ? parsed.map((v) => String(v || '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function saveFilterOptions(key, options) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(options));
  } catch {
    // ignore quota / private mode
  }
}

function clearLegacyFilterStorage() {
  if (typeof window === 'undefined') return;
  try {
    LEGACY_FILTER_KEYS.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // ignore
  }
}

/** Keep search-query role/location as the user typed them (light cleanup only). */
function normalizeRoleOption(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (text.length < 2 || text.length > 80) return '';
  if (/^add /i.test(text)) return '';
  return text;
}

function normalizeLocationOption(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (text.length < 2 || text.length > 80) return '';
  if (/^add /i.test(text)) return '';
  return text;
}

function addUniqueOption(options, value, normalizer = (v) => String(v || '').trim()) {
  const next = normalizer(value);
  if (!next) return options;
  if (options.some((item) => item.toLowerCase() === next.toLowerCase())) return options;
  return [...options, next].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function pushRecentOption(recents, value, normalizer) {
  const nextValue = normalizer(value);
  if (!nextValue) return recents;
  const without = recents.filter((item) => item.toLowerCase() !== nextValue.toLowerCase());
  return [nextValue, ...without].slice(0, MAX_RECENT_FILTERS);
}

function leadMatchesRoleFilter(lead, roleFilter) {
  if (!roleFilter || roleFilter === 'all') return true;
  const needle = roleFilter.toLowerCase();
  const haystack = [
    lead.role,
    lead.headline,
    lead.search_prompt,
    lead.source_query,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

function leadMatchesLocationFilter(lead, locationFilter) {
  if (!locationFilter || locationFilter === 'all') return true;
  const needle = locationFilter.toLowerCase();
  const location = resolveLeadLocation(lead).toLowerCase();
  if (location && location.includes(needle.split(',')[0].trim())) return true;
  const haystack = [lead.location, lead.source_query, lead.search_prompt]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle) || needle.split(',').some((part) => {
    const token = part.trim();
    return token.length >= 3 && haystack.includes(token);
  });
}

function parseFunnelPayload(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatFunnelTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildIndividualFunnelSteps(leadDetails) {
  const events = leadDetails?.funnel_events || [];
  const latestByType = {};
  for (const event of events) {
    const type = event?.event_type;
    if (!type) continue;
    const prev = latestByType[type];
    if (!prev || new Date(event.created_at) > new Date(prev.created_at)) {
      latestByType[type] = event;
    }
  }

  const meetingPayload = parseFunnelPayload(latestByType.meeting_booked?.payload);
  const meetingDesc = meetingPayload?.date
    ? `Booked for ${meetingPayload.date}${meetingPayload.time ? ` at ${meetingPayload.time}` : ''}.`
    : 'Calendar booking completed on the intake page.';

  return [
    {
      id: 'link_clicked',
      label: 'Link Clicked',
      desc: 'Lead opened the custom landing page link.',
      completed: Boolean(latestByType.link_clicked),
      at: latestByType.link_clicked?.created_at || null,
    },
    {
      id: 'form_started',
      label: 'Intake Form Started',
      desc: 'Lead began filling out intake questions.',
      completed: Boolean(latestByType.form_started),
      at: latestByType.form_started?.created_at || null,
    },
    {
      id: 'form_submitted',
      label: 'Form Submitted',
      desc: 'Lead submitted contact and experience details.',
      completed: Boolean(latestByType.form_submitted),
      at: latestByType.form_submitted?.created_at || null,
    },
    {
      id: 'meeting_booked',
      label: 'Meeting Scheduled',
      desc: meetingDesc,
      completed: Boolean(latestByType.meeting_booked),
      at: latestByType.meeting_booked?.created_at || null,
    },
  ];
}

function RecruitmentWorkspaceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Selected state from URL
  const selectedLeadId = searchParams.get('leadId');
  const urlQuery = searchParams.get('q') || '';

  // Leads state — show funnel test fixture immediately so the list never hangs blank
  const [leads, setLeads] = useState(() => withFunnelTestLead([]));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Funnel dashboard state
  const [funnelData, setFunnelData] = useState({ chart: [], items: [] });
  const [funnelLoading, setFunnelLoading] = useState(true);
  const [funnelError, setFunnelError] = useState(false);
  const { leadSegment, setSegmentCounts } = useIndividualSegment();

  // Filters state
  const [textSearch, setTextSearch] = useState(urlQuery);
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'draft' | 'sent' | 'failed'
  const [roleFilter, setRoleFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [roleOptions, setRoleOptions] = useState([]);
  const [locationOptions, setLocationOptions] = useState([]);
  const [recentRoles, setRecentRoles] = useState([]);
  const [recentLocations, setRecentLocations] = useState([]);
  const [sortBy, setSortBy] = useState('newest');
  const [listPage, setListPage] = useState(1);
  const [analyticsPage, setAnalyticsPage] = useState(1);
  const urlView = searchParams.get('view');
  const [workspaceSection, setWorkspaceSection] = useState(
    urlView === 'source' || urlView === 'analytics' ? urlView : 'leads'
  ); // source | leads | analytics
  const [listFiltersOpen, setListFiltersOpen] = useState(false);

  useEffect(() => {
    clearLegacyFilterStorage();
    setRoleOptions(loadFilterOptions(FILTER_ROLES_KEY).map(normalizeRoleOption).filter(Boolean));
    setLocationOptions(loadFilterOptions(FILTER_LOCATIONS_KEY).map(normalizeLocationOption).filter(Boolean));
    setRecentRoles(loadFilterOptions(FILTER_RECENT_ROLES_KEY).map(normalizeRoleOption).filter(Boolean).slice(0, MAX_RECENT_FILTERS));
    setRecentLocations(loadFilterOptions(FILTER_RECENT_LOCATIONS_KEY).map(normalizeLocationOption).filter(Boolean).slice(0, MAX_RECENT_FILTERS));
  }, []);

  const rememberRoleOption = useCallback((value) => {
    const normalized = normalizeRoleOption(value);
    if (!normalized) return normalized;
    setRoleOptions((prev) => {
      const next = addUniqueOption(prev, normalized, normalizeRoleOption);
      if (next !== prev) saveFilterOptions(FILTER_ROLES_KEY, next);
      return next;
    });
    setRecentRoles((prev) => {
      const next = pushRecentOption(prev, normalized, normalizeRoleOption);
      if (next !== prev) saveFilterOptions(FILTER_RECENT_ROLES_KEY, next);
      return next;
    });
    return normalized;
  }, []);

  const rememberLocationOption = useCallback((value) => {
    const normalized = normalizeLocationOption(value);
    if (!normalized) return normalized;
    setLocationOptions((prev) => {
      const next = addUniqueOption(prev, normalized, normalizeLocationOption);
      if (next !== prev) saveFilterOptions(FILTER_LOCATIONS_KEY, next);
      return next;
    });
    setRecentLocations((prev) => {
      const next = pushRecentOption(prev, normalized, normalizeLocationOption);
      if (next !== prev) saveFilterOptions(FILTER_RECENT_LOCATIONS_KEY, next);
      return next;
    });
    return normalized;
  }, []);

  // The leads the most recent search returned, as { query, keys:Set, count }.
  // Needed because a person we already had is UPDATED rather than inserted, so
  // "Newest first" (created_at) hides them — they were the reason a search could
  // look like it did nothing.
  const [searchRun, setSearchRun] = useState(null);
  const [onlyThisSearch, setOnlyThisSearch] = useState(false);

  // Right pane details state
  const [activeTab, setActiveTab] = useState('profile'); // profile | compose | history | funnel
  const [selectedLeadDetails, setSelectedLeadDetails] = useState(null);
  const [draftMessage, setDraftMessage] = useState('');
  const [draftReasoning, setDraftReasoning] = useState('');
  const [rightLoading, setRightLoading] = useState(false);
  const [rightError, setRightError] = useState(false);
  const [noDraftExists, setNoDraftExists] = useState(false);
  const [draftCopied, setDraftCopied] = useState(false);
  const [markingSent, setMarkingSent] = useState(false);
  const [confirmMarkSentOpen, setConfirmMarkSentOpen] = useState(false);
  const [toast, setToast] = useState(null); // { message: string, type: 'success' | 'error' }
  const [editingLead, setEditingLead] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [savingLead, setSavingLead] = useState(false);
  const [editingDraft, setEditingDraft] = useState(false);
  const [draftBaseline, setDraftBaseline] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const draftTextareaRef = useRef(null);
  const draftLoadSeqRef = useRef(0);
  /** In-session cache of full lead detail payloads for fast revisit. */
  const leadDetailCacheRef = useRef(new Map());
  const toastTimerRef = useRef(null);

  const showToast = useCallback((message, type = 'success') => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const syncDraftIntoLeadState = useCallback((leadId, savedDraft, message) => {
    const normalized = {
      ...savedDraft,
      message,
    };

    setSelectedLeadDetails((prev) => {
      if (!prev || String(prev.id) !== String(leadId)) return prev;
      const drafts = Array.isArray(prev.drafts) ? [...prev.drafts] : [];
      const matchIdx = drafts.findIndex((d) => String(d.id) === String(normalized.id));
      if (matchIdx >= 0) {
        drafts[matchIdx] = { ...drafts[matchIdx], ...normalized };
      } else if (drafts.length === 0) {
        drafts.push(normalized);
      } else {
        drafts[drafts.length - 1] = { ...drafts[drafts.length - 1], ...normalized };
      }
      const next = { ...prev, drafts };
      leadDetailCacheRef.current.set(String(leadId), next);
      return next;
    });

    setLeads((prev) => {
      const next = prev.map((lead) => {
        if (String(lead.id) !== String(leadId)) return lead;
        return {
          ...lead,
          draft_count: Math.max(1, lead.draft_count || 0),
          latest_draft: {
            ...(lead.latest_draft || {}),
            ...normalized,
          },
        };
      });
      setApiCache(API_CACHE_KEYS.avatar12Leads, { items: next });
      return next;
    });
  }, []);

  // Fetch leads for Outreach Drafts (and topbar counts)
  const fetchLeads = useCallback(async ({ force = false } = {}) => {
    if (!force) {
      const cached = getApiCache(API_CACHE_KEYS.avatar12Leads);
      if (cached) {
        const items = Array.isArray(cached) ? cached : (cached.items || []);
        setLeads(withFunnelTestLead(items));
        setLoading(false);
        void fetchLeads({ force: true });
        return;
      }
    }

    if (!force) setLoading(true);
    setError(false);
    try {
      const apiBaseUrl = getApiBaseUrl();
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 45000);
      let data;
      try {
        const res = await fetch(`${apiBaseUrl}/api/avatar12/leads`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        data = await res.json();
      } finally {
        window.clearTimeout(timeoutId);
      }
      const items = withFunnelTestLead(Array.isArray(data) ? data : (data.items || []));
      setLeads(items);
      setApiCache(API_CACHE_KEYS.avatar12Leads, { items });
    } catch (err) {
      console.error(err);
      setError(true);
      setLeads((prev) => withFunnelTestLead(prev));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFunnelData = useCallback(async ({ force = false } = {}) => {
    if (!force) {
      const cached = getApiCache(API_CACHE_KEYS.funnel);
      if (cached) {
        setFunnelData({
          chart: cached.chart || [],
          items: cached.items || [],
        });
        setFunnelLoading(false);
        void fetchFunnelData({ force: true });
        return;
      }
    }
    if (!force) setFunnelLoading(true);
    setFunnelError(false);
    try {
      const apiBaseUrl = getApiBaseUrl();
      const { data } = await fetchCachedJson(`${apiBaseUrl}/api/dashboard/funnel`, {
        cacheKey: API_CACHE_KEYS.funnel,
        force: true,
      });
      setFunnelData({
        chart: data.chart || [],
        items: data.items || [],
      });
    } catch (err) {
      console.error(err);
      setFunnelError(true);
    } finally {
      setFunnelLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeads();
    fetchFunnelData();
  }, [fetchLeads, fetchFunnelData]);

  useEffect(() => {
    setSegmentCounts({
      avatar1: leads.filter((lead) => lead.avatar_type === 'avatar1').length,
      avatar2: leads.filter((lead) => lead.avatar_type === 'avatar2').length,
    });
  }, [leads, setSegmentCounts]);

  // Fetch selected lead details & latest draft when selectedLeadId changes
  useEffect(() => {
    if (!selectedLeadId) {
      setSelectedLeadDetails(null);
      setDraftMessage('');
      setDraftReasoning('');
      setNoDraftExists(false);
      setEditingLead(false);
      setEditForm(null);
      setEditingDraft(false);
      setDraftBaseline('');
      return;
    }

    let cancelled = false;
    const leadId = selectedLeadId;
    const loadSeq = ++draftLoadSeqRef.current;

    const loadRightPaneData = async () => {
      setRightError(false);
      setNoDraftExists(false);
      setActiveTab('profile');
      setDraftCopied(false);
      setEditingLead(false);
      setEditForm(null);
      setEditingDraft(false);

      const cached = leadDetailCacheRef.current.get(leadId) || leadDetailCacheRef.current.get(String(leadId));
      const listRow = leads.find((item) => String(item.id) === String(leadId));
      if (cached) {
        setSelectedLeadDetails(cached);
        setRightLoading(false);
      } else if (listRow) {
        setSelectedLeadDetails(listRow);
        setRightLoading(true);
      } else {
        setSelectedLeadDetails(null);
        setRightLoading(true);
      }

      try {
        const apiBaseUrl = getApiBaseUrl();

        const leadRes = await fetch(`${apiBaseUrl}/api/avatar12/leads/${leadId}`);
        if (!leadRes.ok) throw new Error('Failed to fetch lead details');
        const leadData = await leadRes.json();
        if (cancelled || loadSeq !== draftLoadSeqRef.current) return;

        leadDetailCacheRef.current.set(String(leadId), leadData);
        setSelectedLeadDetails(leadData);
        setRightLoading(false);

        const draftRes = await fetch(`${apiBaseUrl}/api/avatar12/leads/${leadId}/drafts/latest`);
        if (cancelled || loadSeq !== draftLoadSeqRef.current) return;

        if (draftRes.ok) {
          const draftData = await draftRes.json();
          // Keep draft body intact for edit/save round-trips (do not scrub wording here).
          const message = String(draftData.message || '');
          setDraftMessage(message);
          setDraftBaseline(message);
          setDraftReasoning(draftData.reasoning || '');
        } else if (draftRes.status === 404) {
          const draftsList = leadData.drafts || [];
          if (draftsList.length > 0) {
            const latest = [...draftsList].sort(
              (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0),
            ).at(-1);
            const message = String(latest?.message || '');
            setDraftMessage(message);
            setDraftBaseline(message);
            setDraftReasoning(latest?.reasoning || '');
          } else {
            setNoDraftExists(true);
            setDraftMessage('');
            setDraftBaseline('');
            setDraftReasoning('');
          }
        } else {
          throw new Error('Failed to load latest draft');
        }
      } catch (err) {
        console.error(err);
        if (!cancelled && loadSeq === draftLoadSeqRef.current) setRightError(true);
      } finally {
        if (!cancelled && loadSeq === draftLoadSeqRef.current) setRightLoading(false);
      }
    };

    loadRightPaneData();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeadId]);

  useEffect(() => {
    if (activeTab !== 'history' || !selectedLeadDetails) return;
    const status = selectedLeadDetails.drafts?.[selectedLeadDetails.drafts.length - 1]?.status || 'draft';
    if (status !== 'sent') {
      setActiveTab('compose');
    }
  }, [activeTab, selectedLeadDetails]);

  // Refresh funnel events when opening the Funnel tab
  useEffect(() => {
    if (activeTab !== 'funnel' || !selectedLeadId) return;
    let cancelled = false;

    const refreshFunnelEvents = async () => {
      try {
        const apiBaseUrl = getApiBaseUrl();
        const res = await fetch(`${apiBaseUrl}/api/avatar12/leads/${selectedLeadId}`);
        if (!res.ok || cancelled) return;
        const leadData = await res.json();
        if (cancelled) return;
        setSelectedLeadDetails((prev) => (prev ? { ...prev, ...leadData } : leadData));
      } catch (err) {
        console.error(err);
      }
    };

    refreshFunnelEvents();
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedLeadId]);

  const startEditingLead = (lead = selectedLeadDetails) => {
    if (!lead) return;
    setEditingDraft(false);
    setActiveTab('profile');
    setEditForm({
      name: lead.name || '',
      headline: lead.headline || '',
      role: lead.role || '',
      company: lead.company || '',
      location: lead.location || '',
      linkedin_url: lead.linkedin_url || '',
      contact_email: lead.contact_email || '',
    });
    setEditingLead(true);
  };

  const cancelEditingLead = () => {
    setEditingLead(false);
    setEditForm(null);
  };

  const startEditingDraft = () => {
    setEditingLead(false);
    setEditForm(null);
    setActiveTab('compose');
    setDraftBaseline(draftMessage);
    setEditingDraft(true);
    window.requestAnimationFrame(() => {
      draftTextareaRef.current?.focus();
    });
  };

  const cancelEditingDraft = () => {
    setDraftMessage(draftBaseline);
    setEditingDraft(false);
  };

  const finishEditingDraft = async () => {
    if (!selectedLeadId) return;
    const nextMessage = draftMessage;
    if (!nextMessage.trim()) {
      showToast('Add a message before saving.', 'error');
      return;
    }
    if (nextMessage === draftBaseline) {
      setEditingDraft(false);
      return;
    }

    setSavingDraft(true);
    const saveSeq = ++draftLoadSeqRef.current;
    try {
      const apiBaseUrl = getApiBaseUrl();
      const res = await fetch(`${apiBaseUrl}/api/avatar12/leads/${selectedLeadId}/drafts/latest`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: nextMessage }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const detail = errBody.detail;
        const message = typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail.map((item) => item?.msg || item).join(', ')
            : `Save failed (${res.status})`;
        throw new Error(message);
      }
      const savedDraft = await res.json();
      // Prefer exactly what we saved so the textarea never snaps back to a scrubbed/old body.
      const savedMessage = typeof savedDraft?.message === 'string' ? savedDraft.message : nextMessage;

      if (saveSeq !== draftLoadSeqRef.current) return;

      setDraftMessage(savedMessage);
      setDraftBaseline(savedMessage);
      setNoDraftExists(false);
      setEditingDraft(false);
      syncDraftIntoLeadState(selectedLeadId, savedDraft, savedMessage);
      showToast('Message saved');
    } catch (err) {
      console.error(err);
      showToast(err?.message || 'Could not save message', 'error');
    } finally {
      setSavingDraft(false);
    }
  };

  const saveLeadEdits = async () => {
    if (!selectedLeadId || !editForm) return;
    setSavingLead(true);
    try {
      const apiBaseUrl = getApiBaseUrl();
      const res = await fetch(`${apiBaseUrl}/api/avatar12/leads/${selectedLeadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const updated = await res.json();
      setSelectedLeadDetails((prev) => (prev ? { ...prev, ...updated } : updated));
      leadDetailCacheRef.current.set(selectedLeadId, {
        ...(leadDetailCacheRef.current.get(selectedLeadId) || {}),
        ...updated,
      });
      setLeads((prev) =>
        prev.map((lead) => (lead.id === selectedLeadId ? { ...lead, ...updated } : lead)),
      );
      invalidateApiCache([API_CACHE_KEYS.avatar12Leads]);
      setEditingLead(false);
      setEditForm(null);
      showToast('Lead updated');
    } catch (err) {
      console.error(err);
      showToast('Could not save lead changes', 'error');
    } finally {
      setSavingLead(false);
    }
  };

  // Update URL search parameters when selecting a lead
  const handleSelectLead = (leadId) => {
    if (!leadId) {
      setEditingLead(false);
      setEditForm(null);
      setEditingDraft(false);
    }

    const params = new URLSearchParams(searchParams.toString());
    if (leadId) {
      params.set('leadId', leadId);
    } else {
      params.delete('leadId');
    }
    if (textSearch) {
      params.set('q', textSearch);
    } else {
      params.delete('q');
    }
    router.push(`?${params.toString()}`);
  };

  // Clear selected lead when switching between job seekers and upgraders
  useEffect(() => {
    if (!selectedLeadId) return;
    const lead = leads.find((item) => String(item.id) === String(selectedLeadId));
    if (lead && lead.avatar_type !== leadSegment) {
      handleSelectLead('');
    }
  }, [leadSegment, selectedLeadId, leads]);

  // Reset Filters
  const handleResetFilters = () => {
    setTextSearch('');
    setStatusFilter('all');
    setRoleFilter('all');
    setLocationFilter('all');
    setSortBy('newest');
    setListPage(1);
    
    const params = new URLSearchParams(searchParams.toString());
    params.delete('q');
    if (selectedLeadId) {
      params.set('leadId', selectedLeadId);
    }
    router.push(`?${params.toString()}`);
  };

  // Sync text search state with URL query param
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setTextSearch(val);
    
    const params = new URLSearchParams(searchParams.toString());
    if (val.trim()) {
      params.set('q', val);
    } else {
      params.delete('q');
    }
    router.push(`?${params.toString()}`);
  };

  const handleCopyDraft = async () => {
    const text = draftMessage || '';
    if (!text.trim()) {
      showToast('Nothing to copy yet.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setDraftCopied(true);
      showToast('Message copied.');
      window.setTimeout(() => setDraftCopied(false), 2000);
    } catch (err) {
      console.error(err);
      showToast('Could not copy message.', 'error');
    }
  };

  const requestMarkAsSent = () => {
    if (!selectedLeadId) return;
    if (!draftMessage.trim()) {
      showToast('Add a message before marking as sent.', 'error');
      return;
    }
    setConfirmMarkSentOpen(true);
  };

  const handleMarkAsSent = async () => {
    if (!selectedLeadId) return;
    if (!draftMessage.trim()) {
      showToast('Add a message before marking as sent.', 'error');
      return;
    }

    setMarkingSent(true);
    try {
      const apiBaseUrl = getApiBaseUrl();
      const sendRes = await fetch(`${apiBaseUrl}/api/avatar12/leads/${selectedLeadId}/messages/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mark_only: true,
          message: draftMessage,
        }),
      });

      if (!sendRes.ok) {
        const errBody = await sendRes.json().catch(() => ({}));
        throw new Error(errBody.detail || 'Failed to mark draft as sent.');
      }

      const sendResult = await sendRes.json();
      const markedAt = sendResult?.draft?.sent_at || new Date().toISOString();
      const markedDraft = sendResult?.draft;
      setConfirmMarkSentOpen(false);
      showToast('Marked as sent.');

      setLeads((prev) => {
        const next = prev.map((l) => {
          if (l.id === selectedLeadId) {
            return {
              ...l,
              latest_draft: {
                ...(l.latest_draft || {}),
                ...(markedDraft || {}),
                status: 'sent',
                message: draftMessage,
                sent_at: markedAt,
              },
            };
          }
          return l;
        });
        setApiCache(API_CACHE_KEYS.avatar12Leads, { items: next });
        return next;
      });

      setSelectedLeadDetails((prev) => {
        if (!prev) return null;
        const updatedDrafts = prev.drafts ? [...prev.drafts] : [];
        if (updatedDrafts.length > 0) {
          const last = {
            ...updatedDrafts[updatedDrafts.length - 1],
            ...(markedDraft || {}),
            status: 'sent',
            message: draftMessage,
            sent_at: markedAt,
          };
          updatedDrafts[updatedDrafts.length - 1] = last;
        } else {
          updatedDrafts.push({
            id: markedDraft?.id || 'new',
            status: 'sent',
            message: draftMessage,
            reasoning: markedDraft?.reasoning || 'Draft created from scratch.',
            created_at: markedDraft?.created_at || new Date().toISOString(),
            sent_at: markedAt,
          });
        }
        return {
          ...prev,
          drafts: updatedDrafts,
        };
      });

      fetchFunnelData();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to mark draft as sent.', 'error');
    } finally {
      setMarkingSent(false);
    }
  };

  // A run belongs to one segment, so keep the filter from blanking the other tab.
  useEffect(() => {
    setOnlyThisSearch(false);
  }, [leadSegment]);

  const isFromSearchRun = useCallback(
    (lead) => {
      if (!searchRun?.keys?.size) return false;
      const key = leadIdentityKey(lead);
      return Boolean(key && searchRun.keys.has(key));
    },
    [searchRun],
  );

  // Filtering and sorting leads on client-side
  const filteredLeads = useMemo(() => {
    const filtered = leads.filter(lead => {
      const query = textSearch.toLowerCase().trim();
      if (query) {
        const nameMatch = lead.name?.toLowerCase().includes(query);
        const headlineMatch = lead.headline?.toLowerCase().includes(query);
        const companyMatch = lead.company?.toLowerCase().includes(query);
        const locationMatch = lead.location?.toLowerCase().includes(query);
        const promptMatch = lead.search_prompt?.toLowerCase().includes(query);
        const emailMatch = lead.contact_email?.toLowerCase().includes(query);
        if (!nameMatch && !headlineMatch && !companyMatch && !locationMatch && !promptMatch && !emailMatch) {
          return false;
        }
      }

      if (lead.avatar_type !== leadSegment) {
        return false;
      }

      const draftStatus = lead.latest_draft?.status || 'draft';
      if (statusFilter !== 'all' && draftStatus !== statusFilter) {
        return false;
      }

      if (!leadMatchesRoleFilter(lead, roleFilter)) {
        return false;
      }

      if (!leadMatchesLocationFilter(lead, locationFilter)) {
        return false;
      }

      if (onlyThisSearch && !isFromSearchRun(lead)) {
        return false;
      }

      return true;
    });

    const statusRank = { draft: 0, sent: 1, failed: 2 };
    const sorted = [...filtered];

    sorted.sort((a, b) => {
      // Anything the latest search returned floats to the top, whether it was a
      // brand new row or an existing lead this search re-found. Without this a
      // re-found lead keeps its old created_at and sinks out of sight.
      const aRun = isFromSearchRun(a) ? 1 : 0;
      const bRun = isFromSearchRun(b) ? 1 : 0;
      if (aRun !== bRun) return bRun - aRun;

      switch (sortBy) {
        case 'oldest':
          return new Date(a.created_at || 0) - new Date(b.created_at || 0);
        case 'name_asc':
          return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
        case 'name_desc':
          return (b.name || '').localeCompare(a.name || '', undefined, { sensitivity: 'base' });
        case 'company_asc':
          return (a.company || '').localeCompare(b.company || '', undefined, { sensitivity: 'base' });
        case 'status': {
          const aStatus = statusRank[a.latest_draft?.status || 'draft'] ?? 0;
          const bStatus = statusRank[b.latest_draft?.status || 'draft'] ?? 0;
          return aStatus - bStatus || new Date(b.created_at || 0) - new Date(a.created_at || 0);
        }
        case 'newest':
        default:
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
    });

    return sorted;
  }, [leads, textSearch, leadSegment, statusFilter, roleFilter, locationFilter, sortBy, onlyThisSearch, isFromSearchRun]);

  const listPageCount = Math.max(1, Math.ceil(filteredLeads.length / LIST_PAGE_SIZE));
  const safeListPage = Math.min(listPage, listPageCount);
  const listPageStart = filteredLeads.length === 0
    ? 0
    : (safeListPage - 1) * LIST_PAGE_SIZE + 1;
  const listPageEnd = Math.min(safeListPage * LIST_PAGE_SIZE, filteredLeads.length);
  const pagedLeads = useMemo(
    () => filteredLeads.slice(
      (safeListPage - 1) * LIST_PAGE_SIZE,
      safeListPage * LIST_PAGE_SIZE,
    ),
    [filteredLeads, safeListPage],
  );

  useEffect(() => {
    setListPage(1);
  }, [textSearch, leadSegment, statusFilter, roleFilter, locationFilter, sortBy, onlyThisSearch]);

  useEffect(() => {
    if (listPage > listPageCount) setListPage(listPageCount);
  }, [listPage, listPageCount]);

  // Calculate aggregate funnel metrics for the active segment
  const aggregateItems = useMemo(
    () => funnelData.items.filter((item) => item.avatar_type === leadSegment),
    [funnelData.items, leadSegment],
  );

  const analyticsPageCount = Math.max(1, Math.ceil(aggregateItems.length / ANALYTICS_PAGE_SIZE));
  const safeAnalyticsPage = Math.min(analyticsPage, analyticsPageCount);
  const analyticsPageStart = aggregateItems.length === 0
    ? 0
    : (safeAnalyticsPage - 1) * ANALYTICS_PAGE_SIZE + 1;
  const analyticsPageEnd = Math.min(safeAnalyticsPage * ANALYTICS_PAGE_SIZE, aggregateItems.length);
  const pagedAnalyticsItems = useMemo(
    () => aggregateItems.slice(
      (safeAnalyticsPage - 1) * ANALYTICS_PAGE_SIZE,
      safeAnalyticsPage * ANALYTICS_PAGE_SIZE,
    ),
    [aggregateItems, safeAnalyticsPage],
  );

  useEffect(() => {
    setAnalyticsPage(1);
  }, [leadSegment]);

  useEffect(() => {
    if (analyticsPage > analyticsPageCount) setAnalyticsPage(analyticsPageCount);
  }, [analyticsPage, analyticsPageCount]);

  const totals = aggregateItems.reduce((acc, item) => {
    acc.link_clicked += item.link_clicked || 0;
    acc.form_started += item.form_started || 0;
    acc.form_submitted += item.form_submitted || 0;
    acc.meeting_booked += item.meeting_booked || 0;
    return acc;
  }, { link_clicked: 0, form_started: 0, form_submitted: 0, meeting_booked: 0 });

  const activeFilterCount = [
    textSearch,
    statusFilter !== 'all' ? statusFilter : '',
    roleFilter !== 'all' ? roleFilter : '',
    locationFilter !== 'all' ? locationFilter : '',
  ].filter(Boolean).length;

  const activeSegmentMeta = LEAD_SEGMENTS.find((segment) => segment.id === leadSegment) || LEAD_SEGMENTS[0];

  const workspaceSections = [
    { id: 'source', label: 'Find New Leads', icon: Search, desc: 'Search for and source fresh individual prospects' },
    { id: 'leads', label: 'Outreach', icon: FileText, desc: 'Review leads, copy outreach, and mark as sent' },
    { id: 'analytics', label: 'Track Sent', icon: TrendingUp, desc: 'Monitor how sent outreach performs after delivery' },
  ];

  const leadDetailTabs = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'compose', label: 'Message', icon: MessageSquare },
    { id: 'history', label: 'Sent Review', icon: Clock, sentOnly: true },
    { id: 'funnel', label: 'Funnel', icon: Activity },
  ];

  const latestDraftStatus = selectedLeadDetails?.drafts?.[selectedLeadDetails.drafts.length - 1]?.status || 'draft';
  const isLatestDraftSent = latestDraftStatus === 'sent';
  const visibleLeadDetailTabs = leadDetailTabs.filter((tab) => !tab.sentOnly || isLatestDraftSent);

  const hasAnyFunnelActivity = totals.link_clicked > 0 || totals.form_started > 0 || totals.form_submitted > 0 || totals.meeting_booked > 0;

  const renderAnalyticsPanel = () => {
    if (funnelLoading) {
      return (
        <div className="individual-analytics-loading">
          <Loader2 className="animate-spin" size={32} style={{ color: COLORS.oldRose }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading sent draft tracking...</span>
        </div>
      );
    }
    if (funnelError) {
      return (
        <div className="individual-analytics-loading">
          <AlertTriangle size={36} style={{ color: COLORS.error }} />
          <h4 style={{ fontWeight: 600 }}>Failed to load sent draft tracking</h4>
          <button type="button" onClick={fetchFunnelData} className="chip-fallback-btn">Retry Load</button>
        </div>
      );
    }
    return (
      <div className="individual-analytics">
        <header className="individual-analytics__header">
          <div>
            <h3 className="individual-analytics__title">
              <TrendingUp size={20} aria-hidden="true" />
              Sent Draft Performance
            </h3>
            <p className="individual-analytics__subtitle">
              Track clicks, intake progress, and meetings for {activeSegmentMeta.label.toLowerCase()} you&apos;ve already sent.
            </p>
          </div>
        </header>

        {!hasAnyFunnelActivity ? (
          <div className="individual-analytics__empty glass-card">
            <TrendingUp size={40} aria-hidden="true" />
            <div>
              <h4>No sent draft activity yet</h4>
              <p>
                Once you send {activeSegmentMeta.label.toLowerCase()} outreach, responses will show up here.
              </p>
            </div>
          </div>
        ) : (
          <div className="individual-analytics__metrics" role="list" aria-label="Response stages after send">
            {[
              { stage: 'Clicks', count: totals.link_clicked, suffix: 'clicks' },
              { stage: 'Starts', count: totals.form_started, suffix: 'started' },
              { stage: 'Submits', count: totals.form_submitted, suffix: 'submitted' },
              { stage: 'Booked', count: totals.meeting_booked, suffix: 'booked' },
            ].map((step) => (
              <div key={step.stage} className="individual-analytics__metric" role="listitem">
                <span className="individual-analytics__metric-label">{step.stage}</span>
                <span className="individual-analytics__metric-value">{step.count}</span>
                <span className="individual-analytics__metric-suffix">{step.suffix}</span>
              </div>
            ))}
          </div>
        )}

        <div className="glass-card individual-analytics__table-card">
          <div className="individual-analytics__table-head">
            <h4>Sent draft activity by candidate</h4>
            <span>{aggregateItems.length} records</span>
          </div>
          <DotScrollArea className="individual-analytics__table-scroll results-table-scroll">
            <table className="results-table results-table--compact">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Type</th>
                  <th className="results-table__num">Clicks</th>
                  <th className="results-table__num">Starts</th>
                  <th className="results-table__num">Submits</th>
                  <th className="results-table__num">Booked</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {aggregateItems.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="results-table__empty">
                      No {activeSegmentMeta.label.toLowerCase()} with sent draft activity yet.
                    </td>
                  </tr>
                ) : (
                  pagedAnalyticsItems.map((item) => (
                    <tr
                      key={item.lead_id}
                      onClick={() => { handleSelectLead(item.lead_id); setWorkspaceSection('leads'); }}
                      className="results-table__row--clickable"
                    >
                      <td>
                        <div className="results-table__primary">{item.name}</div>
                        <div className="results-table__secondary">{item.headline || item.role}</div>
                      </td>
                      <td>
                        <span className="segment-type-badge">{individualShortLabel(item.avatar_type)}</span>
                      </td>
                      <td className="results-table__num">{item.link_clicked || 0}</td>
                      <td className="results-table__num">{item.form_started || 0}</td>
                      <td className="results-table__num">{item.form_submitted || 0}</td>
                      <td className="results-table__num">{item.meeting_booked || 0}</td>
                      <td className="results-table__muted">
                        {item.latest_event_at
                          ? new Date(item.latest_event_at).toLocaleDateString()
                          : 'N/A'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </DotScrollArea>
          {aggregateItems.length > 0 && (
            <div className="business-table-pagination" role="navigation" aria-label="Analytics table pagination">
              <span className="business-table-pagination__meta">
                Showing {analyticsPageStart}-{analyticsPageEnd} of {aggregateItems.length}
              </span>
              <div className="business-table-pagination__controls">
                <button
                  type="button"
                  className="business-table-pagination__btn"
                  disabled={safeAnalyticsPage <= 1}
                  onClick={() => setAnalyticsPage((page) => Math.max(1, page - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={14} />
                  Previous
                </button>
                <span className="business-table-pagination__page">
                  Page {safeAnalyticsPage} of {analyticsPageCount}
                </span>
                <button
                  type="button"
                  className="business-table-pagination__btn"
                  disabled={safeAnalyticsPage >= analyticsPageCount}
                  onClick={() => setAnalyticsPage((page) => Math.min(analyticsPageCount, page + 1))}
                  aria-label="Next page"
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="workspace-page workspace-page--recruitment">
      {toast && (
        <div className={`workspace-toast workspace-toast--${toast.type}`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{toast.message}</span>
        </div>
      )}

      {confirmMarkSentOpen && (
        <div
          className="compose-confirm-backdrop"
          role="presentation"
          onClick={() => {
            if (!markingSent) setConfirmMarkSentOpen(false);
          }}
        >
          <div
            className="compose-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="compose-confirm-title"
            aria-describedby="compose-confirm-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="compose-confirm-title">Did you send this outreach?</h3>
            <p id="compose-confirm-desc">
              Only continue if you&apos;ve already delivered this draft to the lead.
              Then mark it as sent.
            </p>
            <div className="compose-confirm-modal__actions">
              <button
                type="button"
                className="chip-fallback-btn"
                disabled={markingSent}
                onClick={() => setConfirmMarkSentOpen(false)}
              >
                Not yet
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={markingSent}
                onClick={handleMarkAsSent}
              >
                {markingSent ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} />
                    Yes, mark as sent
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="individual-page-header">
        <nav className="individual-workspace-nav" aria-label="Individual outreach workflow">
          {workspaceSections.map((section) => {
            const SectionIcon = section.icon;
            const isActive = workspaceSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                className={`individual-workspace-nav__tab${isActive ? ' individual-workspace-nav__tab--active' : ''}`}
                onClick={() => setWorkspaceSection(section.id)}
              >
                <SectionIcon size={16} />
                <span>{section.label}</span>
              </button>
            );
          })}
        </nav>
      </header>

      {workspaceSection === 'source' && (
        <div className="individual-section individual-section--source">
          <IndividualSearchPanel
            activeSegment={leadSegment}
            onComplete={(run) => {
              const keys = new Set(
                (run?.leads || []).map(leadIdentityKey).filter(Boolean),
              );
              setSearchRun({ query: run?.query || '', keys, count: keys.size });
              // Land on the results of the run just finished, not the whole list.
              setOnlyThisSearch(keys.size > 0);
              setTextSearch('');
              setStatusFilter('all');
              if (run?.role) {
                const role = rememberRoleOption(run.role);
                setRoleFilter(role || 'all');
              } else {
                setRoleFilter('all');
              }
              if (run?.location) {
                const location = rememberLocationOption(run.location);
                setLocationFilter(location || 'all');
              } else {
                setLocationFilter('all');
              }
              setListFiltersOpen(true);
              setListPage(1);
              invalidateApiCache([API_CACHE_KEYS.avatar12Leads, API_CACHE_KEYS.funnel]);
              fetchLeads({ force: true });
              fetchFunnelData({ force: true });
              setWorkspaceSection('leads');
            }}
          />
        </div>
      )}

      {workspaceSection === 'leads' && (
      <div className={`workspace-split${selectedLeadId ? ' workspace-split--detail-open' : ''}`}>
      <div className="workspace-list-pane">
        
        {/* List header: search + collapsible filters */}
        <div className="individual-list-header">
          <div className="individual-list-header__top">
            <h3 className="individual-list-header__title">Outreach</h3>
            <span className="individual-list-header__count">{filteredLeads.length} · {activeSegmentMeta.shortLabel}</span>
          </div>

          {/* Compact filter: list is scoped to the latest search until cleared. */}
          {searchRun && (
            <div
              className={`search-run-filter${onlyThisSearch ? ' search-run-filter--active' : ''}`}
              role="status"
              aria-live="polite"
            >
              {searchRun.count === 0 ? (
                <p className="search-run-filter__empty">
                  No matches from your latest search for <strong>{searchRun.query}</strong>
                </p>
              ) : (
                <>
                  <div className="search-run-filter__copy">
                    <span className="search-run-filter__eyebrow">
                      {onlyThisSearch ? 'Results from your latest search' : 'Latest search'}
                    </span>
                    <button
                      type="button"
                      className={`search-run-filter__chip${onlyThisSearch ? ' is-on' : ''}`}
                      onClick={() => setOnlyThisSearch((prev) => !prev)}
                      aria-pressed={onlyThisSearch}
                      title={onlyThisSearch ? 'Show all drafts' : 'Show only this search'}
                    >
                      <span className="search-run-filter__chip-query">{searchRun.query}</span>
                      <span className="search-run-filter__chip-count">
                        {searchRun.count} lead{searchRun.count === 1 ? '' : 's'}
                      </span>
                    </button>
                  </div>
                </>
              )}

              <div className="search-run-filter__actions">
                {searchRun.count > 0 && onlyThisSearch && (
                  <button
                    type="button"
                    className="search-run-filter__toggle"
                    onClick={() => setOnlyThisSearch(false)}
                  >
                    Show all
                  </button>
                )}
                {searchRun.count > 0 && !onlyThisSearch && (
                  <button
                    type="button"
                    className="search-run-filter__toggle"
                    onClick={() => setOnlyThisSearch(true)}
                  >
                    This search only
                  </button>
                )}
                <button
                  type="button"
                  className="search-run-filter__dismiss"
                  onClick={() => { setSearchRun(null); setOnlyThisSearch(false); }}
                  aria-label="Dismiss search filter"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          <div className="individual-list-toolbar">
            <div className="individual-list-toolbar__search">
              <Search size={16} className="individual-list-toolbar__search-icon" aria-hidden="true" />
              <input 
                type="text" 
                placeholder="Search name or role…" 
                value={textSearch}
                onChange={handleSearchChange}
                className="individual-list-search"
              />
              {textSearch && (
                <button 
                  type="button"
                  onClick={() => {
                    setTextSearch('');
                    const params = new URLSearchParams(searchParams.toString());
                    params.delete('q');
                    router.push(`?${params.toString()}`);
                  }}
                  className="individual-list-search__clear"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="individual-list-toolbar__actions">
              <button
                type="button"
                className={`individual-list-icon-btn${listFiltersOpen ? ' individual-list-icon-btn--active' : ''}`}
                onClick={() => setListFiltersOpen((open) => !open)}
                aria-expanded={listFiltersOpen}
                aria-label={`Filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ''}`}
              >
                <Filter size={16} />
                {activeFilterCount > 0 && (
                  <span className="individual-list-filters-toggle__badge">{activeFilterCount}</span>
                )}
              </button>

              <div className="individual-list-sort-wrap">
                <select
                  className="individual-list-sort"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  aria-label={`Sort drafts: ${SORT_OPTIONS.find((option) => option.value === sortBy)?.label || 'Newest first'}`}
                  title={SORT_OPTIONS.find((option) => option.value === sortBy)?.label || 'Newest first'}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <ArrowUpDown size={16} className="individual-list-sort-wrap__icon" aria-hidden="true" />
              </div>
            </div>
          </div>

          {listFiltersOpen && (
          <div className="individual-list-filters-panel">
            <div className="individual-list-filters-grid">
              <label className="individual-list-filter-field">
                <span>Outreach</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Filter by outreach status"
                >
                  <option value="all">All outreach</option>
                  <option value="draft">Not sent</option>
                  <option value="sent">Sent</option>
                </select>
              </label>

              <SearchableFilterSelect
                label="Role"
                value={roleFilter}
                options={roleOptions}
                recentOptions={recentRoles}
                allLabel="All roles"
                searchPlaceholder="Type a role…"
                emptyLabel="No roles match that search"
                onChange={(next) => {
                  setRoleFilter(next);
                  if (next !== 'all') rememberRoleOption(next);
                }}
              />

              <SearchableFilterSelect
                label="Location"
                value={locationFilter}
                options={locationOptions}
                recentOptions={recentLocations}
                allLabel="All locations"
                searchPlaceholder="Type a city or region…"
                emptyLabel="No locations match that search"
                onChange={(next) => {
                  setLocationFilter(next);
                  if (next !== 'all') rememberLocationOption(next);
                }}
              />
            </div>

            {(roleOptions.length === 0 && locationOptions.length === 0) && (
              <p className="individual-list-filters-hint">
                Role and location options appear from the role and location you type when you run a search.
              </p>
            )}

            {(textSearch || statusFilter !== 'all' || roleFilter !== 'all' || locationFilter !== 'all' || sortBy !== 'newest') && (
              <div className="individual-list-filters-footer">
                <span>Filtered: {filteredLeads.length} of {leads.filter((l) => l.avatar_type === leadSegment).length} drafts</span>
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="individual-list-filters-reset"
                >
                  <RotateCcw size={12} />
                  Reset Filters
                </button>
              </div>
            )}
          </div>
          )}
        </div>

        {/* Scrollable list content */}
        <DotScrollArea className="workspace-list-pane__scroll">
          {loading && leads.length === 0 ? (
            /* Skeleton list loader */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[1, 2, 3, 4, 5].map((idx) => (
                <div key={idx} className="glass-card" style={{ padding: '16px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span className="skeleton-shimmer skeleton-text" style={{ width: '120px', height: '16px' }}></span>
                    <span className="skeleton-shimmer skeleton-text" style={{ width: '60px', height: '14px' }}></span>
                  </div>
                  <div className="skeleton-shimmer skeleton-text" style={{ width: '180px', height: '12px', marginBottom: '6px' }}></div>
                  <div className="skeleton-shimmer skeleton-text" style={{ width: '100px', height: '12px' }}></div>
                </div>
              ))}
            </div>
          ) : error ? (
            /* Error state with retry */
            <div style={{ textAlign: 'center', padding: '32px 16px', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
              <AlertTriangle size={32} style={{ color: COLORS.error }} />
              <div>
                <h5 style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '4px' }}>Failed to load drafts</h5>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Verify FastAPI backend server on port 8000 is active.</p>
              </div>
              <button onClick={() => fetchLeads({ force: true })} className="chip-fallback-btn" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <RotateCcw size={12} />
                Retry Fetch
              </button>
            </div>
          ) : filteredLeads.length === 0 ? (
            /* Empty for this segment (or active filters) */
            <div style={{ textAlign: 'center', padding: '40px 16px', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
              <Briefcase size={40} style={{ color: 'var(--text-muted)' }} />
              <div>
                <h5 style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '6px' }}>
                  {leads.length === 0 || !leads.some((l) => l.avatar_type === leadSegment)
                    ? `No ${activeSegmentMeta.label.toLowerCase()} drafts yet`
                    : 'No drafts match your search or filters.'}
                </h5>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: '1.4', maxWidth: '280px' }}>
                  {leads.length === 0 || !leads.some((l) => l.avatar_type === leadSegment)
                    ? `Head to Find New Leads to search for ${activeSegmentMeta.label.toLowerCase()}. New matches will appear here as drafts ready to review and send.`
                    : 'Try clearing search or filters.'}
                </p>
              </div>
              {(leads.length === 0 || !leads.some((l) => l.avatar_type === leadSegment)) && (
                <button type="button" onClick={() => setWorkspaceSection('source')} className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.75rem' }}>
                  Find new leads
                </button>
              )}
            </div>
          ) : (
            /* Leads list */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {pagedLeads.map((lead) => {
                const isActive = lead.id === selectedLeadId;
                const draftStatus = lead.latest_draft?.status || 'draft';
                const fromThisSearch = isFromSearchRun(lead);
                const companyMissing = isCompanyOrExperienceMissing(lead);
                const locationMissing = isMissingField(resolveLeadLocation(lead));
                const subtitle = stripEmDashes(lead.headline || lead.role || '').trim();

                return (
                  <div
                    key={lead.id}
                    onClick={() => handleSelectLead(lead.id)}
                    className={[
                      'outreach-lead-card',
                      isActive ? 'is-active' : '',
                      fromThisSearch && !onlyThisSearch ? 'is-from-search' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <div className="outreach-lead-card__top">
                      <span className="outreach-lead-card__name">{lead.name}</span>
                      <div className="outreach-lead-card__top-actions">
                        <span className={`outreach-lead-card__status outreach-lead-card__status--${draftStatus}`}>
                          {draftStatusLabel(draftStatus)}
                        </span>
                      </div>
                    </div>

                    {subtitle ? (
                      <div className="outreach-lead-card__subtitle">{subtitle}</div>
                    ) : null}

                    <div className="outreach-lead-card__meta">
                      <span className={companyMissing ? 'is-missing' : ''}>
                        <Building2 size={10} aria-hidden="true" />
                        {displayCompanyOrExperience(lead)}
                      </span>
                      <span className={locationMissing ? 'is-missing' : ''}>
                        <MapPin size={10} aria-hidden="true" />
                        {displayField(resolveLeadLocation(lead), 'location')}
                      </span>
                      {(lead.contact_email || '').trim() ? (
                        <span className="outreach-lead-card__email" title={lead.contact_email}>
                          <Mail size={10} aria-hidden="true" />
                          {lead.contact_email.trim()}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DotScrollArea>
        {filteredLeads.length > 0 && (
          <div className="business-table-pagination" role="navigation" aria-label="Drafts list pagination">
            <span className="business-table-pagination__meta">
              Showing {listPageStart}-{listPageEnd} of {filteredLeads.length}
            </span>
            <div className="business-table-pagination__controls">
              <button
                type="button"
                className="business-table-pagination__btn"
                disabled={safeListPage <= 1}
                onClick={() => setListPage((page) => Math.max(1, page - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft size={14} />
                Previous
              </button>
              <span className="business-table-pagination__page">
                Page {safeListPage} of {listPageCount}
              </span>
              <button
                type="button"
                className="business-table-pagination__btn"
                disabled={safeListPage >= listPageCount}
                onClick={() => setListPage((page) => Math.min(listPageCount, page + 1))}
                aria-label="Next page"
              >
                Next
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right Pane: Selected Details or Aggregate Funnel Analytics Dashboard */}
      <div className="workspace-detail-pane">
        {selectedLeadId ? (
          /* LEAD SPECIFIC VIEW */
          rightLoading ? (
            <div className="individual-lead-detail individual-lead-detail--state">
              <Loader2 className="animate-spin" size={22} style={{ color: 'var(--text-muted)' }} />
              <p>Loading lead details…</p>
            </div>
          ) : rightError ? (
            <div className="individual-lead-detail individual-lead-detail--state">
              <AlertTriangle size={22} style={{ color: COLORS.error }} />
              <h4>Failed to load details</h4>
              <button 
                onClick={() => {
                  const lid = selectedLeadId;
                  handleSelectLead('');
                  setTimeout(() => handleSelectLead(lid), 50);
                }} 
                className="chip-fallback-btn"
              >
                Retry
              </button>
            </div>
          ) : selectedLeadDetails ? (
            <div className="individual-lead-detail">
              <header className="individual-lead-detail__header">
                <div className="individual-lead-detail__header-main">
                  <div className="individual-lead-detail__meta">
                    <span className="individual-lead-detail__type-badge">
                      {individualShortLabel(selectedLeadDetails.avatar_type)}
                    </span>
                    <span className={`individual-lead-detail__status individual-lead-detail__status--${(selectedLeadDetails.drafts?.[selectedLeadDetails.drafts.length - 1]?.status || 'draft')}`}>
                      {draftStatusLabel(selectedLeadDetails.drafts?.[selectedLeadDetails.drafts.length - 1]?.status || 'draft')}
                    </span>
                  </div>
                  <h3 className="individual-lead-detail__name">{selectedLeadDetails.name}</h3>
                  {(selectedLeadDetails.source_query || selectedLeadDetails.search_prompt) && (
                    <p className="individual-lead-detail__found">
                      Found via query &ldquo;{selectedLeadDetails.source_query || selectedLeadDetails.search_prompt}&rdquo;
                    </p>
                  )}
                </div>
                <div className="individual-lead-detail__header-actions">
                  <button type="button" onClick={() => handleSelectLead('')} className="individual-lead-detail__close" aria-label="Close">
                    <X size={16} />
                  </button>
                </div>
              </header>

              <nav className="individual-lead-tabs" aria-label="Lead detail sections">
                {visibleLeadDetailTabs.map((tab) => {
                  const TabIcon = tab.icon;
                  const isTabActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className={`individual-lead-tabs__tab${isTabActive ? ' individual-lead-tabs__tab--active' : ''}`}
                      onClick={() => {
                        if (tab.id !== 'compose' && editingDraft) {
                          cancelEditingDraft();
                        }
                        if (tab.id !== 'profile' && editingLead) {
                          cancelEditingLead();
                        }
                        setActiveTab(tab.id);
                      }}
                    >
                      <TabIcon size={14} />
                      {tab.label}
                    </button>
                  );
                })}
              </nav>

              <DotScrollArea className="individual-lead-detail__body">
              {activeTab === 'profile' && (
                <div className="individual-lead-profile">
                  {editingLead && editForm ? (
                    <form
                      className="lead-edit-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveLeadEdits();
                      }}
                    >
                      <div className="lead-edit-form__intro">
                        <p className="lead-edit-form__hint">
                          Check the LinkedIn profile, then correct any fields that look wrong.
                        </p>
                        {(editForm.linkedin_url || selectedLeadDetails.linkedin_url) && (
                          <a
                            href={editForm.linkedin_url || selectedLeadDetails.linkedin_url}
                            target="_blank"
                            rel="noreferrer"
                            className="lead-edit-form__linkedin"
                          >
                            <ExternalLink size={14} />
                            Open LinkedIn profile
                          </a>
                        )}
                      </div>

                      <div className="lead-edit-form__fields">
                        {[
                          { key: 'name', label: 'Name', required: true },
                          { key: 'role', label: 'Role' },
                          { key: 'headline', label: 'Headline', wide: true },
                          { key: 'company', label: 'Company' },
                          { key: 'location', label: 'Location' },
                          { key: 'linkedin_url', label: 'LinkedIn URL', wide: true },
                          { key: 'contact_email', label: 'Email', type: 'email', wide: true },
                        ].map((field) => (
                          <label
                            key={field.key}
                            className={`lead-edit-form__field${field.wide ? ' lead-edit-form__field--wide' : ''}`}
                          >
                            <span className="lead-edit-form__label">{field.label}</span>
                            <input
                              type={field.type || 'text'}
                              value={editForm[field.key] ?? ''}
                              required={field.required}
                              placeholder={
                                field.key === 'company' || field.key === 'location'
                                  ? 'Add if you have it'
                                  : field.key === 'contact_email'
                                    ? 'name@company.com'
                                    : undefined
                              }
                              onChange={(e) =>
                                setEditForm((prev) => ({ ...prev, [field.key]: e.target.value }))
                              }
                            />
                          </label>
                        ))}
                      </div>

                      <div className="lead-edit-form__actions">
                        <button type="button" className="lead-edit-form__cancel" onClick={cancelEditingLead} disabled={savingLead}>
                          Cancel
                        </button>
                        <button type="submit" className="btn-primary lead-edit-form__save" disabled={savingLead}>
                          {savingLead ? 'Saving…' : 'Save changes'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <section className="individual-lead-profile__section" aria-label="Profile">
                        <dl className="individual-lead-profile__facts">
                          <div className="individual-lead-profile__fact">
                            <dt>Role</dt>
                            <dd className={isMissingField(selectedLeadDetails.role || selectedLeadDetails.headline) ? 'is-missing' : undefined}>
                              {stripEmDashes(
                                selectedLeadDetails.role
                                || selectedLeadDetails.headline
                              ) || 'Add role'}
                            </dd>
                          </div>
                          <div className="individual-lead-profile__fact">
                            <dt>Company</dt>
                            <dd className={isCompanyOrExperienceMissing(selectedLeadDetails) ? 'is-missing' : undefined}>
                              {displayCompanyOrExperience(selectedLeadDetails)}
                            </dd>
                          </div>
                          {selectedLeadDetails.school && (
                            <div className="individual-lead-profile__fact">
                              <dt>School</dt>
                              <dd>{stripEmDashes(selectedLeadDetails.school)}</dd>
                            </div>
                          )}
                          <div className="individual-lead-profile__fact">
                            <dt>Location</dt>
                            <dd className={isMissingField(resolveLeadLocation(selectedLeadDetails)) ? 'is-missing' : undefined}>
                              {displayField(resolveLeadLocation(selectedLeadDetails), 'location')}
                            </dd>
                          </div>
                          <div className="individual-lead-profile__fact">
                            <dt>Email</dt>
                            <dd className={!(selectedLeadDetails.contact_email || '').trim() ? 'is-missing' : undefined}>
                              {(selectedLeadDetails.contact_email || '').trim() ? (
                                <a
                                  href={`mailto:${selectedLeadDetails.contact_email.trim()}`}
                                  className="individual-lead-profile__link"
                                >
                                  {selectedLeadDetails.contact_email.trim()}
                                </a>
                              ) : (
                                'Not found yet'
                              )}
                            </dd>
                          </div>
                          <div className="individual-lead-profile__fact individual-lead-profile__fact--wide">
                            <dt>LinkedIn</dt>
                            <dd>
                              {selectedLeadDetails.linkedin_url ? (
                                <a
                                  href={selectedLeadDetails.linkedin_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="individual-lead-profile__link"
                                >
                                  View profile
                                  <ArrowUpRight size={12} aria-hidden="true" />
                                </a>
                              ) : (
                                <span className="is-missing">Add LinkedIn</span>
                              )}
                            </dd>
                          </div>
                        </dl>

                        <div className="individual-lead-profile__actions">
                          <button
                            type="button"
                            className="individual-lead-detail__edit"
                            onClick={() => startEditingLead(selectedLeadDetails)}
                          >
                            <Pencil size={14} />
                            Edit details
                          </button>
                        </div>
                      </section>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'compose' && (
                <div className="individual-compose-panel">
                  <div className="individual-compose-editor">
                    {noDraftExists && (
                      <div className="individual-compose-editor__banner">
                        <span className="individual-compose-editor__badge">
                          No message yet
                        </span>
                      </div>
                    )}

                    <div className="individual-compose-editor__top">
                      <p className="individual-compose-editor__hint">
                        Ask them to book a meeting. The link in the draft is their meeting booking page.
                      </p>
                      {(selectedLeadDetails.drafts?.[selectedLeadDetails.drafts.length - 1]?.status || 'draft') !== 'sent' && (
                        <div className="individual-compose-editor__actions">
                          {editingDraft ? (
                            <>
                              <button
                                type="button"
                                className="individual-compose-editor__edit-btn individual-compose-editor__edit-btn--ghost"
                                onClick={cancelEditingDraft}
                                disabled={savingDraft}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="individual-compose-editor__edit-btn"
                                onClick={finishEditingDraft}
                                disabled={savingDraft}
                              >
                                {savingDraft ? 'Saving…' : 'Save message'}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="individual-compose-editor__edit-btn"
                              onClick={startEditingDraft}
                            >
                              <Pencil size={14} />
                              Edit message
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <DotScrollArea
                      className="individual-compose-editor__scroll"
                      trackNestedScroll
                    >
                      <textarea
                        ref={draftTextareaRef}
                        className={`individual-compose-editor__textarea${editingDraft ? ' is-editing' : ''}`}
                        value={draftMessage}
                        readOnly={!editingDraft}
                        onChange={(e) => setDraftMessage(e.target.value)}
                        placeholder="Write a short note inviting them to book a meeting. Keep the booking link on its own line."
                        aria-label="Outreach draft"
                      />
                    </DotScrollArea>

                    <div className="individual-compose-footer" style={{ flexWrap: 'wrap', gap: '12px' }}>
                      <span className="individual-compose-footer__count">
                        {draftMessage.length} characters
                      </span>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                        {(selectedLeadDetails.drafts?.[selectedLeadDetails.drafts.length - 1]?.status || 'draft') !== 'sent' && (
                          <button
                            type="button"
                            className="chip-fallback-btn"
                            onClick={handleCopyDraft}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                          >
                            {draftCopied ? <Check size={14} /> : <Copy size={14} />}
                            {draftCopied ? 'Copied' : 'Copy message'}
                          </button>
                        )}
                        {(selectedLeadDetails.drafts?.[selectedLeadDetails.drafts.length - 1]?.status || 'draft') === 'sent' ? (
                          <span className="individual-compose-footer__sent">
                            <CheckCircle2 size={16} />
                            Marked as sent
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn-primary individual-compose-footer__send"
                            onClick={requestMarkAsSent}
                            disabled={markingSent}
                          >
                            <CheckCircle2 size={14} />
                            Mark as sent
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Lead profile insight from sourcing */}
                  {draftReasoning && (
                    <section className="individual-lead-profile__section individual-compose-insight" aria-label="Lead insight">
                      <div className="individual-lead-profile__section-head">
                        <div>
                          <h4 className="individual-lead-profile__section-label">
                            <Sparkles size={13} aria-hidden="true" />
                            What we learned
                          </h4>
                        </div>
                      </div>
                      <p className="individual-compose-insight__body">
                        {formatLeadInsight(draftReasoning)}
                      </p>
                    </section>
                  )}
                </div>
              )}

              {/* Sent review after compose */}
              {activeTab === 'history' && isLatestDraftSent && (
                <section className="individual-lead-profile__section individual-funnel-section" aria-label="Sent review">
                  <div className="individual-lead-profile__section-head">
                    <div>
                      <h4 className="individual-lead-profile__section-label">
                        <Clock size={13} aria-hidden="true" />
                        Sent review
                      </h4>
                      <p className="individual-lead-profile__section-hint">
                        Outreach marked as sent for this lead.
                      </p>
                    </div>
                  </div>

                  {(!selectedLeadDetails.drafts || selectedLeadDetails.drafts.length === 0) ? (
                    <p className="individual-funnel-section__empty">
                      No sent outreach recorded for this prospect.
                    </p>
                  ) : (
                    <div className="individual-sent-timeline">
                      {selectedLeadDetails.drafts.slice().reverse().map((draft, idx) => (
                        <div key={draft.id || idx} className="individual-sent-timeline__item">
                          <span
                            className={`individual-sent-timeline__dot${
                              draft.status === 'sent'
                                ? ' individual-sent-timeline__dot--sent'
                                : ' individual-sent-timeline__dot--draft'
                            }`}
                            aria-hidden="true"
                          />
                          <div className="individual-sent-timeline__content">
                            <div className="individual-sent-timeline__meta">
                              <span className={`individual-sent-timeline__status${
                                draft.status === 'sent'
                                  ? ' individual-sent-timeline__status--sent'
                                  : ' individual-sent-timeline__status--draft'
                              }`}>
                                {draftStatusLabel(draft.status)}
                              </span>
                              <span className="individual-sent-timeline__time">
                                {draft.status === 'sent'
                                  ? (draft.sent_at
                                    ? new Date(draft.sent_at).toLocaleString()
                                    : 'Sent time not recorded')
                                  : (draft.created_at
                                    ? new Date(draft.created_at).toLocaleString()
                                    : 'Recent')}
                              </span>
                            </div>
                            <div className="individual-sent-timeline__message">
                              {stripEmDashes(draft.message)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* 3. FUNNEL TAB */}
              {activeTab === 'funnel' && (
                <section className="individual-lead-profile__section individual-funnel-section" aria-label="Intake funnel">
                  <div className="individual-lead-profile__section-head">
                    <div>
                      <h4 className="individual-lead-profile__section-label">
                        <Activity size={13} aria-hidden="true" />
                        Intake funnel
                      </h4>
                      <p className="individual-lead-profile__section-hint">
                        Live progress from this lead&apos;s tracked intake link: clicks, form activity, and meeting bookings.
                      </p>
                    </div>
                  </div>

                  <ol className="individual-funnel-steps">
                    {buildIndividualFunnelSteps(selectedLeadDetails).map((step, index, steps) => (
                      <li
                        key={step.id}
                        className={`individual-funnel-steps__item${step.completed ? ' is-complete' : ''}`}
                      >
                        <div className="individual-funnel-steps__rail" aria-hidden="true">
                          <span className="individual-funnel-steps__dot">
                            {step.completed ? '✓' : index + 1}
                          </span>
                          {index < steps.length - 1 && (
                            <span className={`individual-funnel-steps__line${step.completed && steps[index + 1].completed ? ' is-complete' : ''}`} />
                          )}
                        </div>
                        <div className="individual-funnel-steps__copy">
                          <h5>{step.label}</h5>
                          <p>{step.desc}</p>
                          {step.completed && formatFunnelTimestamp(step.at) && (
                            <p className="individual-funnel-steps__time">
                              Last performed at: {formatFunnelTimestamp(step.at)}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              </DotScrollArea>
            </div>
          ) : null
        ) : (
          <div className="individual-pipeline-empty">
            <FileText size={40} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
            <h4>Select a draft to work on</h4>
            <p>Pick someone from the queue to review their profile, finish the message, or send outreach.</p>
            <button type="button" className="btn-primary individual-pipeline-empty__cta" onClick={() => setWorkspaceSection('source')}>
              <Search size={14} />
              Find new leads
            </button>
          </div>
        )}
      </div>

      </div>
      )}

      {workspaceSection === 'analytics' && (
        <div className="individual-section individual-section--analytics">
          {renderAnalyticsPanel()}
        </div>
      )}

    </div>
  );
}

export default function RecruitmentPage() {
  return (
    <Suspense fallback={
      <div className="glass-card" style={{ padding: '40px', textAlign: 'center', background: COLORS.white }}>
        <Loader2 className="animate-spin" size={24} style={{ color: COLORS.oldRose, margin: '0 auto 12px' }} />
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading Workspace...</span>
      </div>
    }>
      <RecruitmentWorkspaceContent />
    </Suspense>
  );
}
