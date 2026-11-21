/**
 * Feed validation, run in the feed worker one step per call so other worker
 * calls are served between steps.
 */

import type { EditorFeed } from '../feed/editor-feed';
import type { ValidationResults } from '../feed/feed-validate';

export type {
  ValidationEntity,
  ValidationResults,
} from '../feed/feed-validate';

function emptyResults(): ValidationResults {
  return {
    errors: [],
    warnings: [],
    info: [],
    summary: { isValid: true, errorCount: 0, warningCount: 0, infoCount: 0 },
  };
}

export class GTFSValidator {
  constructor(private feed: EditorFeed) {}

  async validateFeed(): Promise<ValidationResults> {
    if (!this.feed.isOpen) {
      return emptyResults();
    }
    const t0 = performance.now();
    let steps = 0;
    for (;;) {
      const step = await this.feed.validateStep();
      steps++;
      if (step.done) {
        console.log(
          `[GTFSValidator] ${step.results.summary.errorCount} errors, ${step.results.summary.warningCount} warnings after ${steps} step(s) in ${Math.round(performance.now() - t0)}ms`
        );
        return step.results;
      }
    }
  }
}
