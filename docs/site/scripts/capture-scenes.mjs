export const CAPTURE_SCENES = [
  "discuss", "research", "plan", "hero", "terminal", "outline", "implement-start", "implement",
  "verify", "review", "review-code", "review-approved", "pull-request", "artifact", "team",
  "home", "setup", "memory", "artifacts", "artifacts-open", "chat",
];

export const DESKTOP_ONLY_SCENES = ["hero", "review-code", "chat", "review-approved"];
export const DOCS_ALIASES = { "setup-light.webp": "settings-light.webp", "setup-dark.webp": "settings-dark.webp" };
export const HERO_FILES = ["your-turn-light.webp", "your-turn-dark.webp"];
export const DESKTOP_HERO_FILES = ["plan-desktop-light.webp", "plan-desktop-dark.webp"];
export const DESKTOP_HERO_VIEWPORT = { width: 1280, height: 900 };

export function captureFiles(scene) {
  if (scene === "hero") return [...DESKTOP_HERO_FILES];
  return ["light", "dark"].flatMap(theme => [
    `${scene}-${theme}.webp`,
    ...(DESKTOP_ONLY_SCENES.includes(scene) ? [] : [`${scene}-phone-${theme}.webp`]),
  ]);
}

export const sceneFiles = scene => [...captureFiles(scene), ...(scene === "plan" ? HERO_FILES : [])];
