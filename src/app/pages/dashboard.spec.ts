import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { LiveDataStore } from '../live-data.store';
import { DashboardPage } from './dashboard';

describe('DashboardPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('renders the live state', async () => {
    const store = TestBed.inject(LiveDataStore);
    store.apply({ counter: 12, message: 'rendered once', updatedAt: '2026-09-23T10:11:12.000Z' });

    const fixture = TestBed.createComponent(DashboardPage);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('12');
    expect(text).toContain('rendered once');
    expect(text).toContain('10:11:12 UTC');
  });

  it('publishes a message and applies the returned state', async () => {
    const fixture = TestBed.createComponent(DashboardPage);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;

    input.value = 'fresh';
    input.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    const request = http.expectOne('/api/message');
    expect(request.request.body).toEqual({ message: 'fresh' });
    request.flush({ counter: 3, message: 'fresh', updatedAt: '2026-09-23T10:00:00.000Z' });
    // The response resolves through several microtasks before the view is marked dirty.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    expect(TestBed.inject(LiveDataStore).message()).toBe('fresh');
    expect(fixture.nativeElement.textContent).toContain('Published.');
    http.verify();
  });

  it('shows a validation message instead of posting an empty message', async () => {
    const fixture = TestBed.createComponent(DashboardPage);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;

    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    http.expectNone('/api/message');
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'between 1 and 120 characters',
    );
  });
});
