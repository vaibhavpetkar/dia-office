// Lets phones and laptops install the Dia app. Everything still comes live from the office; nothing is cached,
// so you never see an old answer or an old job.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
