/**
 * Final Production Verification Script
 *
 * Runs comprehensive checks before pilot launch.
 * Usage: npx ts-node scripts/final-verification.ts
 */

import 'dotenv/config';

interface TestResult {
  test: string;
  pass: boolean;
  detail: string;
}

async function runVerification() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           FINAL PRODUCTION VERIFICATION                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const results: TestResult[] = [];

  // Test 1: Health endpoint
  console.log('1. Health endpoint...');
  try {
    const res = await fetch('http://localhost:3000/health');
    const data = await res.json() as { status?: string };
    const pass = res.ok && data.status === 'ok';
    results.push({ test: 'Health endpoint', pass, detail: JSON.stringify(data) });
    console.log(pass ? '   ✓ PASS' : '   ✗ FAIL');
  } catch (e) {
    results.push({ test: 'Health endpoint', pass: false, detail: String(e) });
    console.log('   ✗ FAIL - Server not running?');
  }

  // Test 2: Auth registration + JWT expiry
  console.log('2. Auth registration + JWT expiry...');
  try {
    const ts = Date.now();
    const res = await fetch('http://localhost:3000/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `prodcheck${ts}@test.com`,
        password: 'SecurePass123!',
        role: 'CUSTOMER'
      })
    });
    const data = await res.json() as { token?: string };

    if (data.token) {
      const payload = JSON.parse(Buffer.from(data.token.split('.')[1], 'base64').toString());
      const expiryHours = (payload.exp - payload.iat) / 3600;
      const pass = expiryHours === 24;
      results.push({ test: 'JWT expiry (24h)', pass, detail: `${expiryHours} hours` });
      console.log(pass ? '   ✓ PASS (24h expiry)' : `   ✗ FAIL (${expiryHours}h expiry)`);
    } else {
      results.push({ test: 'JWT expiry (24h)', pass: false, detail: 'No token returned' });
      console.log('   ✗ FAIL - No token returned');
    }
  } catch (e) {
    results.push({ test: 'JWT expiry (24h)', pass: false, detail: String(e) });
    console.log('   ✗ FAIL');
  }

  // Test 3: CORS headers
  console.log('3. CORS headers...');
  try {
    const res = await fetch('http://localhost:3000/health', {
      headers: { Origin: 'http://localhost:5173' }
    });
    const corsHeader = res.headers.get('access-control-allow-origin');
    const pass = corsHeader === 'http://localhost:5173';
    results.push({ test: 'CORS headers', pass, detail: corsHeader || 'none' });
    console.log(pass ? '   ✓ PASS' : '   ✗ FAIL');
  } catch (e) {
    results.push({ test: 'CORS headers', pass: false, detail: String(e) });
    console.log('   ✗ FAIL');
  }

  // Test 4: Protected endpoint rejects without auth
  console.log('4. Auth protection...');
  try {
    const res = await fetch('http://localhost:3000/appointments/me');
    const pass = res.status === 401;
    results.push({ test: 'Auth protection', pass, detail: `Status: ${res.status}` });
    console.log(pass ? '   ✓ PASS (401 returned)' : '   ✗ FAIL');
  } catch (e) {
    results.push({ test: 'Auth protection', pass: false, detail: String(e) });
    console.log('   ✗ FAIL');
  }

  // Test 5: Webhook signature validation
  console.log('5. Webhook signature validation...');
  try {
    const res = await fetch('http://localhost:3000/webhooks/stripe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'invalid_signature'
      },
      body: JSON.stringify({ type: 'test' })
    });
    const text = await res.text();
    const pass = res.status === 400 && text.includes('verification failed');
    results.push({ test: 'Webhook signature validation', pass, detail: text });
    console.log(pass ? '   ✓ PASS (rejects invalid signature)' : '   ✗ FAIL');
  } catch (e) {
    results.push({ test: 'Webhook signature validation', pass: false, detail: String(e) });
    console.log('   ✗ FAIL');
  }

  // Test 6: Shops endpoint (public data)
  console.log('6. Public data endpoints...');
  try {
    const res = await fetch('http://localhost:3000/shops');
    const pass = res.ok;
    results.push({ test: 'Public data endpoints', pass, detail: `Status: ${res.status}` });
    console.log(pass ? '   ✓ PASS' : '   ✗ FAIL');
  } catch (e) {
    results.push({ test: 'Public data endpoints', pass: false, detail: String(e) });
    console.log('   ✗ FAIL');
  }

  // Summary
  console.log('\n' + '═'.repeat(64));
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`RESULTS: ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log('\n✅ ALL TESTS PASSED - READY FOR PILOT LAUNCH');
    process.exit(0);
  } else {
    console.log('\n❌ SOME TESTS FAILED - REVIEW BEFORE LAUNCH');
    for (const r of results.filter(r => !r.pass)) {
      console.log(`   - ${r.test}: ${r.detail}`);
    }
    process.exit(1);
  }
}

runVerification().catch((e) => {
  console.error('Verification failed:', e);
  process.exit(1);
});
