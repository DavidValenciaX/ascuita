const baseUrl = process.argv[2] || process.env.SMOKE_TEST_URL;

if (!baseUrl) {
  console.error(
    'Usage: node apps/api/scripts/smoke-test.mjs <base-url> (or set SMOKE_TEST_URL)'
  );
  process.exit(1);
}

const normalizedBaseUrl = baseUrl.replace(/\/$/u, '');
const endpoints = ['/health', '/ready'];

for (const endpoint of endpoints) {
  const url = `${normalizedBaseUrl}${endpoint}`;
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    console.error(`Smoke test failed for ${url}:`, error);
    process.exit(1);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    console.error(`Smoke test failed for ${url}: response was not JSON`);
    process.exit(1);
  }

  const endpointIsReady = endpoint === '/ready' ? payload.ready === true : true;
  if (response.status !== 200 || payload.ok !== true || !endpointIsReady) {
    console.error(
      `Smoke test failed for ${url}: HTTP ${response.status}`,
      payload
    );
    process.exit(1);
  }

  console.log(`Smoke test passed for ${url}`);
}
