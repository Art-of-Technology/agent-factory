# Testing Best Practices

## Unit Testing (Vitest + React Testing Library)

- Test components in isolation
- Mock external dependencies with `vi.mock()`
- Use `describe/it/expect` patterns for clear test structure
- Test user interactions with RTL's `userEvent`
- Snapshot testing sparingly — prefer explicit assertions
- Keep tests focused: one behavior per test

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

describe('Button', () => {
  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click me</Button>);
    await userEvent.click(screen.getByRole('button', { name: /click me/i }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
```

## E2E Testing (Playwright)

- Test critical user flows end-to-end
- Use page object model for maintainability
- Test happy path + key error paths
- Run against dev server
- Use `test.describe` for grouping related flows

```typescript
import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('user can sign in', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[name="email"]', 'user@example.com');
    await page.fill('[name="password"]', 'password');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/dashboard');
  });
});
```

## Integration Testing

- Test API routes with real DB (test database)
- Test component + data fetching together
- Test form submission → API → response cycle
- Use test utilities to seed and clean up data

## Dependency Injection Pattern

Pass dependencies as parameters, not global imports. This makes testing easy — inject mocks in tests, real implementations in production.

```typescript
// ✅ Good — injectable
function createUserService(db: Database, emailClient: EmailClient) {
  return {
    async createUser(data: CreateUserInput) {
      const user = await db.user.create({ data });
      await emailClient.sendWelcome(user.email);
      return user;
    },
  };
}

// ❌ Bad — hard to test
import { db } from '@/lib/db';
import { sendEmail } from '@/lib/email';

async function createUser(data: CreateUserInput) {
  const user = await db.user.create({ data });
  await sendEmail(user.email);
  return user;
}
```

- Use factory functions or constructor injection
- Apply to: API routes, services, data access layers
- In tests, inject mocks; in production, inject real implementations

## Running Tests

```bash
# Unit tests
npm test                    # or: npx vitest
npm run test:watch          # watch mode

# E2E tests
npx playwright test         # headless
npx playwright test --ui    # interactive UI mode

# Coverage
npx vitest --coverage
```

## Test File Conventions

- Unit tests: `src/**/*.test.{ts,tsx}` (co-located or in `src/__tests__/`)
- E2E tests: `e2e/**/*.spec.ts`
- Test setup: `src/test/setup.ts`
