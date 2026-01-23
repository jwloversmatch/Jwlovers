class SocketRateLimiter {
  constructor() {
    this.limits = new Map();
    this.metrics = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  check(userId, eventType, limit, windowMs, roomId = null) {
    const now = Date.now();
    const key = roomId ? `${userId}:${eventType}:${roomId}` : `${userId}:${eventType}`;
    
    let userLimits = this.limits.get(key);
    if (!userLimits) {
      userLimits = { count: 0, reset: now + windowMs };
      this.limits.set(key, userLimits);
    }

    if (now > userLimits.reset) {
      userLimits.count = 0;
      userLimits.reset = now + windowMs;
    }

    if (userLimits.count >= limit) {
      this.trackRateLimit(userId, eventType);
      return false;
    }

    userLimits.count++;
    return true;
  }

  trackRateLimit(userId, eventType) {
    const key = `${userId}:${eventType}`;
    const current = this.metrics.get(key) || 0;
    this.metrics.set(key, current + 1);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, limits] of this.limits.entries()) {
      if (now > limits.reset) {
        this.limits.delete(key);
      }
    }
    
    if (this.metrics.size > 1000) {
      const entries = Array.from(this.metrics.entries());
      this.metrics = new Map(entries.slice(-1000));
    }
  }

  getMetrics() {
    return Array.from(this.metrics.entries()).map(([key, count]) => ({
      key,
      count
    }));
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.limits.clear();
    this.metrics.clear();
  }
}

module.exports = SocketRateLimiter;