import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the main navigation', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const nav = (fixture.nativeElement as HTMLElement).querySelector('nav[aria-label="Main"]');

    expect(nav).not.toBeNull();
    expect(nav?.textContent).toContain('Dashboard');
    expect(nav?.textContent).toContain('About');
  });
});
