/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POLAR_CHECKOUT_SOLO_MONTHLY?: string;
  readonly VITE_POLAR_CHECKOUT_SOLO_YEARLY?: string;
  readonly VITE_POLAR_CHECKOUT_TEAM_MONTHLY?: string;
  readonly VITE_POLAR_CHECKOUT_TEAM_YEARLY?: string;
}

declare module "*.webp" {
  const src: string;
  export default src;
}
