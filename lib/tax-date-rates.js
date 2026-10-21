// Round 62: date-specific base rates. Plain dates are UTC calendar nights.
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TaxDateRates = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const dayMs = 86400000;
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const ms = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,10) === value;
  }
  function validate(periods) {
    const ranges = [];
    for (const p of periods) {
      if (!p || p.rate == null || p.rate === '' || !Number.isFinite(Number(p.rate)) || Number(p.rate) < 0) return 'rate';
      if ((p.from && !validDate(p.from)) || (p.to && !validDate(p.to))) return 'date';
      if (!p.main && (!p.from || !p.to)) return 'dates_required';
      if (p.from && p.to && p.from > p.to) return 'order';
      // The undated main row is a fallback, rather than an overlapping period.
      if (p.main && !p.from && !p.to) continue;
      const from = p.from || '0000-01-01', to = p.to || '9999-12-31';
      if (ranges.some(r => from <= r.to && to >= r.from)) return 'overlap';
      ranges.push({from,to});
    }
    return null;
  }
  function compute(checkin, cfg, ctx, singleRate) {
    const error = validate(cfg.ratePeriods);
    if (error) throw new Error('Invalid tourist-tax periods: ' + error);
    const arrival = String(ctx.arrivalISO || checkin.arrival_date || '').split('T')[0];
    if (!validDate(arrival)) throw new Error('Tourist-tax periods require a valid arrival date');
    const departure = String(checkin.departure_date || '').split('T')[0];
    if (departure && (!validDate(departure) || departure < arrival)) throw new Error('Invalid departure date');
    const nights = departure ? Math.round((Date.parse(departure)-Date.parse(arrival))/dayMs)
      : Math.max(0, Math.floor(Number(checkin.nights ?? ctx.nightsInPeriod) || 0));
    if (nights > 36600) throw new Error('Invalid stay length');
    const result = {guest: `${checkin.surname || ''} ${checkin.name || ''}`.trim() || '—',
      nights_in_period:0,taxable_nights:0,over_cap_nights:0,rule_exempt_nights:0,
      rule_applied:null,declared_applied:null,effective_rate:0,amount:0,
      requires_documentation:false,rate_breakdown:[]};
    const counts = new Map();
    let chargedCents = 0, totalRate = 0;
    const datedMain = cfg.ratePeriods.some(p => p.main && (p.from || p.to));
    for (let i=0;i<nights;i++) {
      const night = new Date(Date.parse(arrival)+i*dayMs).toISOString().slice(0,10);
      const inPeriod = (!ctx.periodStart || night >= ctx.periodStart) && (!ctx.periodEnd || night <= ctx.periodEnd)
        && (ctx.periodStart || ctx.periodEnd || i < ctx.nightsInPeriod);
      const period = cfg.ratePeriods.find(p => (p.from || p.to) && (!p.from || night >= p.from) && (!p.to || night <= p.to));
      const rate = period ? Number(period.rate) : (datedMain ? 0 : (cfg.baseRate ?? 0));
      const bucket = cfg.basis === 'per_person_per_month' ? night.slice(0,7)
        : cfg.basis === 'per_person_per_year' ? night.slice(0,4) : 'stay';
      const used = counts.get(bucket) || 0;
      // Out-of-season and explicit zero-rate nights consume no taxable allowance.
      const overCap = rate > 0 && cfg.cap != null && used >= cfg.cap;
      if (rate > 0) counts.set(bucket, used+1);
      const row = singleRate(checkin, {...cfg,ratePeriods:[],baseRate:rate,cap:null,totalCap:null},
        {...ctx,nightsInPeriod:1,ruleNights:ctx.nightsInPeriod,arrivalISO:arrival});
      if (rate === 0) row.effective_rate = 0;
      let cents = overCap || rate === 0 ? 0 : Math.round(row.amount*100);
      if (cfg.totalCap != null) cents = Math.min(cents, Math.max(0,Math.round(cfg.totalCap*100)-chargedCents));
      chargedCents += cents;
      if (!inPeriod) continue;
      result.nights_in_period++;
      result.over_cap_nights += overCap ? 1 : 0;
      result.taxable_nights += !overCap && rate > 0 ? row.taxable_nights : 0;
      result.rule_exempt_nights += !overCap ? (rate === 0 ? 1 : row.rule_exempt_nights) : 0;
      result.rule_applied = row.rule_applied || result.rule_applied;
      result.declared_applied = row.declared_applied || result.declared_applied;
      result.requires_documentation ||= row.requires_documentation;
      result.amount += cents;
      if (!overCap && row.taxable_nights && rate > 0) totalRate += row.effective_rate;
      const last = result.rate_breakdown[result.rate_breakdown.length-1];
      if (last && last.rate === row.effective_rate && last.over_cap === overCap) {
        last.to=night;last.nights++;last.amount+=cents;
      } else result.rate_breakdown.push({from:night,to:night,rate:row.effective_rate,over_cap:overCap,nights:1,amount:cents});
    }
    result.amount /= 100;
    result.effective_rate = result.taxable_nights ? totalRate/result.taxable_nights : 0;
    result.rate_breakdown.forEach(b=>b.amount/=100);
    return result;
  }
  return {validDate, validate, compute};
});
