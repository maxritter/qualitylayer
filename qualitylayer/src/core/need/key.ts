// Whether a note looks like a key, for the App and the CLI alike. Free of imports, so the App's
// bundle can hold it: the note field refuses a key before it is ever sent.

const KEY_PATTERNS: readonly RegExp[] = [
  /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/,
  /\b(sk|sk-ant|sk-proj)-[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]

function isRandomKeyToken(token: string): boolean {
  if (token.length < 24 || !/\d/.test(token)) return false
  const kinds = [/[a-z]/, /[A-Z]/, /\d/].filter((re) => re.test(token)).length
  if (kinds < 2) return false
  return !/^[a-z]+([-_./][a-z]+)+$/.test(token) && !/^(https?:)?\/\//.test(token)
}

/**
 * Something that looks like a key, which the App never takes: a known prefix (Stripe, GitHub,
 * Slack, OpenAI, Anthropic, AWS, Google), a JWT, a private key, or a long run of random characters.
 */
export function looksLikeKey(text: string): boolean {
  if (KEY_PATTERNS.some((pattern) => pattern.test(text))) return true
  // A long token of mixed letters and digits with no spaces, as random keys are.
  return text.split(/[\s"'`,;()]+/).some(isRandomKeyToken)
}

export const KEY_REFUSED = "That looks like a key. Put it in .env.local instead"
