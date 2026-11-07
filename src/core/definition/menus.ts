import { compileShowIf } from './showIf';
import type { MenuControl, MenuGroup, MenuNode, ValueRef } from './types';

type Rec = Record<string, unknown>;

function rec(v: unknown, what: string): Rec {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what} harus berupa objek`);
  return v as Rec;
}

function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${what} harus berupa angka`);
  return v;
}

function parseRef(content: unknown[], label: string): ValueRef {
  const [id, channel, valueId] = content;
  if (typeof id !== 'string') throw new Error(`menu "${label}": id nilai tidak valid`);
  return { id, channel: num(channel, `${label}.channel`), valueId: num(valueId, `${label}.valueId`) };
}

function parseDropdownOptions(raw: unknown, label: string): { label: string; value: number }[] {
  if (!Array.isArray(raw)) throw new Error(`menu "${label}": options dropdown harus array`);
  return raw.map((o, i) => {
    if (typeof o === 'string') return { label: o, value: i };
    if (Array.isArray(o) && typeof o[0] === 'string') return { label: o[0], value: num(o[1], `${label}.options`) };
    throw new Error(`menu "${label}": opsi dropdown ke-${i} tidak valid`);
  });
}

function parseNode(raw: unknown): MenuNode {
  const r = rec(raw, 'menu');
  if (typeof r.label !== 'string') throw new Error('menu tanpa label');
  const label = r.label;
  const showIf = typeof r.showIf === 'string' ? r.showIf : null;
  if (showIf) compileShowIf(showIf);
  const content = r.content;
  if (!Array.isArray(content)) throw new Error(`menu "${label}" tidak punya content`);

  if (typeof content[0] === 'string') {
    const ref = parseRef(content, label);
    switch (r.type) {
      case 'range': {
        if (!Array.isArray(r.options)) throw new Error(`menu "${label}": options range harus array`);
        return { kind: 'range', label, showIf, ref, min: num(r.options[0], label), max: num(r.options[1], label) };
      }
      case 'dropdown':
        return { kind: 'dropdown', label, showIf, ref, options: parseDropdownOptions(r.options, label) };
      case 'color':
        return { kind: 'color', label, showIf, ref };
      case 'toggle':
        return { kind: 'toggle', label, showIf, ref };
      default:
        throw new Error(`menu "${label}": tipe kontrol "${String(r.type)}" belum didukung`);
    }
  }
  return { kind: 'group', label, showIf, items: content.map(parseNode) };
}

export function parseMenus(raw: unknown): MenuGroup[] {
  if (!Array.isArray(raw)) throw new Error('menus harus berupa array');
  return raw.map((m) => {
    const node = parseNode(m);
    if (node.kind !== 'group') throw new Error('menu tingkat atas harus berupa grup');
    return node;
  });
}

export function controlsOf(nodes: readonly MenuNode[]): MenuControl[] {
  const out: MenuControl[] = [];
  for (const n of nodes) {
    if (n.kind === 'group') out.push(...controlsOf(n.items));
    else out.push(n);
  }
  return out;
}

/** Jumlah byte nilai di perangkat: warna = hue + saturasi, rentang besar = 2 byte. */
export function valueByteLength(c: MenuControl): number {
  if (c.kind === 'color') return 2;
  if (c.kind === 'range' && c.max > 255) return 2;
  return 1;
}

const compiled = new Map<string, ReturnType<typeof compileShowIf>>();

export function isVisible(node: MenuNode, get: (id: string) => number): boolean {
  if (!node.showIf) return true;
  let fn = compiled.get(node.showIf);
  if (!fn) {
    fn = compileShowIf(node.showIf);
    compiled.set(node.showIf, fn);
  }
  return fn(get);
}
