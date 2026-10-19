// Windows-app version of the activity-log module. Same exports as the extension's lib/db.js,
// but the log lives in the local app (on this computer) and is reached through its local API.
const api = (p, b) => window.WD_API(p, b);

export const addEvent = async () => {};
export const allEvents = () => api("events");
export const countSince = async t => (await api("events")).filter(e => e.t >= t).length;
export const deleteIds = ids => api("events/delete", { ids });
export const clearAll = () => api("events/clear", {});
export const deleteWhere = async pred => {
  const ids = (await api("events")).filter(pred).map(e => e.id);
  return ids.length ? api("events/delete", { ids }) : null;
};
