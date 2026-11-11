/**
 * Words the site never shows: the App's internal terms (Max's copy rules and the glossary of the
 * App redesign), and the names of elements the redesign removed. The tests read every page's text
 * against this list; the words to use instead are Your turn, passed, Checked by agents, Found
 * while checking, Only you can confirm, Questions for you, Agents are building / checking.
 * "Fix rounds" is the name of a Verify stage (PRODUCT.md, the Verify guide), so it may stand.
 */
export const BANNED_WORDS =
  /\b(judges?|helpers?|gates?|verdicts?|probes?|cold reads?|(?<!fix )rounds?|cockpit|token budget|checkpoint switch|checkpoints?|grok bot|iterations?|fresh (agent|helper|judge)|quality pass|second-opinion|soon)\b/i;
