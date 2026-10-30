/** Inside QualityLayer, the deep-dive video: what its page and emails say about it. Change it here, nowhere else. */
export const DEEP_DIVE_PATH = "/inside";
export const DEEP_DIVE_TITLE = "Inside QualityLayer";
export const DEEP_DIVE_SPEAKER = "Max Ritter";
/** The final render runs 27:16. */
export const DEEP_DIVE_MINUTES = 27;
export const DEEP_DIVE_POSTER = `/inside/inside-qualitylayer.webp`;
/** The full video on YouTube; the email links here, and the hero shows the Deep dive button while it is set. */
export const DEEP_DIVE_VIDEO_URL: string | null = "https://youtu.be/STtsW6pa6x4";

/** What the page and the email show of the video: five numbered steps, no times (Max, 30 October 2026). The timed chapters live in the YouTube description. */
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
