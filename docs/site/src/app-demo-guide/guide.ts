// The guided web demo's entry, loaded by app-demo/index.html before the App. Only `?guide` turns it on:
// then every page opens from its address alone, as on the presenter's stage, and the guide's player
// loads beside the App. The App's other visitors load nothing more than this check.

if (new URLSearchParams(location.search).has("guide")) {
  try {
    // The App would otherwise reopen the last task it kept (`qualitylayer-route`) with an earlier page's
    // state. Only the App's own keys go; the website's (its theme, share receipts) stay.
    const site = localStorage.getItem("theme")
    for (const key of Object.keys(localStorage))
      if (key.startsWith("qualitylayer-") && !key.startsWith("qualitylayer-share-receipts")) localStorage.removeItem(key)
    const dark =
      site === "dark" || (site !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches)
    localStorage.setItem("qualitylayer-theme", dark ? "dark" : "light")
    localStorage.setItem("qualitylayer-nav", "true")
  } catch {
    // Without storage the App opens with its defaults; the guide still plays.
  }
  void import("./player.ts").then(({ startGuide }) => startGuide())
}
