export type ResolvedUgandaPlace = {
  name: string;
  canonicalText: string;
  districtName: string | null;
  regionName: string | null;
  latitude: number;
  longitude: number;
  sourceUrl: string;
};

type NominatimResult = {
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  osm_id?: number;
  osm_type?: "node" | "way" | "relation";
  address?: Record<string, string | undefined>;
};

const placeCache = new Map<string, { expiresAt: number; value: ResolvedUgandaPlace | null }>();
const cacheLifetimeMs = 24 * 60 * 60 * 1000;
const negativeCacheLifetimeMs = 5 * 60 * 1000;
let nextLookupAt = 0;
let lookupQueue = Promise.resolve();

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanCandidate(value: string) {
  return value
    .replace(/^\s*(?:it(?:'s| is)?|the place is|this happened|that is|i am in|i'm in)\s+/i, "")
    .replace(/\s+(?:is the place|in uganda)\s*[.!?]*$/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();
}

export function locationCandidateFromMessage(message: string, answeringLocationQuestion: boolean) {
  const prepositionMatch = message.match(/\b(?:in|at|near|around|along|from)\s+([^,.!?]+(?:[,][^.!?]+)?)\s*[.!?]*$/i);
  const candidate = cleanCandidate(prepositionMatch?.[1] || (answeringLocationQuestion ? message : ""));
  if (!candidate || candidate.length > 120) return null;

  const text = normalized(candidate);
  if (!text || /^uganda$/.test(text)) return null;
  if (/\b(pothole|complaint|problem|issue|outage|power|water|airtime|money|report)\b/.test(text) && !prepositionMatch) {
    return null;
  }
  return candidate;
}

function displayPlaceName(candidate: string, result: NominatimResult, address: Record<string, string | undefined>) {
  return result.name || address.neighbourhood || address.suburb || address.quarter || address.village ||
    address.town || address.city || address.municipality || candidate;
}

function districtName(address: Record<string, string | undefined>) {
  return address.city || address.municipality || address.county || address.state_district || null;
}

function sourceUrl(result: NominatimResult) {
  if (!result.osm_id || !result.osm_type) return "https://www.openstreetmap.org";
  return `https://www.openstreetmap.org/${result.osm_type}/${result.osm_id}`;
}

function reserveLookupSlot() {
  const slot = lookupQueue.then(async () => {
    const waitMs = Math.max(0, nextLookupAt - Date.now());
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    nextLookupAt = Date.now() + 1000;
  });
  lookupQueue = slot.catch(() => undefined);
  return slot;
}

function matchesCandidate(result: NominatimResult, candidate: string) {
  const resultText = normalized(result.display_name || "");
  const terms = normalized(candidate).split(" ").filter((term) => term.length >= 3);
  return terms.length > 0 && terms.every((term) => resultText.includes(term));
}

function placeQueries(candidate: string) {
  const words = candidate.split(/\s+/).filter(Boolean);
  const queries = [`${candidate}, Uganda`];
  if (words.length > 1) {
    const genericSuffix = /^(?:road|street|avenue|lane|zone|village|parish|ward)$/i.test(words.at(-1) || "");
    const subjectLength = genericSuffix && words.length > 2 ? 2 : 1;
    const subject = words.slice(-subjectLength).join(" ");
    const context = words.slice(0, -subjectLength).join(" ");
    if (context) queries.push(`${subject}, ${context}, Uganda`);
  }
  return [...new Set(queries)];
}

export async function resolveUgandaPlaceOnline(candidate: string): Promise<ResolvedUgandaPlace | null> {
  const cacheKey = normalized(candidate);
  const cached = placeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2800);
  try {
    let result: NominatimResult | undefined;
    for (const queryText of placeQueries(candidate)) {
      await reserveLookupSlot();
      const query = new URLSearchParams({
        q: queryText,
        format: "jsonv2",
        addressdetails: "1",
        countrycodes: "ug",
        limit: "5",
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${query}`, {
        headers: {
          Accept: "application/json",
          "Accept-Language": "en",
          "User-Agent": "SAUTI1-AI/0.1 (Uganda citizen service routing)",
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Uganda place lookup returned ${response.status}.`);

      const results = await response.json() as NominatimResult[];
      result = results.find((item) =>
        item.address?.country_code?.toLowerCase() === "ug" && matchesCandidate(item, candidate)
      );
      if (result) break;
    }
    const latitude = Number(result?.lat);
    const longitude = Number(result?.lon);
    if (!result || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      placeCache.set(cacheKey, { expiresAt: Date.now() + negativeCacheLifetimeMs, value: null });
      return null;
    }

    const address = result.address ?? {};
    const name = displayPlaceName(candidate, result, address);
    const district = districtName(address);
    const canonicalText = [...new Set([name, district, "Uganda"].filter(Boolean))].join(", ");
    const value: ResolvedUgandaPlace = {
      name,
      canonicalText,
      districtName: district,
      regionName: address.state || null,
      latitude,
      longitude,
      sourceUrl: sourceUrl(result),
    };
    placeCache.set(cacheKey, { expiresAt: Date.now() + cacheLifetimeMs, value });
    return value;
  } catch (error) {
    console.warn("Online Uganda place lookup failed", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
