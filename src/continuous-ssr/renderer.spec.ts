import {
  ApplicationRef,
  Component,
  TransferState,
  destroyPlatform,
  makeStateKey,
  signal,
} from '@angular/core';
import { BootstrapContext, bootstrapApplication, provideClientHydration } from '@angular/platform-browser';
import { provideServerRendering } from '@angular/platform-server';
import { ContinuousRenderer } from './renderer';

@Component({
  selector: 'app-root',
  template: `<h1>{{ title() }}</h1><p>{{ note() }}</p><span>{{ count() }}</span>`,
})
class TestApp {
  readonly title = signal('first');
  readonly note = signal('');
  readonly count = signal(0);
}

const DOCUMENT_TEMPLATE =
  '<!doctype html><html><head><title>test</title></head><body><app-root></app-root></body></html>';
const NOTE_KEY = makeStateKey<string>('note');

const bootstrap = (context: BootstrapContext) =>
  bootstrapApplication(
    TestApp,
    { providers: [provideServerRendering(), provideClientHydration()] },
    context,
  );

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

function transferState(html: string): Record<string, unknown> {
  const match = /<script id="ng-state" type="application\/json">(.*?)<\/script>/s.exec(html);
  if (!match) {
    throw new Error('no transfer state script in output');
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe('ContinuousRenderer', () => {
  let renderer: ContinuousRenderer;

  beforeAll(async () => {
    // The test environment already created a platform; the server platform replaces it here.
    destroyPlatform();
    renderer = await ContinuousRenderer.create({
      bootstrap,
      document: DOCUMENT_TEMPLATE,
      url: 'http://localhost/',
    });
  });

  afterAll(() => {
    renderer.destroy();
  });

  it('serializes the live application with hydration annotations', async () => {
    const html = await renderer.render('/');

    expect(html).toContain('<h1>first</h1>');
    expect(html).toMatch(/<app-root[^>]*ngh="\d+"/);
    expect(html).toContain('ng-server-context="ssr-continuous"');
    expect(count(html, 'id="ng-state"')).toBe(1);
    expect(count(html, '<!--nghm-->')).toBe(1);
    expect(count(html, '<!--ngetn-->')).toBe(1);
    expect(renderer.renderCount).toBe(1);
  });

  it('re-serializes after a state change without leaking artifacts from the previous pass', async () => {
    const appRef = renderer.injector.get(ApplicationRef);
    const app = appRef.components[0].instance as TestApp;
    app.title.set('second');
    app.count.set(42);

    const html = await renderer.render('/');

    expect(html).toContain('<h1>second</h1>');
    expect(html).not.toContain('first');
    expect(html).toContain('<span>42</span>');
    expect(count(html, 'id="ng-state"')).toBe(1);
    expect(count(html, '<!--nghm-->')).toBe(1);
    expect(count(html, '<!--ngetn-->')).toBe(1);
    expect(count(html, 'ng-server-context=')).toBe(1);
    expect(renderer.renderCount).toBe(2);
  });

  it('carries the latest transfer state in the serialized script', async () => {
    const state = renderer.injector.get(TransferState);

    state.set(NOTE_KEY, 'alpha');
    const first = transferState(await renderer.render('/'));
    state.set(NOTE_KEY, 'beta');
    const second = transferState(await renderer.render('/'));

    expect(first['note']).toBe('alpha');
    expect(second['note']).toBe('beta');
    expect(second['__nghData__']).toBeDefined();
  });

  it('queues concurrent renders so each one sees a consistent document', async () => {
    const app = renderer.injector.get(ApplicationRef).components[0].instance as TestApp;
    app.title.set('queued');

    const [a, b] = await Promise.all([renderer.render('/'), renderer.render('/')]);

    expect(a).toContain('<h1>queued</h1>');
    expect(b).toContain('<h1>queued</h1>');
    expect(count(b, 'id="ng-state"')).toBe(1);
  });
});
