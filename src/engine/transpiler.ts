import { transform } from 'sucrase';

export interface TranspileResult {
  success: boolean;
  jsCode: string;
  sourceMap?: string;
  errors: string[];
}

const FORBIDDEN_PATTERNS = [
  { pattern: /\bprocess\b/, name: 'process' },
  { pattern: /\bchild_process\b/, name: 'child_process' },
  { pattern: /\bfs\b/, name: 'fs' },
  { pattern: /\bnet\b/, name: 'net' },
  { pattern: /\bhttp\b/, name: 'http' },
  { pattern: /\bhttps\b/, name: 'https' },
  { pattern: /\brequire\s*\(/, name: 'require()' },
  { pattern: /\bimport\s*\(/, name: 'dynamic import()' },
  { pattern: /\beval\s*\(/, name: 'eval()' },
  { pattern: /\bFunction\s*\(/, name: 'Function() constructor' },
  { pattern: /\bglobalThis\b/, name: 'globalThis' },
  { pattern: /\bwindow\b/, name: 'window' },
  { pattern: /\bdocument\b/, name: 'document' },
  { pattern: /\bfetch\s*\(/, name: 'fetch()' },
  { pattern: /\bWebSocket\b/, name: 'WebSocket' },
  { pattern: /\bXMLHttpRequest\b/, name: 'XMLHttpRequest' },
];

/**
 * Fast AST pre-pass to check for forbidden tokens before saving or running code
 */
export function validateStrategyAST(tsCode: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const item of FORBIDDEN_PATTERNS) {
    if (item.pattern.test(tsCode)) {
      errors.push(`Forbidden token or API detected: '${item.name}'. Sandboxed strategies cannot access host runtime or external APIs.`);
    }
  }

  // Syntax check via dry-run transform
  try {
    transform(tsCode, {
      transforms: ['typescript', 'imports'],
    });
  } catch (err: any) {
    errors.push(`Syntax error in strategy code: ${err?.message || err}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Transpiles TypeScript strategy code into clean CommonJS JavaScript with source maps for QuickJS
 */
export function transpileStrategyCode(tsCode: string): TranspileResult {
  const astCheck = validateStrategyAST(tsCode);
  if (!astCheck.isValid) {
    return {
      success: false,
      jsCode: '',
      errors: astCheck.errors,
    };
  }

  try {
    const result = transform(tsCode, {
      transforms: ['typescript', 'imports'],
      sourceMapOptions: {
        compiledFilename: 'strategy.js',
      },
      filePath: 'strategy.ts',
    });

    return {
      success: true,
      jsCode: result.code,
      sourceMap: result.sourceMap ? JSON.stringify(result.sourceMap) : undefined,
      errors: [],
    };
  } catch (err: any) {
    return {
      success: false,
      jsCode: '',
      errors: [`Transpilation failed: ${err?.message || err}`],
    };
  }
}
