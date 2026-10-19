// Loaded first by every page the Windows app serves. Stands in for the browser-extension APIs the shared
// pages use (chrome.storage, chrome.runtime) and routes them to the local Workflow Detective app instead.
(function () {
  window.WD_PLATFORM = "desktop";
  var VERSION = "__WD_VERSION__";
  function api(path, body) {
    return fetch("/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin"
    }).then(function (r) {
      if (!r.ok) throw new Error("Workflow Detective isn’t responding (" + r.status + "). Make sure the app is running.");
      return r.json();
    });
  }
  window.WD_API = api;
  window.chrome = {
    storage: {
      local: {
        get: function (keys) {
          return api("kv").then(function (all) {
            if (keys == null) return all;
            var ks = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys);
            var out = {};
            ks.forEach(function (k) { if (k in all) out[k] = all[k]; });
            return out;
          });
        },
        set: function (obj) { return api("kv/set", obj).then(function () {}); },
        remove: function (keys) { return api("kv/remove", { keys: Array.isArray(keys) ? keys : [keys] }).then(function () {}); }
      },
      onChanged: { addListener: function () {} }
    },
    runtime: {
      getManifest: function () { return { version: VERSION }; },
      getURL: function (p) { return "/" + p; },
      sendMessage: function () { return Promise.resolve({}); }
    },
    tabs: { create: function (o) { location.href = o.url; } }
  };
})();
