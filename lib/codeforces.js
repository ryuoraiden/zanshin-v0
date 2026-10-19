// Codeforces problem parsing and accepted-submission matching.

// Accepts "580A", "580 A", "580/A", "1352C2" or a problem URL. Returns { contestId, index } or null.
export function parseProblem(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m =
    s.match(/codeforces\.com\/(?:contest|gym)\/(\d+)\/problem\/([A-Za-z]\d?)\b/i) ||
    s.match(/codeforces\.com\/problemset\/problem\/(\d+)\/([A-Za-z]\d?)\b/i) ||
    s.match(/^(\d+)\s*[/\s-]?\s*([A-Za-z]\d?)$/);
  return m ? { contestId: Number(m[1]), index: m[2].toUpperCase() } : null;
}

export function problemKey(p) {
  return p ? `${p.contestId}${p.index}` : '';
}

// True when there is an OK verdict for `problem` submitted at or after `sinceSec`.
// Older ACs never count, so a problem solved months ago can't auto-complete a new session.
export function solvedAfter(submissions, problem, sinceSec) {
  if (!problem || !Array.isArray(submissions)) return false;
  return submissions.some(
    (s) =>
      s &&
      s.verdict === 'OK' &&
      s.problem &&
      Number(s.problem.contestId) === problem.contestId &&
      String(s.problem.index).toUpperCase() === problem.index &&
      Number(s.creationTimeSeconds) >= sinceSec,
  );
}

// Problem keys ("580A") with at least one accepted submission, for unticking solved problems
// when importing a sheet.
export function solvedKeys(submissions) {
  const out = new Set();
  for (const s of submissions || [])
    if (s && s.verdict === 'OK' && s.problem?.contestId) out.add(`${s.problem.contestId}${String(s.problem.index).toUpperCase()}`);
  return [...out];
}

export async function fetchRecent(handle, fetchImpl = fetch, timeoutMs = 8000, count = 20) {
  const url = `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=1${count ? `&count=${count}` : ''}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Codeforces HTTP ${res.status}`);
    const json = await res.json();
    if (json.status !== 'OK') throw new Error(json.comment || 'Codeforces API error');
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}
