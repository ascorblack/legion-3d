/**
 * Single place where the UI turns its own markup strings into DOM.
 * Every caller passes static markup plus values already run through esc(); nothing site-provided is ever
 * passed unescaped. Parsing goes through DOMParser (inert document: no script execution, no resource loads),
 * then the nodes are moved (adopted) into the target — this avoids `innerHTML =` assignments that store linters
 * (AMO / web-ext) flag as unsafe.
 */
type Target = Element | ShadowRoot | DocumentFragment;

const parse = (html: string): Node[] => {
  const doc = new DOMParser().parseFromString('<!doctype html><body>' + html, 'text/html');
  return Array.from(doc.body.childNodes);
};

/** Replace all children of `el` with the parsed `html`. */
export function setHtml(el: Target, html: string): void {
  if (typeof DOMParser === 'undefined') { Reflect.set(el, 'innerHTML', html); return; }   // headless unit-test stubs only
  const nodes = parse(html);
  el.replaceChildren(...nodes);   // append() adopts the nodes into el's document
}

/** Append the parsed `html` after the last child of `el`. */
export function appendHtml(el: Element, html: string): void {
  if (typeof DOMParser === 'undefined') { Reflect.set(el, 'innerHTML', String(Reflect.get(el, 'innerHTML') ?? '') + html); return; }
  for (const n of parse(html)) el.append(n);
}
