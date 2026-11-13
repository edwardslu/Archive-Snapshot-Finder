# Archive Snapshot Finder

Right-click any page and jump to the latest snapshot on archive.is (or archive.today). If none are found, it opens the archive search page for that URL.

## Install (Chrome/Edge)

1. Clone or download this folder.
2. Open your browser:
   - Chrome: go to `chrome://extensions`
   - Edge: go to `edge://extensions`
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the folder containing `manifest.json`.
5. Visit any site, right-click the page, and choose **Open latest snapshot on archive.is**.

## Notes

- This extension fetches HTML from `archive.is` and `archive.today` search pages and parses links via patterns like:
  `https://archive.is/YYYY.MM.DD-HHMMSS/https://example.com/...`
- If parsing fails or no snapshots are present, it opens the archive search results so you can check manually.
- No data is stored; it only reads the current tab URL and requests the archive search pages.
