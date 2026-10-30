/** Inside QualityLayer, the deep-dive video: what its page and emails say about it. Change it here, nowhere else. */
export const DEEP_DIVE_PATH = "/inside";
export const DEEP_DIVE_TITLE = "Inside QualityLayer";
export const DEEP_DIVE_SPEAKER = "Max Ritter";
/** The final render runs 27:16. */
export const DEEP_DIVE_MINUTES = 27;
export const DEEP_DIVE_POSTER = `/inside/inside-qualitylayer.webp`;
/** Set once the video is on YouTube; until then the email links to the page. */
export const DEEP_DIVE_VIDEO_URL: string | null = null;

/** The video's chapters with their start times; the intro and the closing call to action are left out. */
export const DEEP_DIVE_CHAPTERS = [
  { at: "1:49", title: "Better models, same problems", about: "What three studies found after teams adopted coding agents: more code, slower reviews, more incidents." },
  { at: "5:45", title: "From plan mode to the software factory", about: "Eighteen months of agentic coding, and why a factory without people ships the average." },
  { at: "10:30", title: "The seven-step workflow", about: "How a task moves from the first question to the pull request, and the two points where you approve." },
  { at: "14:29", title: "Bring your team in", about: "Teammates answer questions and comment at the Plan, then review a change that follows it." },
  { at: "15:25", title: "Demo: one task, request to pull request", about: "A change built in the App from the first question to the pull request." },
  { at: "23:37", title: "Team, chat, artifacts, memory and settings", about: "The rest of the App, from sharing a task with teammates to choosing your agents." },
];

/** What the page shows of the video: five short steps, no times (Max, 30 October 2026). */
export const DEEP_DIVE_OUTLINE = [
  { title: "Better models, same problems", line: "Why stronger models still break working code." },
  { title: "From plan mode to the factory", line: "Where people still decide what ships." },
  { title: "The seven-step workflow", line: "From the first question to the pull request." },
  { title: "Your team in the loop", line: "Questions and review at the two points that count." },
  { title: "Demo in the App", line: "One task, start to finish." },
];

/** The code that comes with the email, for anyone who watched; it does not expire (Max, 30 October 2026). */
export const DEEP_DIVE_PROMO = { code: "INSIDEQL15", percent: 15 };

/** The consent a visitor gives with the form, stored with their confirmation. */
export const NEWSLETTER_CONSENT_VERSION = "2026-10-30-v1";
export const NEWSLETTER_CONSENT_TEXT =
  "Send me the video and the occasional QualityLayer newsletter with releases, guides and new videos. I can unsubscribe at any time.";
