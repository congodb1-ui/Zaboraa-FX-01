import { describe, it, expect } from 'vitest';
import { runKnownAnswerSelfTests } from '../knownAnswerTests';

describe('Zaboraa FX Backtesting Engine Known-Answer Tests', () => {
  const tests = runKnownAnswerSelfTests();

  for (const t of tests) {
    it(`${t.category}: ${t.name}`, () => {
      expect(t.passed).toBe(true);
      if (!t.passed) {
        throw new Error(`Test failed: Expected ${t.expected}, but got ${t.actual}`);
      }
    });
  }
});
