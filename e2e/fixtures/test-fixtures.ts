import { test as base, type APIRequestContext, type Page } from '@playwright/test';
import { IndexPage } from '../pages/index.page.ts';
import { ApiPage } from '../pages/api.pages.ts';

type TestFixtures = {
  indexPage: IndexPage;
  api: ApiPage;
  resetStore: () => Promise<void>;
};

export const test = base.extend<TestFixtures>({
  indexPage: async ({ page }: { page: Page }, use: (fixture: IndexPage) => Promise<void>) => {
    const indexPage = new IndexPage(page);
    await indexPage.goto();
    await indexPage.isHeadingVisible();
    await use(indexPage);
  },

  api: async ({ request }: { request: APIRequestContext }, use: (fixture: ApiPage) => Promise<void>) => {
    const api = new ApiPage(request);
    await use(api);
  },

  resetStore: async ({ request }: { request: APIRequestContext }, use: (fixture: () => Promise<void>) => Promise<void>) => {
    const api = new ApiPage(request);
    await use(async () => {
      await api.resetStore();
    });
  },
});

export { expect } from '@playwright/test';