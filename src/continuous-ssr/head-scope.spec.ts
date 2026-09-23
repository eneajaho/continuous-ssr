import { captureHead, resetHead } from './head-scope';

function documentWithHead(headHtml: string): Document {
  const doc = document.implementation.createHTMLDocument('Base title');
  doc.head.innerHTML = headHtml;
  return doc;
}

describe('head scope', () => {
  it('removes added meta and link tags, restores changed ones and the title, keeps styles', () => {
    const doc = documentWithHead(
      '<title>Base title</title><meta name="viewport" content="width=device-width"><link rel="icon" href="favicon.ico"><style>.a{}</style>',
    );
    const baseline = captureHead(doc);

    doc.title = 'Article';
    doc.head.querySelector('meta')!.setAttribute('content', 'changed');
    doc.head.querySelector('meta')!.setAttribute('data-extra', 'x');
    doc.head.insertAdjacentHTML('beforeend', '<meta name="description" content="leak"><link rel="canonical" href="/a"><style>.b{}</style>');
    doc.head.querySelector('link[rel=icon]')!.remove();

    const changes = resetHead(doc, baseline);

    expect(changes).toBeGreaterThan(0);
    expect(doc.title).toBe('Base title');
    expect(doc.head.querySelector('meta[name=description]')).toBeNull();
    expect(doc.head.querySelector('link[rel=canonical]')).toBeNull();
    expect(doc.head.querySelector('meta[name=viewport]')?.getAttribute('content')).toBe('width=device-width');
    expect(doc.head.querySelector('meta[name=viewport]')?.hasAttribute('data-extra')).toBe(false);
    expect(doc.head.querySelector('link[rel=icon]')).not.toBeNull();
    expect(doc.head.querySelectorAll('style')).toHaveLength(2);
    expect(resetHead(doc, baseline)).toBe(0);
  });
});
