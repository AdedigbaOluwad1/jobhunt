import { collapseWhitespace, decodeHtmlEntities, stripHtml } from '../common/text';
import { toDate } from '../sources/adapter-helpers';

export interface ParsedJobPage {
  title?: string;
  company?: string;
  location?: string;
  remote?: boolean;
  employmentType?: string;
  postedAt?: Date;
  descriptionHtml?: string;
  descriptionText?: string;
}

const JSON_LD_PATTERN = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const TRACKING_PARAM_PATTERN = /^(utm_|fbclid$|gclid$|ref$|refid$|trk|source$|mc_)/i;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (isObject(value) && typeof value.name === 'string') return value.name.trim() || undefined;
  return undefined;
}

function* jsonLdNodes(html: string): Generator<Json> {
  for (const match of html.matchAll(JSON_LD_PATTERN)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }
    for (const node of asArray(parsed)) {
      if (!isObject(node)) continue;
      yield node;
      for (const inner of asArray(node['@graph'])) if (isObject(inner)) yield inner;
    }
  }
}

function isJobPosting(node: Json): boolean {
  return asArray(node['@type']).includes('JobPosting');
}

function formatLocation(jobLocation: unknown): string | undefined {
  const places = asArray(jobLocation)
    .map((place) => {
      if (!isObject(place)) return asString(place);
      const address = place.address;
      if (!isObject(address)) return asString(address);
      return [address.addressLocality, address.addressRegion, address.addressCountry]
        .map(asString)
        .filter(Boolean)
        .join(', ');
    })
    .filter(Boolean);
  return places.length > 0 ? places.join(' / ') : undefined;
}

function fromJsonLd(node: Json): ParsedJobPage {
  const description = asString(node.description);
  return {
    title: asString(node.title),
    company: asString(node.hiringOrganization),
    location: formatLocation(node.jobLocation),
    remote: node.jobLocationType === 'TELECOMMUTE' ? true : undefined,
    employmentType: asArray(node.employmentType).map(asString).filter(Boolean).join(', ') || undefined,
    postedAt: toDate(asString(node.datePosted)),
    descriptionHtml: description,
  };
}

function metaContent(html: string, name: string): string | undefined {
  const tag = html.match(
    new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i'),
  )?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? collapseWhitespace(decodeHtmlEntities(content)) : undefined;
}

function pageText(html: string): string {
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html;
  const cleaned = main.replace(/<(script|style|nav|header|footer|aside|noscript|svg)[\s\S]*?<\/\1>/gi, '');
  return collapseWhitespace(stripHtml(cleaned));
}

export function parseJobPage(html: string): ParsedJobPage {
  for (const node of jsonLdNodes(html)) {
    if (isJobPosting(node)) {
      const parsed = fromJsonLd(node);
      if (parsed.descriptionHtml) return parsed;
    }
  }

  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  return {
    title: metaContent(html, 'og:title') ?? (heading ? collapseWhitespace(stripHtml(heading)) : undefined),
    company: metaContent(html, 'og:site_name'),
    descriptionText: pageText(html),
  };
}

export function canonicalizeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`"${raw}" is not an http(s) URL`);
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM_PATTERN.test(key)) url.searchParams.delete(key);
  }
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}
