/**
 * SAFE tool: arithmetic calculator.
 * Deliberately implemented as a recursive-descent parser — NO eval(), NO
 * Function() — so model-supplied expressions can never execute code.
 */

import { Tool, toolResultOk, toolResultErr } from '../../../src/core/tools/types';

class Parser {
  private pos = 0;
  constructor(private src: string) {}

  parse(): number {
    const value = this.expr();
    this.skipWs();
    if (this.pos < this.src.length) {
      throw new Error(`Unexpected character "${this.src[this.pos]}" at position ${this.pos}.`);
    }
    return value;
  }

  private skipWs(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }

  private expr(): number {
    let value = this.term();
    for (;;) {
      this.skipWs();
      const ch = this.src[this.pos];
      if (ch === '+') {
        this.pos++;
        value += this.term();
      } else if (ch === '-') {
        this.pos++;
        value -= this.term();
      } else {
        return value;
      }
    }
  }

  private term(): number {
    let value = this.power();
    for (;;) {
      this.skipWs();
      const ch = this.src[this.pos];
      if (ch === '*') {
        this.pos++;
        value *= this.power();
      } else if (ch === '/') {
        this.pos++;
        const divisor = this.power();
        if (divisor === 0) throw new Error('Division by zero.');
        value /= divisor;
      } else if (ch === '%') {
        this.pos++;
        value %= this.power();
      } else {
        return value;
      }
    }
  }

  private power(): number {
    const base = this.unary();
    this.skipWs();
    if (this.src[this.pos] === '^') {
      this.pos++;
      return Math.pow(base, this.power());
    }
    return base;
  }

  private unary(): number {
    this.skipWs();
    if (this.src[this.pos] === '-') {
      this.pos++;
      return -this.unary();
    }
    if (this.src[this.pos] === '+') {
      this.pos++;
      return this.unary();
    }
    return this.atom();
  }

  private atom(): number {
    this.skipWs();
    const ch = this.src[this.pos];
    if (ch === '(') {
      this.pos++;
      const value = this.expr();
      this.skipWs();
      if (this.src[this.pos] !== ')') throw new Error('Missing closing parenthesis.');
      this.pos++;
      return value;
    }
    // Function names / constants
    const fnMatch = /^(sqrt|abs|round|floor|ceil|log|ln|sin|cos|tan|pi|e)\b/i.exec(
      this.src.slice(this.pos)
    );
    if (fnMatch) {
      const name = fnMatch[1].toLowerCase();
      this.pos += name.length;
      if (name === 'pi') return Math.PI;
      if (name === 'e') return Math.E;
      this.skipWs();
      if (this.src[this.pos] !== '(') throw new Error(`Expected "(" after ${name}.`);
      this.pos++;
      const arg = this.expr();
      this.skipWs();
      if (this.src[this.pos] !== ')') throw new Error('Missing closing parenthesis.');
      this.pos++;
      switch (name) {
        case 'sqrt':
          if (arg < 0) throw new Error('sqrt of negative number.');
          return Math.sqrt(arg);
        case 'abs':
          return Math.abs(arg);
        case 'round':
          return Math.round(arg);
        case 'floor':
          return Math.floor(arg);
        case 'ceil':
          return Math.ceil(arg);
        case 'log':
          return Math.log10(arg);
        case 'ln':
          return Math.log(arg);
        case 'sin':
          return Math.sin(arg);
        case 'cos':
          return Math.cos(arg);
        case 'tan':
          return Math.tan(arg);
      }
    }
    const numMatch = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(this.src.slice(this.pos));
    if (numMatch) {
      this.pos += numMatch[0].length;
      return parseFloat(numMatch[0]);
    }
    throw new Error(`Unexpected character "${ch || 'end of input'}" at position ${this.pos}.`);
  }
}

export const calculatorTool: Tool<{ expression: string }> = {
  id: 'math.calculate',
  description:
    'Evaluate an arithmetic expression precisely. Supports + - * / % ^ parentheses and functions: sqrt, abs, round, floor, ceil, log, ln, sin, cos, tan, plus constants pi and e. Use for any non-trivial arithmetic instead of estimating.',
  inputSchema: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'The arithmetic expression, e.g. "(145*38)/sqrt(16)".' },
    },
    required: ['expression'],
  },
  permission: 'SAFE',
  platforms: ['server'],
  timeoutMs: 2000,
  async execute(input) {
    const expr = String(input.expression || '').slice(0, 500);
    if (!expr.trim()) return toolResultErr('invalid_input', 'Expression is empty.');
    try {
      const value = new Parser(expr).parse();
      if (!Number.isFinite(value)) {
        return toolResultErr('math_error', 'Expression did not produce a finite number.');
      }
      return toolResultOk({ expression: expr, result: value });
    } catch (err: any) {
      return toolResultErr('parse_error', err?.message || 'Could not evaluate expression.');
    }
  },
};
