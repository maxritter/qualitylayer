type Recommended = { recommended: number; recommendedChoices?: number[]; multi?: true }

/** Old questions keep their scalar recommendation; only explicit multi sets expand it. */
export function recommendedIndices(question: Recommended): number[] {
  return question.multi && question.recommendedChoices
    ? [...question.recommendedChoices]
    : [question.recommended]
}

export function recommendedLabel(question: Recommended & { choices: { label: string }[] }): string {
  return recommendedIndices(question)
    .map((i) => question.choices[i]?.label ?? "")
    .join(" + ")
}

const RECOMMENDATION_SUFFIX = "(recommended)"

export function withoutRecommendationMarker(label: string): string {
  let end = label.trimEnd().length
  while (
    end >= RECOMMENDATION_SUFFIX.length &&
    label.slice(end - RECOMMENDATION_SUFFIX.length, end).toLowerCase() === RECOMMENDATION_SUFFIX
  )
    end = label.slice(0, end - RECOMMENDATION_SUFFIX.length).trimEnd().length
  return label.slice(0, end)
}
