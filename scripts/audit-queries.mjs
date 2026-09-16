/**
 * Validates every Supabase select in the codebase against the live database.
 * Catches a page that will throw at runtime because it asks for a column or
 * relationship that does not exist -- without needing to sign in.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const root = process.cwd();
const env = Object.fromEntries(
  readFileSync(`${root}/.env.local`, "utf8").split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^"|"$/g, "")])
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const files = execSync(`git -C ${root} ls-files "*.ts" "*.tsx"`, { encoding: "utf8" })
  .split("\n").filter(Boolean).filter((f) => !f.startsWith("tests/"));

// .from("table") followed (within a few lines) by .select(`...`) or .select("...")
const pattern = /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)[\s\S]{0,80}?\.select\(\s*(`[^`]*`|"[^"]*"|'[^']*')/g;

const queries = [];
for (const file of files) {
  const source = readFileSync(`${root}/${file}`, "utf8");
  for (const m of source.matchAll(pattern)) {
    const table = m[1];
    const selectRaw = m[2].slice(1, -1);
    const line = source.slice(0, m.index).split("\n").length;
    // Mirror postgrest-js: it strips every unquoted whitespace character
    // before sending, so auditing the raw source text produces false parse
    // errors on selects that are perfectly valid at runtime.
    let quoted = false;
    const cleaned = selectRaw.split("").map((c) => {
      if (/\s/.test(c) && !quoted) return "";
      if (c === '"') quoted = !quoted;
      return c;
    }).join("");
    queries.push({ file, line, table, select: cleaned });
  }
}

console.log(`found ${queries.length} selects across ${new Set(queries.map(q => q.file)).size} files\n`);

// Split a PostgREST select list on top-level commas (ignoring nested parens).
function topLevelParts(select) {
  const parts = [];
  let depth = 0, buf = "";
  for (const ch of select) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(buf.trim()); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.filter(Boolean);
}

async function probe(table, select) {
  const url = `${URL_}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1`;
  const res = await fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body: body.slice(0, 200) };
}

const failures = [];
const seen = new Set();

for (const q of queries) {
  const key = `${q.table}|${q.select}`;
  if (seen.has(key)) continue;
  seen.add(key);

  // Strip PostgREST modifiers the probe cannot evaluate (count hints etc).
  const cleaned = topLevelParts(q.select)
    .filter((p) => !p.startsWith("!"))
    .join(",");
  if (!cleaned || cleaned === "*") continue;

  const result = await probe(q.table, cleaned);
  if (!result.ok) {
    // Fall back to per-part probing so we can name the offending column.
    const bad = [];
    for (const part of topLevelParts(cleaned)) {
      const one = await probe(q.table, part);
      if (!one.ok) bad.push({ part, detail: one.body });
    }
    failures.push({ ...q, status: result.status, bad: bad.length ? bad : [{ part: cleaned, detail: result.body }] });
  }
}

// 401 means the table exists but anon cannot read it -- correct for the
// admin and institution tables, and not a defect.
const real = failures.filter((f) => f.status !== 401);
if (!real.length) {
  console.log(`PASS: every select resolves. (${failures.length} table(s) readable only when signed in.)`);
} else {
  console.log(`FAIL: ${failures.length} query/queries reference something that does not exist\n`);
  for (const f of failures) {
    console.log(`${f.file}:${f.line}  table=${f.table}  http=${f.status}`);
    for (const b of f.bad) console.log(`   part: ${b.part}\n   ${b.detail}`);
    console.log();
  }
  process.exitCode = 1;
}
