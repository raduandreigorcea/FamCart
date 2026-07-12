// OneSignal's push service worker, registered by the web SDK under the
// /onesignal/ scope so it coexists with the root-scope PWA worker (src/sw.js).
// Push delivery and notification clicks are handled entirely by this import.
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js')
