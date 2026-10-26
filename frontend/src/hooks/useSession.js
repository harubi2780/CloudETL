import { useCallback, useEffect, useState } from 'react';
import authApi from '../api/auth';

export default function useSession() {
  const [session, setSession] = useState({ status: 'loading', user: null, error: '' });

  const restore = useCallback(async () => {
    setSession({ status: 'loading', user: null, error: '' });
    try {
      const user = await authApi.getCurrentUser();
      setSession({ status: 'ready', user, error: '' });
    } catch (error) {
      setSession({ status: 'error', user: null, error: error.message || 'We could not reach the service. Please try again.' });
    }
  }, []);

  useEffect(() => { restore(); }, [restore]);

  function authenticate(user) {
    setSession({ status: 'ready', user, error: '' });
  }

  async function signOut() {
    // Clear the user only after the server confirms logout succeeded.
    await authApi.logout();
    setSession({ status: 'ready', user: null, error: '' });
  }

  const expire = useCallback(() => {
    setSession({ status: 'ready', user: null, error: '' });
  }, []);

  return { ...session, restore, authenticate, signOut, expire };
}
