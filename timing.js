// Mapping values are browser media times, never raw container PTS or duration ratios.
export class PairClock {
  constructor(sample, mapping = null) {
    this.mode = sample.timing.mode;
    this.durations = {human: sample.human.duration_s, g1: sample.g1.duration_s};
    if (this.mode === 'shared_output_clock') {
      this.range = sample.timing.valid_interval_s || [0, Math.min(...Object.values(this.durations))];
      this.points = this.range.map(t => ({t, human_s: t, g1_s: t}));
    } else if (this.mode === 'mapped' && mapping?.schema_version === 1 && mapping.interpolation === 'linear') {
      this.range = mapping.valid_interval_s;
      this.points = mapping.points;
    } else throw new Error('不支持的配对时间映射');
    if (!Array.isArray(this.points) || this.points.length < 2 || !Array.isArray(this.range) || this.range.length !== 2) throw new Error('时间映射不完整');
    for (const field of ['t', 'human_s', 'g1_s']) {
      this.points.forEach((p, i) => {
        if (!Number.isFinite(p[field]) || (i && p[field] <= this.points[i-1][field])) throw new Error('时间映射须有限且严格递增');
      });
    }
    if (this.range[0] !== this.points[0].t || this.range[1] !== this.points.at(-1).t) throw new Error('映射有效区间不匹配');
    for (const side of ['human','g1']) {
      if (this.points[0][side+'_s'] < 0 || this.points.at(-1)[side+'_s'] > this.durations[side] + 0.00001) throw new Error('映射超出媒体时段');
      for (let i=1;i<this.points.length;i++) {
        const a=this.points[i-1], b=this.points[i], rate=(b[side+'_s']-a[side+'_s'])/(b.t-a.t);
        if (rate < .0625 || rate > 16) throw new Error('映射播放速率超出浏览器范围');
      }
    }
  }
  segment(field, value) {
    if (!Number.isFinite(value) || value < this.points[0][field] || value > this.points.at(-1)[field]) return null;
    for (let i=1;i<this.points.length;i++) if (value <= this.points[i][field]) return [this.points[i-1],this.points[i]];
    return null;
  }
  convert(from, to, value) {
    const pair=this.segment(from,value); if (!pair) return null;
    const [a,b]=pair; return a[to]+(value-a[from])*(b[to]-a[to])/(b[from]-a[from]);
  }
  toMedia(side, t) { return this.convert('t',side+'_s',t); }
  fromMedia(side, seconds) { return this.convert(side+'_s','t',seconds); }
  rate(side,t) { const p=this.segment('t',t);return p ? (p[1][side+'_s']-p[0][side+'_s'])/(p[1].t-p[0].t) : 1; }
}
