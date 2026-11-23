export type NativeSettingField = "model" | "effort"
function isNativeSettingField(field: unknown): field is NativeSettingField {
  return field === "model" || field === "effort"
}

export function missingNativeSettings(value: unknown): NativeSettingField[] | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as { code?: unknown; fields?: unknown }
  if (record.code !== "native_settings_unknown" || !Array.isArray(record.fields)) return undefined
  const { fields } = record
  if (fields.length < 1 || fields.length > 2) return undefined
  if (!fields.every(isNativeSettingField)) return undefined
  return [...new Set(fields)]
}
export class NativeSettingsUnknown extends Error {
  readonly code = "native_settings_unknown"
  constructor(readonly fields: NativeSettingField[]) {
    super(
      "The current native session settings could not be verified. Confirm the displayed choices before restarting.",
    )
  }
}
