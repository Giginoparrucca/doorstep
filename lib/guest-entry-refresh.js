// Refresh only from server projections. Timers/signals invalidate; they never unlock.
(function(root) {
  function create(o) {
    let generation = 0, timer = null;
    const clock = o.clock || Date.now;
    const later = o.setTimer || setTimeout, cancel = o.clearTimer || clearTimeout;
    function invalidate() {
      generation++;
      if (timer !== null) cancel(timer);
      timer = null;
      o.clear();
    }
    function schedule(releaseAt) {
      const until = Date.parse(releaseAt) - clock();
      const delay = Number.isFinite(until) && until > 0 ? Math.min(60000, Math.max(1000, until + 250)) : 60000;
      timer = later(() => { timer = null; refresh(); }, delay);
    }
    async function refresh() {
      invalidate();
      const mine = generation, scope = o.scope();
      if (!scope || !o.visible()) return false;
      let timeout;
      try {
        const result = await Promise.race([o.load(), new Promise((_, reject) => {
          timeout = later(() => reject(new Error('entry_refresh_timeout')), 15000);
        })]);
        if (mine !== generation || scope !== o.scope() || !o.visible()) return false;
        if (!result?.ok || !result.data?.property || !result.data.entry_release) throw new Error('entry_refresh_failed');
        o.apply(result);
        schedule(result.data.entry_release.release_at);
        return true;
      } catch (_) {
        if (mine === generation && scope === o.scope() && o.visible()) {
          o.clear();
          schedule(null);
        }
        return false;
      } finally { if (timeout !== undefined) cancel(timeout); }
    }
    return { refresh, invalidate };
  }
  root.GuestEntryRefresh = Object.freeze({ create });
})(typeof window === 'undefined' ? globalThis : window);
