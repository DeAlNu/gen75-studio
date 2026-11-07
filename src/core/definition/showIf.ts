/**
 * Evaluator ekspresi showIf milik definisi VIA, mis.
 * "{id_qmk_rgb_matrix_effect} != 0 && {id_qmk_rgb_matrix_effect} != 24".
 * Sengaja tidak memakai eval atau Function.
 */

type Token = { t: 'num'; v: number } | { t: 'ref'; id: string } | { t: 'op'; v: string };

type Getter = (id: string) => number;
type Node = (get: Getter) => number;

const OPERATORS = ['&&', '||', '==', '!=', '<=', '>=', '<', '>', '!', '(', ')'];

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) throw new Error('showIf: kurung kurawal tidak ditutup');
      const id = src.slice(i + 1, end).trim();
      if (!/^\w+$/.test(id)) throw new Error(`showIf: nama nilai tidak valid "${id}"`);
      out.push({ t: 'ref', id });
      i = end + 1;
    } else if (/\d/.test(ch)) {
      let j = i;
      while (j < src.length && /[\d.]/.test(src[j] as string)) j += 1;
      out.push({ t: 'num', v: Number(src.slice(i, j)) });
      i = j;
    } else {
      const op = OPERATORS.find((o) => src.startsWith(o, i));
      if (!op) throw new Error(`showIf: karakter tidak dikenal "${ch}"`);
      out.push({ t: 'op', v: op });
      i += op.length;
    }
  }
  return out;
}

export function compileShowIf(src: string): (get: Getter) => boolean {
  const tokens = tokenize(src);
  let pos = 0;

  const isOp = (v: string): boolean => {
    const tk = tokens[pos];
    return tk !== undefined && tk.t === 'op' && tk.v === v;
  };

  function parseOr(): Node {
    let left = parseAnd();
    while (isOp('||')) {
      pos += 1;
      const l = left;
      const r = parseAnd();
      left = (g) => (l(g) !== 0 || r(g) !== 0 ? 1 : 0);
    }
    return left;
  }

  function parseAnd(): Node {
    let left = parseCompare();
    while (isOp('&&')) {
      pos += 1;
      const l = left;
      const r = parseCompare();
      left = (g) => (l(g) !== 0 && r(g) !== 0 ? 1 : 0);
    }
    return left;
  }

  function parseCompare(): Node {
    const left = parseUnary();
    for (const op of ['==', '!=', '<=', '>=', '<', '>']) {
      if (isOp(op)) {
        pos += 1;
        const right = parseUnary();
        return (g) => {
          const a = left(g);
          const b = right(g);
          switch (op) {
            case '==':
              return a === b ? 1 : 0;
            case '!=':
              return a !== b ? 1 : 0;
            case '<=':
              return a <= b ? 1 : 0;
            case '>=':
              return a >= b ? 1 : 0;
            case '<':
              return a < b ? 1 : 0;
            default:
              return a > b ? 1 : 0;
          }
        };
      }
    }
    return left;
  }

  function parseUnary(): Node {
    if (isOp('!')) {
      pos += 1;
      const inner = parseUnary();
      return (g) => (inner(g) === 0 ? 1 : 0);
    }
    return parsePrimary();
  }

  function parsePrimary(): Node {
    const tk = tokens[pos];
    if (!tk) throw new Error('showIf: ekspresi berakhir terlalu cepat');
    pos += 1;
    if (tk.t === 'num') {
      const v = tk.v;
      return () => v;
    }
    if (tk.t === 'ref') {
      const id = tk.id;
      return (g) => g(id);
    }
    if (tk.v === '(') {
      const inner = parseOr();
      if (!isOp(')')) throw new Error('showIf: kurung tutup tidak ditemukan');
      pos += 1;
      return inner;
    }
    throw new Error(`showIf: operator tidak terduga "${tk.v}"`);
  }

  const root = parseOr();
  if (pos !== tokens.length) throw new Error('showIf: ada sisa ekspresi yang tidak terbaca');
  return (get) => root(get) !== 0;
}
