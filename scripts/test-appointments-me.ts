/**
 * Phase 7.1.1 Verification Script
 *
 * Tests GET /appointments/me endpoint:
 * - CUSTOMER token → 200 OK
 * - BARBER token → 403 FORBIDDEN
 * - SHOP_OWNER token → 403 FORBIDDEN
 * - No token → 401 UNAUTHORIZED
 */

import 'dotenv/config';

const BASE_URL = 'http://localhost:3000';

interface TestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

const results: TestResult[] = [];

async function makeRequest(
  method: string,
  path: string,
  token?: string
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function registerUser(
  email: string,
  role: 'CUSTOMER' | 'BARBER' | 'SHOP_OWNER'
): Promise<string> {
  const response = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'password123',
      role,
    }),
  });

  const data = await response.json();
  return data.token;
}

async function loginUser(email: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'password123',
    }),
  });

  const data = await response.json();
  return data.token;
}

// ============================================================================
// TEST 1: CUSTOMER token → 200 OK
// ============================================================================
async function testCustomerAccess(): Promise<TestResult> {
  const testName = 'CUSTOMER token';
  try {
    const email = `customer-me-${Date.now()}@test.com`;
    const token = await registerUser(email, 'CUSTOMER');

    const { status, data } = await makeRequest('GET', '/appointments/me', token);

    if (status === 200 && Array.isArray(data)) {
      return {
        name: testName,
        passed: true,
        expected: '200 OK (array)',
        actual: `200 OK (array with ${(data as unknown[]).length} items)`,
      };
    }

    return {
      name: testName,
      passed: false,
      expected: '200 OK (array)',
      actual: `${status} - ${JSON.stringify(data)}`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      expected: '200 OK (array)',
      actual: `Error: ${error instanceof Error ? error.message : error}`,
    };
  }
}

// ============================================================================
// TEST 2: BARBER token → 403 FORBIDDEN
// ============================================================================
async function testBarberRejection(): Promise<TestResult> {
  const testName = 'BARBER token';
  try {
    const email = `barber-me-${Date.now()}@test.com`;
    const token = await registerUser(email, 'BARBER');

    const { status, data } = await makeRequest('GET', '/appointments/me', token);

    const errorData = data as { error?: { code?: string } };

    if (status === 403 && errorData.error?.code === 'FORBIDDEN') {
      return {
        name: testName,
        passed: true,
        expected: '403 FORBIDDEN',
        actual: '403 FORBIDDEN',
      };
    }

    return {
      name: testName,
      passed: false,
      expected: '403 FORBIDDEN',
      actual: `${status} - ${JSON.stringify(data)}`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      expected: '403 FORBIDDEN',
      actual: `Error: ${error instanceof Error ? error.message : error}`,
    };
  }
}

// ============================================================================
// TEST 3: SHOP_OWNER token → 403 FORBIDDEN
// ============================================================================
async function testShopOwnerRejection(): Promise<TestResult> {
  const testName = 'SHOP_OWNER token';
  try {
    const email = `shopowner-me-${Date.now()}@test.com`;
    const token = await registerUser(email, 'SHOP_OWNER');

    const { status, data } = await makeRequest('GET', '/appointments/me', token);

    const errorData = data as { error?: { code?: string } };

    if (status === 403 && errorData.error?.code === 'FORBIDDEN') {
      return {
        name: testName,
        passed: true,
        expected: '403 FORBIDDEN',
        actual: '403 FORBIDDEN',
      };
    }

    return {
      name: testName,
      passed: false,
      expected: '403 FORBIDDEN',
      actual: `${status} - ${JSON.stringify(data)}`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      expected: '403 FORBIDDEN',
      actual: `Error: ${error instanceof Error ? error.message : error}`,
    };
  }
}

// ============================================================================
// TEST 4: No token → 401 UNAUTHORIZED
// ============================================================================
async function testNoTokenRejection(): Promise<TestResult> {
  const testName = 'No token';
  try {
    const { status, data } = await makeRequest('GET', '/appointments/me');

    const errorData = data as { error?: { code?: string } };

    if (status === 401 && errorData.error?.code === 'UNAUTHORIZED') {
      return {
        name: testName,
        passed: true,
        expected: '401 UNAUTHORIZED',
        actual: '401 UNAUTHORIZED',
      };
    }

    return {
      name: testName,
      passed: false,
      expected: '401 UNAUTHORIZED',
      actual: `${status} - ${JSON.stringify(data)}`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      expected: '401 UNAUTHORIZED',
      actual: `Error: ${error instanceof Error ? error.message : error}`,
    };
  }
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log('Phase 7.1.1 Verification: GET /appointments/me\n');
  console.log('='.repeat(60));

  // Check server is running
  try {
    await fetch(`${BASE_URL}/health`);
  } catch {
    console.error('ERROR: Server not running at', BASE_URL);
    console.error('Start server with: npm run dev');
    process.exit(1);
  }

  results.push(await testCustomerAccess());
  results.push(await testBarberRejection());
  results.push(await testShopOwnerRejection());
  results.push(await testNoTokenRejection());

  console.log('\n' + '='.repeat(60));
  console.log('RESULTS\n');
  console.log('Test Case          | Result | Expected          | Actual');
  console.log('-------------------|--------|-------------------|-------');

  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    const name = result.name.padEnd(18);
    const expected = result.expected.padEnd(18);
    console.log(`${name} | ${status.padEnd(6)} | ${expected} | ${result.actual}`);
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  console.log('\n' + '='.repeat(60));
  console.log(`Summary: ${passed}/${total} tests passed`);

  if (passed < total) {
    console.log('\nFAILED TESTS:');
    for (const result of results.filter((r) => !r.passed)) {
      console.log(`  - ${result.name}: expected ${result.expected}, got ${result.actual}`);
    }
  }

  process.exit(passed === total ? 0 : 1);
}

main().catch(console.error);
