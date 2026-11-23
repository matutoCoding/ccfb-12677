// 极简 hyperscript + 组件基类, 无框架
export type ElChild = Node | string | number | false | null | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: ElChild[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, val] of Object.entries(attrs)) {
    if (val === false || val === null || val === undefined) continue;
    if (k === 'class') el.className = String(val);
    else if (k === 'style' && typeof val === 'object') Object.assign(el.style, val);
    else if (k.startsWith('on') && typeof val === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), val as EventListener);
    } else if (k === 'dataset' && typeof val === 'object') {
      Object.assign(el.dataset, val);
    } else if (k === 'html') el.innerHTML = String(val);
    else el.setAttribute(k, String(val));
  }
  for (const c of children) {
    if (c === false || c === null || c === undefined) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function mount(el: HTMLElement, ...nodes: Node[]): void {
  el.append(...nodes);
}

export function table(headers: string[], rows: (string | Node)[][], opts: { maxHeight?: string } = {}): HTMLElement {
  return h('div', { class: 'table-wrap', style: opts.maxHeight ? { maxHeight: opts.maxHeight } : {} },
    h('table', {},
      h('thead', {}, h('tr', {}, ...headers.map(x => h('th', {}, x)))),
      h('tbody', {}, ...rows.map(r => h('tr', {}, ...r.map(c =>
        h('td', {}, typeof c === 'string' || typeof c === 'number' ? String(c) : c))))),
    ),
  );
}

export function field(label: string, input: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

export function numInput(value: number, onInput: (v: number) => void, step = 1): HTMLInputElement {
  const el = h('input', { type: 'number', value: String(value), step: String(step) }) as HTMLInputElement;
  el.addEventListener('input', () => onInput(Number(el.value)));
  return el;
}

export function textInput(value: string, onInput: (v: string) => void): HTMLInputElement {
  const el = h('input', { type: 'text', value }) as HTMLInputElement;
  el.addEventListener('input', () => onInput(el.value));
  return el;
}

export function select(options: [string, string][], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const el = h('select', {}, ...options.map(([v, label]) =>
    h('option', { value: v, selected: v === value }, label))) as HTMLSelectElement;
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

export function badge(text: string, tone: 'ok' | 'warn' | 'err' | 'info' = 'info'): HTMLElement {
  return h('span', { class: `badge badge-${tone}` }, text);
}

export function section(title: string, ...children: ElChild[]): HTMLElement {
  return h('section', { class: 'panel' },
    h('h3', {}, title),
    h('div', { class: 'panel-body' }, ...children),
  );
}

export function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  return h('button', { class: primary ? 'btn btn-primary' : 'btn', onClick }, label);
}

export function toast(msg: string, tone: 'ok' | 'err' = 'ok'): void {
  const t = h('div', { class: `toast toast-${tone}` }, msg);
  document.body.append(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2600);
}
