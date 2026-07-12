import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 8000;

export function extractCandidateContactLinks(html, baseUrl) {
  const links = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html))) {
    const href = match[1]?.trim();
    const text = stripHtml(match[2] ?? '');
    if (!href) continue;
    const haystack = `${href} ${text}`.toLowerCase();
    if (haystack.includes('contact') || haystack.includes('about')) {
      try {
        links.push(new URL(href, baseUrl).toString());
      } catch {
        continue;
      }
    }
  }

  return [...new Set(links)].slice(0, 2);
}

export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSignals(text) {
  const emails = [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((value) => value.trim()))];
  const linkedinUrls = [...new Set((text.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/gi) ?? []).map((value) => value.trim()))];
  return { emails, linkedinUrls };
}

async function fetchHtml(url, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; LeadGenBot/1.0)',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok) {
      return { ok: false, status: response.status, html: '', contentType };
    }
    if (!contentType.includes('text/html')) {
      return { ok: false, status: 415, html: '', contentType };
    }
    return {
      ok: true,
      status: response.status,
      html: await response.text(),
      contentType,
    };
  } catch (error) {
    return { ok: false, status: error.name === 'AbortError' ? 408 : 500, html: '', contentType: '' };
  } finally {
    clearTimeout(timeout);
  }
}

async function callClaudeViaPython({ systemPrompt, userPrompt, responseSchema }) {
  const script = `
import os
import json
from app.services.llm.client import generate_structured, LLMResponseError

payload = json.loads(os.environ["AVATAR3_PAYLOAD"])
try:
    result = generate_structured(
        system_prompt=payload["systemPrompt"],
        user_prompt=payload["userPrompt"],
        response_schema=payload["responseSchema"],
    )
    print(json.dumps({"ok": True, "result": result}))
except Exception as exc:
    print(json.dumps({"ok": False, "error": exc.__class__.__name__, "message": str(exc)}))
`;

  const pythonBin = existsSync(join(process.cwd(), 'venv', 'bin', 'python'))
    ? join(process.cwd(), 'venv', 'bin', 'python')
    : 'python';

  const { stdout } = await execFileAsync(pythonBin, ['-c', script], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      AVATAR3_PAYLOAD: JSON.stringify({ systemPrompt, userPrompt, responseSchema }),
      PYTHONPATH: `${process.cwd()}${process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ''}`,
    },
  });
  return JSON.parse(stdout.trim() || '{}');
}

export async function enrichBusinessWebsite({
  website,
  businessName,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  generateStructured = callClaudeViaPython,
} = {}) {
  const nullResult = {
    owner_name: null,
    manager_name: null,
    contact_email: null,
    contact_linkedin: null,
  };

  const homepage = String(website ?? '').trim();
  if (!homepage) return { ...nullResult, source_text: '' };

  const homeResult = await fetchHtml(homepage, fetchImpl, timeoutMs);
  if (!homeResult.ok) return { ...nullResult, source_text: '' };

  const aboutLinks = extractCandidateContactLinks(homeResult.html, homepage);
  const pages = [
    { url: homepage, html: homeResult.html },
  ];

  for (const link of aboutLinks) {
    if (pages.length >= 2) break;
    if (link !== homepage) {
      const page = await fetchHtml(link, fetchImpl, timeoutMs);
      if (page.ok) pages.push({ url: link, html: page.html });
    }
  }

  const sourceText = pages
    .map(({ url, html }) => {
      const text = stripHtml(html);
      return `URL: ${url}\n${text}`;
    })
    .join('\n\n');

  const signals = extractSignals(sourceText);

  const responseSchema = {
    owner_name: ['string', 'null'],
    manager_name: ['string', 'null'],
    contact_email: ['string', 'null'],
    contact_linkedin: ['string', 'null'],
  };

  const systemPrompt =
    'You extract contact details from business website text. Return only valid JSON. ' +
    'Use null for any field you cannot confirm from the provided source text. Never fabricate.';

  const userPrompt =
    `Business name: ${businessName ?? ''}\n` +
    `Detected emails: ${signals.emails.join(', ') || 'none'}\n` +
    `Detected LinkedIn URLs: ${signals.linkedinUrls.join(', ') || 'none'}\n` +
    `Website text:\n${sourceText}\n\n` +
    'Extract owner_name, manager_name, contact_email, contact_linkedin. If unknown, use null.';

  try {
    const result = await generateStructured({ systemPrompt, userPrompt, responseSchema });
    if (result?.ok === false) {
      return { ...nullResult, source_text: sourceText };
    }
    return {
      owner_name: result?.result?.owner_name ?? null,
      manager_name: result?.result?.manager_name ?? null,
      contact_email: result?.result?.contact_email ?? null,
      contact_linkedin: result?.result?.contact_linkedin ?? null,
      source_text: sourceText,
    };
  } catch {
    return { ...nullResult, source_text: sourceText };
  }
}
