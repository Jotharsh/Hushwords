// Clock maths for countdowns. Pure, so it can be tested without a browser.

/** Estimates how far the host's clock is ahead of ours, from ping/pong round trips. */
export class ClockSync {
  constructor(keep = 8) { this.keep = keep; this.samples = []; this.offset = 0; this.rtt = null; }

  /** sent and received are our own clock; hostTime is the host's clock when it answered. */
  addSample(sent, hostTime, received) {
    const rtt = received - sent;
    if (!(rtt >= 0) || rtt > 5000) return;                       // a stalled reply says nothing useful
    this.samples.push({ rtt, offset: hostTime + rtt / 2 - received });
    if (this.samples.length > this.keep) this.samples.shift();
    // The quickest round trips are the least distorted by queueing, so trust the best three.
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 3).map((s) => s.offset).sort((a, b) => a - b);
    this.offset = best[Math.floor(best.length / 2)];
    this.rtt = Math.min(...this.samples.map((s) => s.rtt));
  }

  hostNow(ownNow = Date.now()) { return ownNow + this.offset; }
}

