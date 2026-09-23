/**
 * Angular's server renderer leaves a few things in the DOM every time it serializes an
 * application. Calling it repeatedly on the same live document accumulates them, so they
 * are stripped before each new snapshot.
 *
 * Constants mirror `packages/core/src/hydration/utils.ts` in the Angular repository.
 */
export const SSR_CONTENT_INTEGRITY_MARKER = 'nghm';
export const EMPTY_TEXT_NODE_MARKER = 'ngetn';
export const TEXT_NODE_SEPARATOR_MARKER = 'ngtns';

const EVENT_REPLAY_SCRIPT_PREFIX = 'window.__jsaction_bootstrap(';
const COMMENT_NODE = 8;

const MARKER_COMMENTS: ReadonlySet<string> = new Set([
  SSR_CONTENT_INTEGRITY_MARKER,
  EMPTY_TEXT_NODE_MARKER,
  TEXT_NODE_SEPARATOR_MARKER,
]);

/** Id of the `<script type="application/json">` that carries `TransferState`. */
export function transferStateScriptId(appId: string): string {
  return `${appId}-state`;
}

/**
 * Removes every artifact of a previous serialization from `doc` so the next call to
 * Angular's `renderInternal` produces the same output a fresh render would.
 */
export function stripSerializationArtifacts(doc: Document, appId: string): void {
  doc.getElementById(transferStateScriptId(appId))?.remove();

  for (const script of Array.from(doc.body.querySelectorAll('script'))) {
    if (script.textContent?.startsWith(EVENT_REPLAY_SCRIPT_PREFIX)) {
      script.remove();
    }
  }

  removeMarkerComments(doc.body);
}

function removeMarkerComments(root: Node): void {
  const doomed: Node[] = [];
  const visit = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === COMMENT_NODE) {
        if (MARKER_COMMENTS.has((child as Comment).data)) {
          doomed.push(child);
        }
      } else {
        visit(child);
      }
    }
  };
  visit(root);
  for (const node of doomed) {
    node.parentNode?.removeChild(node);
  }
}
