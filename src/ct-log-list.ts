/**
 * CT Log List resolver
 *
 * Fetches Google's (or custom) CT log list and provides
 * log_id → human-readable name mapping.
 */

// Demo: merged list (Google's logs + attack simulation logs) served by the CT log server.
// Production: 'https://www.gstatic.com/ct/log_list/v3/log_list.json'
const CT_LOG_LIST_URL =
  process.env.CT_LOG_LIST_URL ||
  "https://logs.jvgc-a.com/log-list.json";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CTLogEntry {
  log_id: string;
  description: string;
  url?: string;
  submission_url?: string;
  [key: string]: unknown;
}

interface CTLogOperator {
  name: string;
  logs?: CTLogEntry[];
}

interface CTLogList {
  operators: CTLogOperator[];
}

let logNameMap: Map<string, string> = new Map();
let lastFetch = 0;

/** Normalize base64: trim whitespace, ensure consistent padding */
function normalizeBase64(b64: string): string {
  let s = b64.trim();
  // base64url → standard base64
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  // ensure padding
  while (s.length % 4 !== 0) s += "=";
  return s;
}

async function refreshLogList(): Promise<void> {
  try {
    const res = await fetch(CT_LOG_LIST_URL);
    if (!res.ok) {
      console.error(`[CT Log List] Failed to fetch: HTTP ${res.status}`);
      return;
    }
    const data = (await res.json()) as CTLogList;
    const map = new Map<string, string>();

    for (const operator of data.operators) {
      for (const log of operator.logs ?? []) {
        if (log.log_id && log.description) {
          map.set(normalizeBase64(log.log_id), log.description);
        }
      }
    }

    logNameMap = map;
    lastFetch = Date.now();
    console.log(`[CT Log List] Loaded ${map.size} log names from ${CT_LOG_LIST_URL}`);
  } catch (err) {
    console.error("[CT Log List] Error fetching log list:", err);
  }
}

/**
 * Resolve a base64 log_id to its human-readable name.
 * Returns the description if found, otherwise null.
 */
export async function getLogName(logId: string): Promise<string | null> {
  if (Date.now() - lastFetch > CACHE_TTL_MS) {
    await refreshLogList();
  }
  return logNameMap.get(normalizeBase64(logId)) ?? null;
}

/**
 * Resolve multiple log IDs at once (single fetch if cache is stale).
 * Returns a Map<logId, name>.
 */
export async function resolveLogNames(
  logIds: string[]
): Promise<Map<string, string>> {
  if (Date.now() - lastFetch > CACHE_TTL_MS) {
    await refreshLogList();
  }
  const result = new Map<string, string>();
  for (const id of logIds) {
    const name = logNameMap.get(normalizeBase64(id));
    if (name) result.set(id, name);
  }
  return result;
}
