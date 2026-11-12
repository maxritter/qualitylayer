export type IdentityFiles = {
  exists(path: string): Promise<boolean>
  readFile(path: string): Promise<string>
}

/** Native collection seams; the values stay local until reduced to a fingerprint. */
export type IdentityRuntime = {
  platform: NodeJS.Platform
  uid(): number | undefined
  ioreg(): Promise<string>
  registry(): { exitCode: number; stdout: string; stderr: string }
  userSid(): string
}

/** Polar receives this hostname metadata and the first 16 fingerprint characters as its label. */
export type MachineMetadata = { machine: string; product: string }

export type Tier = "trial" | "solo" | "team"

/** Held credential facts for explicit SSH activation and consented support requests. */
export type PublicHeldLicenceIdentity = {
  state: { tier: Tier; key: string } | null
  pending: { key: string } | null
}

export type LicensingTransport = {
  http: { fetch(url: string, init?: RequestInit): Promise<Response> }
  clock: { sleep(ms: number): Promise<void> }
}

export type TrialRequest = { fingerprint: string; product: string }
export type EntitlementRequest = { key: string; activation?: string; fingerprint: string }
export type PolarValidateRequest = { key: string; organization_id: string }
export type PolarActivateRequest = PolarValidateRequest & {
  label: string
  meta: MachineMetadata
}
export type PolarDeactivateRequest = PolarValidateRequest & { activation_id: string }
