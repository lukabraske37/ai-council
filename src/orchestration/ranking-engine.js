/**
 * RankingEngine — Scores and ranks responses from multiple AI providers.
 *
 * Scoring criteria (all 0–1, weighted by task type):
 *   - length         : More text = more thorough (up to a point)
 *   - structure      : Headers, lists, code blocks = better organized
 *   - confidence     : Absence of hedging language
 *   - speed          : Faster response = lighter weight bonus
 *   - code_quality   : If task is code, presence of code blocks
 *   - citations      : If task is factual, presence of references
 */
class RankingEngine {
  constructor() {
    // Weights per task type [length, structure, confidence, speed, codeQuality, citations]
    // IMPORTANT: each row MUST sum to exactly 1.00 or scores will be artificially capped.
    // BUG FIX: 'creative' was [0.30,0.15,0.10,0.05,0,0] = 0.60 — creative responses
    // could never score above 60/100. Fixed to [0.40,0.25,0.20,0.15,0,0] = 1.00.
    this.weights = {
      code     : [0.20, 0.25, 0.15, 0.10, 0.30, 0.00],  // sum = 1.00
      creative : [0.40, 0.25, 0.20, 0.15, 0.00, 0.00],  // sum = 1.00  ← FIXED (was 0.60)
      factual  : [0.25, 0.20, 0.15, 0.10, 0.00, 0.30],  // sum = 1.00
      analysis : [0.30, 0.25, 0.20, 0.05, 0.10, 0.10],  // sum = 1.00
      search   : [0.20, 0.15, 0.10, 0.15, 0.00, 0.40],  // sum = 1.00
      default  : [0.25, 0.20, 0.15, 0.10, 0.15, 0.15],  // sum = 1.00
    };
  }

  /**
   * Rank a list of response objects.
   * @param {Array} results — [{provider, label, text, timeMs, success}]
   * @param {string} taskType — 'code'|'creative'|'factual'|'analysis'|'search'|'default'
   * @returns {Array} results sorted by score descending, with .score and .breakdown added
   */
  rank(results, taskType = 'default') {
    const weights = this.weights[taskType] || this.weights.default;
    const successful = results.filter(r => r.success && r.text && r.text.length > 0);

    if (!successful.length) return results;

    // Normalize speed scores (lower timeMs = higher speed score)
    const maxTime = Math.max(...successful.map(r => r.timeMs));
    const minTime = Math.min(...successful.map(r => r.timeMs));
    const timeRange = maxTime - minTime || 1;

    const scored = successful.map(result => {
      const breakdown = {
        length      : this._scoreLength(result.text),
        structure   : this._scoreStructure(result.text),
        confidence  : this._scoreConfidence(result.text),
        speed       : 1 - ((result.timeMs - minTime) / timeRange),
        codeQuality : this._scoreCodeQuality(result.text),
        citations   : this._scoreCitations(result.text),
      };

      const score = (
        breakdown.length      * weights[0] +
        breakdown.structure   * weights[1] +
        breakdown.confidence  * weights[2] +
        breakdown.speed       * weights[3] +
        breakdown.codeQuality * weights[4] +
        breakdown.citations   * weights[5]
      );

      return {
        ...result,
        score     : Math.round(score * 100),
        breakdown : {
          length      : Math.round(breakdown.length * 100),
          structure   : Math.round(breakdown.structure * 100),
          confidence  : Math.round(breakdown.confidence * 100),
          speed       : Math.round(breakdown.speed * 100),
          codeQuality : Math.round(breakdown.codeQuality * 100),
          citations   : Math.round(breakdown.citations * 100),
        },
      };
    });

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    // Add rank positions
    scored.forEach((r, i) => { r.rank = i + 1; });

    // Failed responses go at the end unscored
    const failed = results.filter(r => !r.success || !r.text);
    return [...scored, ...failed.map(r => ({ ...r, score: 0, rank: scored.length + 1 }))];
  }

  // ── Scoring functions (all return 0–1) ──────────────────────────────────

  _scoreLength(text) {
    const len = text.trim().length;
    // Sweet spot: 500–3000 chars. Less = shallow. More starts to diminish.
    if (len < 100) return 0.1;
    if (len < 300) return 0.3;
    if (len < 500) return 0.5;
    if (len < 1500) return 0.75 + (len - 500) / 4000;
    if (len < 3000) return 1.0;
    // Penalize very long (might be padding)
    return Math.max(0.6, 1.0 - (len - 3000) / 10000);
  }

  _scoreStructure(text) {
    let score = 0;
    const checks = [
      [/^#{1,3}\s/m,           0.20],  // Markdown headers
      [/^\s*[-*•]\s/m,         0.15],  // Bullet lists
      [/^\d+\.\s/m,            0.15],  // Numbered lists
      [/```[\s\S]+?```/,       0.20],  // Code blocks
      [/\*\*[^*]+\*\*/,        0.10],  // Bold text
      [/\n\n/,                 0.10],  // Paragraph breaks
      [/^>/m,                  0.05],  // Blockquotes
      [/\|.+\|/,               0.05],  // Tables
    ];
    for (const [pattern, weight] of checks) {
      if (pattern.test(text)) score += weight;
    }
    return Math.min(1, score);
  }

  _scoreConfidence(text) {
    const hedges = [
      /\bi'm not sure\b/i, /\bi think\b/i, /\bperhaps\b/i,
      /\bmight be\b/i, /\bcould be wrong\b/i, /\bnot certain\b/i,
      /\bi apologize\b/i, /\bsomething like that\b/i,
    ];
    const positives = [
      /\bspecifically\b/i, /\bfor example\b/i, /\bto summarize\b/i,
      /\bin conclusion\b/i, /\bfirst[,:]?\s/i, /\bsecond[,:]?\s/i,
    ];
    let score = 0.6; // baseline
    for (const h of hedges)    if (h.test(text)) score -= 0.07;
    for (const p of positives) if (p.test(text)) score += 0.05;
    return Math.max(0, Math.min(1, score));
  }

  _scoreCodeQuality(text) {
    const codeBlocks = (text.match(/```[\s\S]+?```/g) || []);
    if (!codeBlocks.length) return 0;
    let score = Math.min(1, codeBlocks.length * 0.3);
    // Bonus for comments in code
    if (/\/\/|#\s|\/\*/.test(text)) score = Math.min(1, score + 0.2);
    return score;
  }

  _scoreCitations(text) {
    let score = 0;
    // URLs
    const urls = (text.match(/https?:\/\/[^\s)]+/g) || []).length;
    score += Math.min(0.4, urls * 0.1);
    // [1], [2] style references
    const refs = (text.match(/\[\d+\]/g) || []).length;
    score += Math.min(0.4, refs * 0.1);
    // "According to" / "Source:" style
    if (/according to|source:|via |from [A-Z]/i.test(text)) score += 0.2;
    return Math.min(1, score);
  }
}

module.exports = new RankingEngine(); // Singleton
