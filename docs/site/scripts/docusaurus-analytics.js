export function startDocusaurusAnalytics(beforeSend) {
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  window.va("beforeSend", beforeSend);

  if (window.vai || document.querySelector('script[src*="/_vercel/insights/"], script[src*="va.vercel-scripts.com/"]')) return;

  // The tracker owns initial pageviews, pushState and popstate. Do not send a second pageview here.
  const script = document.createElement("script");
  script.defer = true;
  script.src = "/_vercel/insights/script.js";
  document.head.appendChild(script);
}
