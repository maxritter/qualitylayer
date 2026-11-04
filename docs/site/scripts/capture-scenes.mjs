export const CAPTURE_SCENES = [
  "discuss", "research", "plan", "terminal", "outline", "implement-start", "implement",
  "verify", "review", "review-code", "review-approved", "pull-request", "artifact", "team",
  "home", "setup", "memory", "artifacts", "artifacts-open", "chat",
];

export const DESKTOP_ONLY_SCENES = ["review-code", "chat", "review-approved"];
export const DOCS_ALIASES = { "setup-light.webp": "settings-light.webp", "setup-dark.webp": "settings-dark.webp" };
export const HERO_FILES = ["your-turn-light.webp", "your-turn-dark.webp"];

export function captureFiles(scene) {
  return ["light", "dark"].flatMap(theme => [
    `${scene}-${theme}.webp`,
    ...(DESKTOP_ONLY_SCENES.includes(scene) ? [] : [`${scene}-phone-${theme}.webp`]),
  ]);
}

export const sceneFiles = scene => [...captureFiles(scene), ...(scene === "plan" ? HERO_FILES : [])];
