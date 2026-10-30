# Privacy Policy — KEGE Reader

**Effective date:** 2026-10-30

KEGE Reader is a client-side-only browser extension. It **does not collect,
transmit, sell, or share any personal data**. There is no analytics, no
tracking, no telemetry, and no server component of any kind.

## What the extension does with data

- **Renders pages locally.** It reflows task pages on `kompege.ru` into a
  readable layout and draws the current task into an HTML canvas inside your
  own browser to power a Picture-in-Picture (PiP) floating window.
- **Canvas capture.** The PiP window uses the browser's `captureStream` of a
  canvas that contains only the task content you chose to open. The video
  stream never leaves the browser and is never recorded, stored, or sent
  anywhere.
- **Background fetch relay.** The extension's background page can fetch image
  files referenced by a task page when the image host does not send CORS
  headers. The fetch is made only for image URLs already referenced by the
  page you have open, uses your existing cookies for that site (so your own
  session keeps working), and the bytes are kept in memory just long enough
  to render the image. Nothing is uploaded, logged, or persisted.
- **Permissions:** the extension requests access to web pages so it can (a)
  reflow `kompege.ru`, and (b) fetch task images that are served from
  third-party CDNs without CORS headers. It does not read page content on any
  other site, and it never modifies, injects into, or observes any other
  website.
- **Storage.** The extension stores only its own UI settings (zoom level,
  reading mode, toolbar visibility) in the browser's local storage. No
  browsing history, no credentials, no page content is persisted.

## Third parties

The extension contacts no third-party services on its own. The only network
requests it makes are for images referenced by the task pages you open.

## Contact

Source code: <https://github.com/j3ngoos/kege-reader>
Issues: <https://github.com/j3ngoos/kege-reader/issues>
