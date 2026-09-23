import { provideHttpClient } from '@angular/common/http';
import { EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideClientHydration } from '@angular/platform-browser';
import { findHttpTransferCacheToken, keepHttpTransferCacheActive } from './http-transfer-cache';

describe('keepHttpTransferCacheActive', () => {
  it("recovers the cache state token from Angular's own providers", () => {
    expect(findHttpTransferCacheToken()).not.toBeNull();
  });

  it('returns false when the application has no HTTP transfer cache', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });

    expect(keepHttpTransferCacheActive(TestBed.inject(EnvironmentInjector))).toBe(false);
  });

  it('switches the cache back on after Angular turned it off', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideClientHydration()] });
    const injector = TestBed.inject(EnvironmentInjector);
    const state = injector.get(findHttpTransferCacheToken()!);
    state.isCacheActive = false;

    expect(keepHttpTransferCacheActive(injector)).toBe(true);
    expect(state.isCacheActive).toBe(true);
  });
});
