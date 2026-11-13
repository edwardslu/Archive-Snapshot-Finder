chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "archiveSnapshotPage",
    title: "Open latest snapshot (this page)",
    contexts: ["page"]
  });
  chrome.contextMenus.create({
    id: "archiveSnapshotLink",
    title: "Open latest snapshot (this link)",
    contexts: ["link"]
  });
});

const MIRRORS = [
  { base: "https://archive.today" },
  { base: "https://archive.is" },
  { base: "https://archive.ph" }
];

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === "archiveSnapshotPage" && tab?.url) {
      const resolvedUrl = await resolveFinalUrlFastWithLongerDelay(tab.url, tab.index);
      const target = resolvedUrl || tab.url;
      const snapshotUrl = await getSnapshotUrl(target);
      chrome.tabs.update(tab.id, { url: snapshotUrl });
    }

    if (info.menuItemId === "archiveSnapshotLink" && info.linkUrl && tab) {
      const resolvedUrl = await resolveFinalUrlFastWithLongerDelay(info.linkUrl, tab.index);
      const target = resolvedUrl || info.linkUrl;
      const snapshotUrl = await getSnapshotUrl(target);
      chrome.tabs.create({ url: snapshotUrl, index: tab.index + 1 });
    }
  } catch (e) {
    console.error("Archive error:", e);
  }
});

/**
 * Faster resolver with slightly longer delay:
 * - Opens a temp tab
 * - Grabs URL as soon as it moves away from news.google.com/read
 * - After load completes, waits 1000 ms before DOM extraction
 * - Hard timeout at 6000 ms
 */
async function resolveFinalUrlFastWithLongerDelay(originalUrl, baseIndex) {
  const tempTab = await chrome.tabs.create({
    url: originalUrl,
    active: false,
    index: baseIndex + 1
  });

  let finalUrl = null;

  const promise = new Promise((resolve) => {
    const onUpdated = async (updatedTabId, changeInfo, updatedTab) => {
      if (updatedTabId !== tempTab.id) return;

      // Early resolution when URL moves away from the wrapper
      if (changeInfo.url && !changeInfo.url.includes("news.google.com/read")) {
        finalUrl = changeInfo.url;
        cleanup();
        resolve(finalUrl);
        return;
      }

      // On complete, run DOM extractor after a slightly longer delay
      if (changeInfo.status === "complete") {
        setTimeout(async () => {
          try {
            const [{ result }] = await chrome.scripting.executeScript({
              target: { tabId: tempTab.id },
              func: () => {
                const isWrapper = (href) => {
                  try {
                    const u = new URL(href);
                    if (u.hostname === "news.google.com") return true;
                    if (u.hostname.endsWith(".google.com")) return true;
                    if (u.hostname === "t.co") return true;
                    if (u.hostname.endsWith("facebook.com")) return true;
                    return false;
                  } catch { return true; }
                };

                const canonical = document.querySelector('link[rel="canonical"][href]');
                if (canonical?.href && !isWrapper(canonical.href)) return canonical.href;

                const meta = document.querySelector('meta[http-equiv="refresh"][content]');
                if (meta) {
                  const m = meta.content.match(/url=(.+)$/i);
                  if (m && m[1]) {
                    const url = m[1].trim().replace(/^['"]|['"]$/g, "");
                    if (!isWrapper(url)) return url;
                  }
                }

                const anchors = Array.from(document.querySelectorAll("a[href]"));
                const prioritized = anchors
                  .filter(a => /read|full|article/i.test(a.textContent || ""))
                  .map(a => a.href)
                  .filter(href => href.startsWith("http") && !isWrapper(href));
                if (prioritized.length) return prioritized[0];

                const external = anchors
                  .map(a => a.href)
                  .filter(href => href.startsWith("http") && !isWrapper(href));
                if (external.length) return external[0];

                return window.location.href;
              }
            });
            finalUrl = result;
          } catch {
            const t = await chrome.tabs.get(tempTab.id).catch(() => null);
            finalUrl = t?.url || null;
          }
          cleanup();
          resolve(finalUrl);
        }, 1000); // slightly longer delay than the previous fast version
      }
    };

    const cleanup = () => {
      try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch {}
      try { chrome.tabs.remove(tempTab.id); } catch {}
    };

    chrome.tabs.onUpdated.addListener(onUpdated);

    // Hard timeout fallback: 6 seconds total
    setTimeout(async () => {
      if (!finalUrl) {
        const t = await chrome.tabs.get(tempTab.id).catch(() => null);
        finalUrl = t?.url || null;
        cleanup();
        resolve(finalUrl);
      }
    }, 6000);
  });

  return promise;
}

async function getSnapshotUrl(originalUrl) {
  for (const m of MIRRORS) {
    const latestUrl = `${m.base}/latest/${originalUrl}`;
    const snapshot = await followRedirect(latestUrl);
    if (isSnapshotUrl(snapshot)) return snapshot;
  }
  for (const m of MIRRORS) {
    const submitUrl = `${m.base}/submit/?url=${encodeURIComponent(originalUrl)}`;
    const snapshot = await followRedirect(submitUrl);
    if (isSnapshotUrl(snapshot)) return snapshot;
  }
  return `${MIRRORS[0].base}/search/?q=${encodeURIComponent(originalUrl)}`;
}

async function followRedirect(url) {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", credentials: "omit", cache: "no-store" });
    if (!res.ok) return null;
    return res.url || null;
  } catch {
    return null;
  }
}

function isSnapshotUrl(url) {
  if (!url) return false;
  const re = /^https:\/\/archive\.(?:is|today|ph)\/\d{4}\.\d{2}\.\d{2}-\d{6}\/https?:\/\/.+/i;
  if (re.test(url)) return true;
  const loose = /^https:\/\/archive\.(?:is|today|ph)\/[A-Za-z0-9_-]+\/https?:\/\/.+/i;
  return loose.test(url);
}
