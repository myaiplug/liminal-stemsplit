import { chromium } from 'playwright';

const checkoutUrl = process.argv[2];
if (!checkoutUrl) {
  console.error('Usage: node scripts/e2e-stripe-checkout.mjs <checkout_url>');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

async function fillInAnyFrame(selectors, value) {
  for (const frame of page.frames()) {
    for (const selector of selectors) {
      const field = frame.locator(selector).first();
      if (await field.count()) {
        await field.click({ timeout: 5000 }).catch(() => {});
        await field.fill(value, { timeout: 15000 });
        return true;
      }
    }
  }
  return false;
}

try {
  console.log('Opening checkout:', checkoutUrl);
  await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(3000);

  const cardRow = page.locator('text=Card').first();
  await cardRow.click({ timeout: 15000 });
  await page.waitForTimeout(3000);

  const filledCard = await fillInAnyFrame(
    ['input[name="cardnumber"]', 'input[autocomplete="cc-number"]', 'input[placeholder*="1234"]', 'input[aria-label*="Card number"]'],
    '4242424242424242'
  );
  const filledExp = await fillInAnyFrame(
    ['input[name="exp-date"]', 'input[autocomplete="cc-exp"]', 'input[placeholder*="MM"]'],
    '1234'
  );
  const filledCvc = await fillInAnyFrame(
    ['input[name="cvc"]', 'input[autocomplete="cc-csc"]', 'input[placeholder*="CVC"]'],
    '123'
  );

  if (!filledCard || !filledExp || !filledCvc) {
    await page.screenshot({ path: 'scripts/e2e-checkout-debug.png', fullPage: true });
    throw new Error(`Card fields not found (card=${filledCard}, exp=${filledExp}, cvc=${filledCvc})`);
  }

  await fillInAnyFrame(
    ['input[name="billingName"]', 'input[autocomplete="name"]', 'input[placeholder*="Full name"]'],
    'Liminal E2E Test'
  );
  await fillInAnyFrame(
    ['input[name="postalCode"]', 'input[autocomplete="postal-code"]', 'input[placeholder*="ZIP"]', 'input[aria-label*="ZIP"]'],
    '94103'
  );

  const phoneField = page.locator('input[type="tel"], input[name*="phone"], input[autocomplete="tel"]').first();
  if (await phoneField.count()) {
    await phoneField.fill('2015550123');
  }

  const payButton = page.getByRole('button', { name: /^Pay/i }).first();
  await payButton.click({ timeout: 30000 });

  await page.waitForURL(/liminal-stemsplit\.onrender\.com/, { timeout: 180000 });
  console.log('SUCCESS_URL:', page.url());
  process.exit(0);
} catch (error) {
  console.error('CHECKOUT_FAILED:', error.message);
  await page.screenshot({ path: 'scripts/e2e-checkout-failure.png', fullPage: true });
  process.exit(1);
} finally {
  await browser.close();
}