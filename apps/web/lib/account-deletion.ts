import { API_BASE_URL } from './constants';

export async function deleteAccount(idToken: string) {
  const response = await fetch(new URL('/account', API_BASE_URL), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  let payload: { error?: string } = {};
  try {
    payload = (await response.json()) as { error?: string };
  } catch {
    // The API may close the connection without a JSON body on infrastructure errors.
  }

  if (!response.ok) {
    throw new Error(payload.error || 'Account deletion failed');
  }

  return payload;
}
