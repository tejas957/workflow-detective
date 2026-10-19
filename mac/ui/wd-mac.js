// Loaded first by every page the Mac app shows. Stands in for the browser-extension APIs the shared pages use
// (chrome.storage, chrome.runtime) and routes them to the Mac app through its message bridge.
(function () {
  window.WD_PLATFORM = "desktop";
  window.WD_OS = "mac";
  var VERSION = "__WD_VERSION__";
  var pending = {}, nextId = 1;
  window.__wdReply = function (id, result, error) {
    var p = pending[id]; delete pending[id];
    if (!p) return;
    if (error) p.reject(new Error(error)); else p.resolve(result);
  };
  function api(path, body) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      try { window.webkit.messageHandlers.wd.postMessage({ id: id, path: path, body: body === undefined ? null : body }); }
      catch (e) { delete pending[id]; reject(new Error("Workflow Detective isn’t responding. Reopen it from the menu bar.")); }
    });
  }
  window.WD_API = api;
  window.WD_SAVE = function (name, text) { return api("save", { name: name, text: text }); };
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
