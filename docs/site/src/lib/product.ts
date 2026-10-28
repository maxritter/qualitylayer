/** Facts the whole site shares. Change them here, nowhere else. */
export const SITE_URL = "https://qualitylayer.dev";
/** Mirrors the CLI's offline window; copy.test.tsx checks the rendered claim against its constant. */
export const OFFLINE_DAYS = 7;

/** Served from the site (a redirect to the installer in the repository). */
export const INSTALL_COMMAND = `curl -fsSL ${SITE_URL}/install.sh | bash`;

export const GITHUB_URL = "https://github.com/maxritter/qualitylayer";
/** The documentation, served by Docusaurus under the site's own domain. */
export const DOCS_URL = "/docs/";
export const RELEASES_URL = `${GITHUB_URL}/releases`;
export const CHANGELOG_URL = "/docs/changelog";
export const CONTACT_EMAIL = "hello@qualitylayer.dev";
export const AUTHOR_URL = "https://maxritter.net";
export const AUTHOR_NAME = "Max Ritter";

/** The hero's subtitle and the default page description. */
export const DESCRIPTION =
  "Plan, build and review software with your coding agents. Work side by side in the App or browser, or use your favourite terminal or IDE.";
/** The line under the name wherever the product is introduced: the hero, page titles, the README and the CLI. */
export const SLOGAN = "The software factory with you in the loop";
/** The brand line, shown with the mark above the slogan (Max, 2026-10-19). Kept out of titles and keywords: alone it does not say what the product is. */
export const BRAND_LINE = "Quality by design";
/** The sentence shown when the site is shared or listed in search; also rendered at build time. */
export const SHARE_DESCRIPTION = DESCRIPTION;
export const WEBINAR = { label: "Join the webinar", title: "Inside QualityLayer", href: "https://luma.com/8b8ywm6d" };
/** One engineer's words about QualityLayer, relayed by Max on 2026-10-15. Quote it as it is; the attribution stays anonymous. */
export const ENGINEER_QUOTE = "With QualityLayer, developing software with agents finally feels like doing real engineering again.";
export const USER_QUOTE = {
  text: "I just wanted to say how much I LOVE QualityLayer. I feel like my productivity shot through the roof!",
  context: "Former Pilot Shell user, now using QualityLayer",
};

/** Chat's first release supports these two agents; workflow integrations have a wider list. */
export const CHAT_GUIDANCE = "Prefer a conversation? Chat with Claude Code or Codex.";
