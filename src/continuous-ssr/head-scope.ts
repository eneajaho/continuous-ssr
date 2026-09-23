/**
 * `<head>` is shared by every route of the live application: `Meta` tags and `<link>`s a page
 * adds stay after navigating away, and a route without a title keeps the previous one. The
 * head scope remembers how the head looked right after bootstrap and puts `<meta>`, `<link>`
 * and `<title>` back to that state before another route renders. Component `<style>` tags are
 * left alone; Angular manages those itself.
 */
export interface HeadBaseline {
  readonly title: string;
  readonly elements: ReadonlyMap<Element, ReadonlyMap<string, string>>;
}

const MANAGED = 'meta, link';

function attributesOf(element: Element): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const attribute of Array.from(element.attributes)) {
    attributes.set(attribute.name, attribute.value);
  }
  return attributes;
}

export function captureHead(doc: Document): HeadBaseline {
  const elements = new Map<Element, ReadonlyMap<string, string>>();
  for (const element of Array.from(doc.head.querySelectorAll(MANAGED))) {
    elements.set(element, attributesOf(element));
  }
  return { title: doc.title, elements };
}

/** Restores the head to `baseline`; returns how many elements were removed or changed back. */
export function resetHead(doc: Document, baseline: HeadBaseline): number {
  let changes = 0;
  for (const element of Array.from(doc.head.querySelectorAll(MANAGED))) {
    const original = baseline.elements.get(element);
    if (!original) {
      element.remove();
      changes++;
      continue;
    }
    const current = attributesOf(element);
    for (const [name] of current) {
      if (!original.has(name)) {
        element.removeAttribute(name);
        changes++;
      }
    }
    for (const [name, value] of original) {
      if (current.get(name) !== value) {
        element.setAttribute(name, value);
        changes++;
      }
    }
  }
  for (const element of baseline.elements.keys()) {
    if (!element.isConnected) {
      doc.head.appendChild(element);
      changes++;
    }
  }
  if (doc.title !== baseline.title) {
    doc.title = baseline.title;
    changes++;
  }
  return changes;
}
