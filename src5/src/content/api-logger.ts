// @ts-nocheck
// The Rewards-API probe's document_start hook (Developer Option, 2026-09-08).
// Declared in manifest.config.ts as a MAIN-world content script at
// document_start — the only way to wrap fetch BEFORE the page's app bundle
// makes its initial API calls (a post-load executeScript always misses them).
//
// ARMED ONLY on URLs carrying ?meowprobe=1 — the probe's own tabs. Every
// other rewards.bing.com page (including the routine's automation tabs)
// bails on the one regex below and is completely untouched.
//
// Records EVERY http(s) fetch/XHR/sendBeacon — unfiltered. The first live
// run filtered to rewards-ish URLs and caught nothing while the page was
// fully signed in and hydrated, so the filter is gone: the probe's whole
// job is to see what the page actually calls (or to prove it calls nothing
// because the data is server-rendered — readers/api-probe.ts's pageFacts
// dumps the resource-timing entries and inline state scripts for exactly
// that verdict). Request headers are captured with
// authorization/cookie/token values REDACTED. Everything lands in a
// <script id="__meow_api_log"> holder — the DOM is the one channel between
// the page's MAIN world and the extension's isolated world — flushed on
// every entry so a reader can pick the log up at any moment.

(function () {
  if (!/[?&]meowprobe=1/.test(location.search)) return;
  if (window.__meowApiLoggerInstalled) return;
  window.__meowApiLoggerInstalled = true;

  var log = [];
  var MAX_ENTRIES = 300;
  // 150 KB per call keeps the saved report downloadable (it is written
  // through a data URL — see readers/api-probe.ts — so total size matters).
  var MAX_BODY = 150000;

  var holder = document.createElement("script");
  holder.type = "application/json";
  holder.id = "__meow_api_log";
  holder.textContent = "[]";
  (document.head || document.documentElement).appendChild(holder);

  function flush() {
    try { holder.textContent = JSON.stringify(log); } catch (e) {}
  }

  // Bodies only for textual responses; images and fonts record as omitted.
  function textual(contentType) {
    if (!contentType) return true;
    return /json|text|javascript|xml/i.test(contentType);
  }

  // The point of capturing headers is learning HOW the app authenticates its
  // API calls (a plain cookie fetch gets 401, observed live) — so names and
  // lengths matter, values of secrets do not.
  function redactHeader(name, value) {
    if (/authorization|cookie|token/i.test(name)) return "<redacted, " + String(value).length + " chars>";
    return String(value);
  }

  function headerSnapshot(headers) {
    try {
      if (!headers) return null;
      if (typeof Headers !== "undefined" && headers instanceof Headers) {
        var out = {};
        headers.forEach(function (v, k) { out[k] = redactHeader(k, v); });
        return out;
      }
      if (Array.isArray(headers)) {
        var outArr = {};
        headers.forEach(function (pair) {
          if (pair && pair[0]) outArr[pair[0]] = redactHeader(pair[0], String(pair[1]));
        });
        return outArr;
      }
      var outObj = {};
      for (var k in headers) outObj[k] = redactHeader(k, String(headers[k]));
      return outObj;
    } catch (e) { return null; }
  }

  function record(entry) {
    if (log.length >= MAX_ENTRIES) return;
    log.push(entry);
    flush();
  }

  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      var method = String(((init && init.method) || (input && input.method) || "GET")).toUpperCase();
      var promise = origFetch.apply(this, arguments);
      if (/^https?:/i.test(url || "")) {
        var requestHeaders = headerSnapshot(init && init.headers);
        promise.then(function (res) {
          var contentType = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
          var clone = res.clone ? res.clone() : null;
          if (clone && clone.text && textual(contentType)) {
            clone
              .text()
              .then(function (body) {
                record({
                  kind: "fetch",
                  url: res.url || url,
                  method: method,
                  status: res.status,
                  contentType: contentType,
                  requestHeaders: requestHeaders,
                  body: String(body).slice(0, MAX_BODY)
                });
              })
              .catch(function () {
                record({ kind: "fetch", url: res.url || url, method: method, status: res.status, contentType: contentType, requestHeaders: requestHeaders, bodyError: "unreadable" });
              });
          } else {
            record({ kind: "fetch", url: res.url || url, method: method, status: res.status, contentType: contentType, requestHeaders: requestHeaders, bodyOmitted: true });
          }
        }).catch(function (err) {
          record({ kind: "fetch", url: url, method: method, requestHeaders: requestHeaders, error: String((err && err.message) || err) });
        });
      }
      return promise;
    };
  }

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__meowApiReq = { method: String(method || "GET").toUpperCase(), url: String(url || "") };
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (this.__meowApiReq) {
        this.__meowApiReq.headers = this.__meowApiReq.headers || {};
        this.__meowApiReq.headers[name] = redactHeader(name, String(value));
      }
    } catch (e) {}
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var req = this.__meowApiReq;
    if (req && /^https?:/i.test(req.url || "")) {
      var self = this;
      this.addEventListener("load", function () {
        var contentType = "";
        try { contentType = self.getResponseHeader("content-type") || ""; } catch (e) {}
        var entry = {
          kind: "xhr",
          url: self.responseURL || req.url,
          method: req.method,
          status: self.status,
          contentType: contentType,
          requestHeaders: req.headers || null
        };
        if (textual(contentType)) {
          try { entry.body = String(self.responseText || "").slice(0, MAX_BODY); } catch (e2) { entry.bodyError = "unreadable"; }
        } else {
          entry.bodyOmitted = true;
        }
        record(entry);
      });
    }
    return origSend.apply(this, arguments);
  };

  if (navigator.sendBeacon) {
    var origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      record({ kind: "beacon", url: String(url || ""), method: "POST" });
      return origBeacon.apply(navigator, arguments);
    };
  }
})();
