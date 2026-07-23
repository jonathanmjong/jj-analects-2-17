/**
 * Small, safe boolean-expression parser for the Rankings page's custom
 * formula filter. Deliberately hand-rolled instead of eval()/new Function()
 * — user input never becomes executable JS. Grammar:
 *
 *   expr       := orExpr
 *   orExpr     := andExpr ( "OR" andExpr )*
 *   andExpr    := notExpr ( "AND" notExpr )*
 *   notExpr    := "NOT" notExpr | comparison | "(" expr ")"
 *   comparison := IDENT ( ">" | "<" | ">=" | "<=" | "==" | "!=" ) NUMBER
 *   NUMBER     := digits ( "." digits )? ( "%" | "B" | "M" )?
 *
 * Field names are case-insensitive; a "%" suffix divides by 100, "B"/"M"
 * multiply by 1e9/1e6 (for market cap comparisons like `marketCap > 10B`).
 */

export const FORMULA_FIELDS = [
  "marketcap",
  "roic",
  "pettm",
  "evebitda",
  "dividendyield",
  "fcfyield",
  "revenuegrowth1y",
  "overallscore",
] as const;

export type FormulaContext = Record<string, number | null>;

type Comparator = ">" | "<" | ">=" | "<=" | "==" | "!=";

type FormulaNode =
  | { type: "and"; left: FormulaNode; right: FormulaNode }
  | { type: "or"; left: FormulaNode; right: FormulaNode }
  | { type: "not"; node: FormulaNode }
  | { type: "comparison"; field: string; comparator: Comparator; value: number };

export class FormulaError extends Error {}

interface Token {
  type: "ident" | "number" | "comparator" | "and" | "or" | "not" | "lparen" | "rparen" | "eof";
  value: string;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const isDigit = (c: string) => c >= "0" && c <= "9";
  const isIdentChar = (c: string) => /[a-zA-Z0-9_]/.test(c);

  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ type: "lparen", value: c });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ type: "rparen", value: c });
      i++;
      continue;
    }
    if (">=<!".includes(c)) {
      const two = input.slice(i, i + 2);
      if (two === ">=" || two === "<=" || two === "==" || two === "!=") {
        tokens.push({ type: "comparator", value: two });
        i += 2;
      } else if (c === ">" || c === "<") {
        tokens.push({ type: "comparator", value: c });
        i += 1;
      } else {
        throw new FormulaError(`Unexpected character '${c}' at position ${i}`);
      }
      continue;
    }
    if (isDigit(c) || (c === "-" && isDigit(input[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < input.length && (isDigit(input[j]) || input[j] === ".")) j++;
      let numStr = input.slice(i, j);
      if (input[j] === "%" || input[j] === "B" || input[j] === "M" || input[j] === "b" || input[j] === "m") {
        numStr += input[j];
        j++;
      }
      tokens.push({ type: "number", value: numStr });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < input.length && isIdentChar(input[j])) j++;
      const word = input.slice(i, j);
      const upper = word.toUpperCase();
      if (upper === "AND") tokens.push({ type: "and", value: word });
      else if (upper === "OR") tokens.push({ type: "or", value: word });
      else if (upper === "NOT") tokens.push({ type: "not", value: word });
      else tokens.push({ type: "ident", value: word });
      i = j;
      continue;
    }
    throw new FormulaError(`Unexpected character '${c}' at position ${i}`);
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}

function parseNumberLiteral(raw: string): number {
  const suffix = raw.slice(-1);
  if (suffix === "%") return Number.parseFloat(raw.slice(0, -1)) / 100;
  if (suffix === "B" || suffix === "b") return Number.parseFloat(raw.slice(0, -1)) * 1e9;
  if (suffix === "M" || suffix === "m") return Number.parseFloat(raw.slice(0, -1)) * 1e6;
  return Number.parseFloat(raw);
}

class Parser {
  private pos = 0;
  private tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }
  private next(): Token {
    return this.tokens[this.pos++];
  }
  private expect(type: Token["type"]): Token {
    const t = this.next();
    if (t.type !== type) throw new FormulaError(`Expected ${type} but got '${t.value || "end of input"}'`);
    return t;
  }

  parseExpr(): FormulaNode {
    const node = this.parseOr();
    this.expect("eof");
    return node;
  }

  private parseOr(): FormulaNode {
    let left = this.parseAnd();
    while (this.peek().type === "or") {
      this.next();
      const right = this.parseAnd();
      left = { type: "or", left, right };
    }
    return left;
  }

  private parseAnd(): FormulaNode {
    let left = this.parseNot();
    while (this.peek().type === "and") {
      this.next();
      const right = this.parseNot();
      left = { type: "and", left, right };
    }
    return left;
  }

  private parseNot(): FormulaNode {
    if (this.peek().type === "not") {
      this.next();
      return { type: "not", node: this.parseNot() };
    }
    return this.parseAtom();
  }

  private parseAtom(): FormulaNode {
    if (this.peek().type === "lparen") {
      this.next();
      const node = this.parseOr();
      this.expect("rparen");
      return node;
    }
    const fieldToken = this.expect("ident");
    const field = fieldToken.value.toLowerCase();
    if (!FORMULA_FIELDS.includes(field as (typeof FORMULA_FIELDS)[number])) {
      throw new FormulaError(
        `Unknown field '${fieldToken.value}'. Available: ${FORMULA_FIELDS.join(", ")}`,
      );
    }
    const comparator = this.expect("comparator").value as Comparator;
    const numberToken = this.expect("number");
    return { type: "comparison", field, comparator, value: parseNumberLiteral(numberToken.value) };
  }
}

/** Throws FormulaError on invalid syntax or unknown fields — callers should catch and show the message. */
export function parseFormula(input: string): FormulaNode {
  const trimmed = input.trim();
  if (!trimmed) throw new FormulaError("Formula is empty");
  return new Parser(tokenize(trimmed)).parseExpr();
}

export function evaluateFormula(node: FormulaNode, context: FormulaContext): boolean {
  switch (node.type) {
    case "and":
      return evaluateFormula(node.left, context) && evaluateFormula(node.right, context);
    case "or":
      return evaluateFormula(node.left, context) || evaluateFormula(node.right, context);
    case "not":
      return !evaluateFormula(node.node, context);
    case "comparison": {
      const actual = context[node.field];
      if (actual === null || actual === undefined) return false; // missing data never matches a formula condition
      switch (node.comparator) {
        case ">":
          return actual > node.value;
        case "<":
          return actual < node.value;
        case ">=":
          return actual >= node.value;
        case "<=":
          return actual <= node.value;
        case "==":
          return actual === node.value;
        case "!=":
          return actual !== node.value;
      }
    }
  }
}
