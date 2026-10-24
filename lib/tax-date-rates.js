// Round 62: recurring day/month seasons plus preserved legacy exact-date rates.
// Stay dates are UTC calendar nights; checkout is excluded.
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
  function validMonthDay(value) {
    return typeof value === 'string' && /^\d{2}-\d{2}$/.test(value) && validDate('2000-' + value);
  }
  function parseInput(value) {
    if (typeof value !== 'string') return value;
    const match = /^(\d{2})\/(\d{2})$/.exec(value.trim());
    return match ? match[2] + '-' + match[1] : value.trim();
  }
  function inputValue(value) {
    return validMonthDay(value) ? value.slice(3) + '/' + value.slice(0,2) : value;
  }
  function annual(p) { return [p.from,p.to].some(validMonthDay); }
  function matches(p, night) {
    if (annual(p)) {
      const day = night.slice(5), from = p.from || '01-01', to = p.to || '12-31';
      return from <= to ? day >= from && day <= to : day >= from || day <= to;
    }
    return (!p.from || night >= p.from) && (!p.to || night <= p.to);
  }
  function intersects(a,b) {
    if (annual(a) && annual(b)) {
      const split = p => {
        const from=p.from || '01-01',to=p.to || '12-31';
        return from<=to ? [[from,to]] : [[from,'12-31'],['01-01',to]];
      };
      return split(a).some(x=>split(b).some(y=>x[0]<=y[1] && x[1]>=y[0]));
    }
    if (!annual(a) && !annual(b)) return (a.from || '0000-01-01') <= (b.to || '9999-12-31') && (b.from || '0000-01-01') <= (a.to || '9999-12-31');
    const season=annual(a)?a:b, dated=annual(a)?b:a;
    if (!dated.from || !dated.to) return true;
    const start=Date.parse(dated.from),end=Date.parse(dated.to);
    // Include eight years (including century leap-day gaps) so a Feb29-only season stays exact.
    for(let ms=start;ms<=Math.min(end,start+2928*dayMs);ms+=dayMs) {
      if(matches(season,new Date(ms).toISOString().slice(0,10))) return true;
    }
    return false;
  }
  function validate(periods) {
    const ranges = [];
    for (const p of periods) {
      if (!p || p.rate == null || p.rate === '' || !Number.isFinite(Number(p.rate)) || Number(p.rate) < 0) return 'rate';
      const yearly=annual(p),valid=yearly?validMonthDay:validDate;
      if ((p.from && !valid(p.from)) || (p.to && !valid(p.to))) return 'date';
      if (!p.main && (!p.from || !p.to)) return 'dates_required';
      if (!yearly && p.from && p.to && p.from > p.to) return 'order';
      if (p.main && !p.from && !p.to) continue;
      if (ranges.some(r=>intersects(r,p))) return 'overlap';
      ranges.push(p);
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
      const period = cfg.ratePeriods.find(p => (p.from || p.to) && matches(p,night));
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
  return {validDate, validMonthDay, parseInput, inputValue, annual, matches, validate, compute};
});
