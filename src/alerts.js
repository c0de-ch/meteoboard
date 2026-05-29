/**
 * Edge-triggered threshold alerting.
 *
 * Evaluates configured rules against incoming readings and reports only state
 * *changes* (a rule becoming active, or clearing) so clients aren't spammed on
 * every reading. The current set of active alerts can be snapshotted for newly
 * connected clients.
 */

function test(op, value, threshold) {
  switch (op) {
    case 'lte': return value <= threshold;
    case 'gte': return value >= threshold;
    case 'lt':  return value < threshold;
    case 'gt':  return value > threshold;
    case 'eq':  return value === threshold;
    default:    return false;
  }
}

class AlertManager {
  constructor(rules = []) {
    this.rules = rules;
    this.active = {}; // key -> { key, label, severity, sensor, value, since }
  }

  /**
   * Evaluate a reading and return the list of alert state changes (edges).
   * Each change is { key, label, severity, sensor, value, active }.
   */
  evaluate(sensor, value, timestamp) {
    const changes = [];
    for (const rule of this.rules) {
      if (rule.sensor !== sensor) continue;
      const triggered = test(rule.op, value, rule.value);
      const wasActive = this.active[rule.key] !== undefined;

      if (triggered && !wasActive) {
        const alert = {
          key: rule.key,
          label: rule.label,
          severity: rule.severity || 'warning',
          sensor,
          value,
          since: timestamp,
        };
        this.active[rule.key] = alert;
        changes.push({ ...alert, active: true });
      } else if (!triggered && wasActive) {
        const cleared = this.active[rule.key];
        delete this.active[rule.key];
        changes.push({ ...cleared, value, active: false });
      } else if (triggered) {
        // Still active — refresh the latest value, no edge emitted.
        this.active[rule.key].value = value;
      }
    }
    return changes;
  }

  snapshot() {
    return Object.values(this.active).map((a) => ({ ...a, active: true }));
  }
}

module.exports = AlertManager;
