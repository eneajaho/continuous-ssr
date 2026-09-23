import {
  EMPTY_TEXT_NODE_MARKER,
  SSR_CONTENT_INTEGRITY_MARKER,
  TEXT_NODE_SEPARATOR_MARKER,
  stripSerializationArtifacts,
  transferStateScriptId,
} from './serialization-artifacts';

function documentWithBody(bodyHtml: string): Document {
  const doc = document.implementation.createHTMLDocument('test');
  doc.body.innerHTML = bodyHtml;
  return doc;
}

describe('stripSerializationArtifacts', () => {
  it('removes the transfer state script, integrity marker, text markers and replay script', () => {
    const doc = documentWithBody(`
      <!--${SSR_CONTENT_INTEGRITY_MARKER}-->
      <app-root ngh="0"><p>Hello<!--${TEXT_NODE_SEPARATOR_MARKER}-->world</p><span><!--${EMPTY_TEXT_NODE_MARKER}--></span></app-root>
      <script type="text/javascript" id="ng-event-dispatch-contract">dispatch()</script>
      <script>window.__jsaction_bootstrap(document.body,"ng",["click"],[]);</script>
      <script id="${transferStateScriptId('ng')}" type="application/json">{"__nghData__":[]}</script>
    `);

    stripSerializationArtifacts(doc, 'ng');

    const html = doc.body.innerHTML;
    expect(doc.getElementById('ng-state')).toBeNull();
    expect(html).not.toContain(SSR_CONTENT_INTEGRITY_MARKER);
    expect(html).not.toContain(TEXT_NODE_SEPARATOR_MARKER);
    expect(html).not.toContain(EMPTY_TEXT_NODE_MARKER);
    expect(html).not.toContain('__jsaction_bootstrap');
  });

  it('keeps application content, hydration attributes, anchors and the dispatch contract', () => {
    const doc = documentWithBody(`
      <!--${SSR_CONTENT_INTEGRITY_MARKER}-->
      <app-root ngh="0" ng-server-context="ssr"><ul><!--container--><li ngh="1">One</li><!--ng-container--></ul></app-root>
      <script type="text/javascript" id="ng-event-dispatch-contract">dispatch()</script>
      <script id="ng-state" type="application/json">{}</script>
    `);

    stripSerializationArtifacts(doc, 'ng');

    const html = doc.body.innerHTML;
    expect(html).toContain('<app-root ngh="0" ng-server-context="ssr">');
    expect(html).toContain('<li ngh="1">One</li>');
    expect(html).toContain('<!--container-->');
    expect(html).toContain('<!--ng-container-->');
    expect(doc.getElementById('ng-event-dispatch-contract')).not.toBeNull();
  });

  it('is a no-op on a document without artifacts', () => {
    const doc = documentWithBody('<app-root><h1>Plain</h1></app-root>');
    const before = doc.body.innerHTML;

    stripSerializationArtifacts(doc, 'ng');

    expect(doc.body.innerHTML).toBe(before);
  });

  it('honours the application id when looking for the state script', () => {
    const doc = documentWithBody(
      `<script id="ng-state" type="application/json">{}</script>` +
        `<script id="custom-state" type="application/json">{}</script>`,
    );

    stripSerializationArtifacts(doc, 'custom');

    expect(doc.getElementById('custom-state')).toBeNull();
    expect(doc.getElementById('ng-state')).not.toBeNull();
  });
});
