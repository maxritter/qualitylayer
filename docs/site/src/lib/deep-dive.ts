/** Inside QualityLayer, the deep-dive video: what its page and emails say about it. Change it here, nowhere else. */
export const DEEP_DIVE_PATH = "/inside";
export const DEEP_DIVE_TITLE = "Inside QualityLayer";
export const DEEP_DIVE_SPEAKER = "Max Ritter";
/** The final render runs 27:59. */
export const DEEP_DIVE_MINUTES = 28;
export const DEEP_DIVE_POSTER = `/inside/inside-qualitylayer.webp`;
/** Set once the video is on YouTube; until then the email links to the page. */
export const DEEP_DIVE_VIDEO_URL: string | null = null;

/** The video's chapters with their start times; the intro and the closing call to action are left out. */
export const DEEP_DIVE_CHAPTERS = [
  { at: "1:47", title: "Better models, same problems", about: "What three studies found after teams adopted coding agents: more code, slower reviews, more incidents." },
  { at: "5:42", title: "From plan mode to the software factory", about: "Eighteen months of agentic coding, and why a factory without people ships the average." },
  { at: "10:28", title: "The seven-step workflow", about: "How a task moves from the first question to the pull request, and the two points where you approve." },
  { at: "14:28", title: "Bring your team in", about: "Teammates answer questions and comment at the Plan, then review a change that follows it." },
  { at: "15:23", title: "Demo: one task, request to pull request", about: "A change built in the App from the first question to the pull request." },
  { at: "23:51", title: "Team, chat, artifacts, memory and settings", about: "The rest of the App, from sharing a task with teammates to choosing your agents." },
];

/** A code that comes with the email. The page and the email offer it only until it expires. */
export const DEEP_DIVE_PROMO = { code: "INSIDEQL15", percent: 15, validUntil: "2026-11-12T23:59:00+01:00", validUntilLabel: "12 November 2026" };
export const promoActive = (now = Date.now()) => now <= Date.parse(DEEP_DIVE_PROMO.validUntil);

/** The consent a visitor gives with the form, stored with their confirmation. */
export const NEWSLETTER_CONSENT_VERSION = "2026-10-30-v1";
export const NEWSLETTER_CONSENT_TEXT =
  "Send me the video and the occasional QualityLayer newsletter with releases, guides and new videos. I can unsubscribe at any time.";
