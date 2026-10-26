import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

function apiResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

function startSignedOut() {
  global.fetch
    .mockResolvedValueOnce(apiResponse({ csrfToken: 'csrf-initial' }))
    .mockResolvedValueOnce(apiResponse({ error: { code: 'authentication_required', message: 'Please log in.' } }, 401));
}

beforeEach(() => {
  global.fetch = jest.fn((url) => {
    if (url.startsWith('/api/datasets/?')) return Promise.resolve(apiResponse({
      datasets: [], page: 1, total_pages: 1, total_count: 0,
      limits: { max_file_size_bytes: 26214400, extensions: ['csv', 'tsv', 'json', 'xlsx', 'parquet'] },
    }));
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  });
  window.history.replaceState(null, '', '/login');
  window.scrollTo = jest.fn();
});

test('restores an existing session and redirects sign-in to the dashboard', async () => {
  global.fetch
    .mockResolvedValueOnce(apiResponse({ csrfToken: 'csrf-initial' }))
    .mockResolvedValueOnce(apiResponse({ user: { id: 4, username: 'mira', email: 'mira@uni.edu' } }));

  render(<App />);

  expect(await screen.findByRole('heading', { name: 'Welcome, mira' })).toBeInTheDocument();
  expect(screen.getByText('mira@uni.edu')).toBeInTheDocument();
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  expect(window.location.pathname).toBe('/dashboard');
  expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeInTheDocument();
  expect(global.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/auth/csrf/', '/api/auth/me/']);
});

test('uses real URLs for account forms and clears password inputs when switching', async () => {
  startSignedOut();
  render(<App />);
  await userEvent.type(await screen.findByLabelText('Password'), 'temporary-secret');
  await userEvent.click(screen.getByRole('link', { name: 'Create account' }));
  expect(window.location.pathname).toBe('/register');
  expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: 'Sign in' }));
  expect(window.location.pathname).toBe('/login');
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByLabelText('Password')).toHaveValue('');
  expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument();
});

test('signs in with the session CSRF token and clears password fields after success', async () => {
  startSignedOut();
  render(<App />);

  const username = await screen.findByLabelText('Username');
  await userEvent.type(username, 'mira');
  await userEvent.type(screen.getByLabelText('Password'), 'secret-pass');
  global.fetch.mockResolvedValueOnce(apiResponse({
    user: { id: 6, username: 'mira', email: 'mira@uni.edu' },
    csrfToken: 'csrf-after-login',
  }));
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

  expect(await screen.findByRole('heading', { name: 'Welcome, mira' })).toBeInTheDocument();
  const [url, options] = global.fetch.mock.calls[2];
  expect(url).toBe('/api/auth/login/');
  expect(options.method).toBe('POST');
  expect(options.credentials).toBe('same-origin');
  expect(options.headers['X-CSRFToken']).toBe('csrf-initial');
  expect(JSON.parse(options.body)).toEqual({ username: 'mira', password: 'secret-pass' });

  global.fetch.mockResolvedValueOnce(apiResponse({ user: null, csrfToken: 'csrf-after-logout' }));
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toHaveValue('');
  const [logoutUrl, logoutOptions] = global.fetch.mock.calls[3];
  expect(logoutUrl).toBe('/api/auth/logout/');
  expect(logoutOptions.headers['X-CSRFToken']).toBe('csrf-after-login');
  expect(logoutOptions.body).toBeUndefined();
});

test('registers using the required fields and reports server field errors accessibly', async () => {
  startSignedOut();
  render(<App />);
  await userEvent.click(await screen.findByRole('link', { name: 'Create account' }));
  await userEvent.type(screen.getByLabelText('Username'), 'new-user');
  await userEvent.type(screen.getByLabelText('Email address'), 'not-an-email');
  await userEvent.type(screen.getByLabelText('Password'), 'weak');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'other');
  global.fetch.mockResolvedValueOnce(apiResponse({
    error: {
      code: 'validation_error',
      message: 'Please correct the fields below.',
      fields: { email: ['Enter a valid email address.'], password_confirmation: ['Passwords do not match.'] },
    },
  }, 400));
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

  expect(await screen.findByText('Please correct the fields below.')).toBeInTheDocument();
  expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
  expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
  expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true');
  const [url, options] = global.fetch.mock.calls[2];
  expect(url).toBe('/api/auth/register/');
  expect(JSON.parse(options.body)).toEqual({
    username: 'new-user', email: 'not-an-email', password: 'weak', password_confirmation: 'other',
  });
});

test('keeps the signed-in account visible if logout fails, then signs out on retry', async () => {
  global.fetch
    .mockResolvedValueOnce(apiResponse({ csrfToken: 'csrf-initial' }))
    .mockResolvedValueOnce(apiResponse({ user: { id: 9, username: 'sam', email: 'sam@uni.edu' } }))
    .mockResolvedValueOnce(apiResponse({ error: { code: 'server_error', message: 'Please try signing out again.' } }, 503))
    .mockResolvedValueOnce(apiResponse({ user: null, csrfToken: 'csrf-next' }));

  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Welcome, sam' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByText('Please try signing out again.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Welcome, sam' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();

  const logoutOptions = global.fetch.mock.calls[2][1];
  expect(logoutOptions.headers['X-CSRFToken']).toBe('csrf-initial');
  expect(logoutOptions.body).toBeUndefined();
});

test('shows a retry state when the session check cannot reach the API', async () => {
  global.fetch.mockRejectedValueOnce(new Error('offline'));
  render(<App />);

  expect(await screen.findByRole('heading', { name: 'We couldn’t connect' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  global.fetch.mockResolvedValueOnce(apiResponse({ csrfToken: 'csrf-next' }));
  global.fetch.mockResolvedValueOnce(apiResponse({ error: { code: 'authentication_required', message: 'Please log in.' } }, 401));
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
});

test('shows a retry state when /me returns a malformed success response', async () => {
  global.fetch
    .mockResolvedValueOnce(apiResponse({ csrfToken: 'csrf-initial' }))
    .mockResolvedValueOnce(apiResponse({}));
  render(<App />);

  expect(await screen.findByRole('heading', { name: 'We couldn’t connect' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('unexpected response');
});

test('prevents repeated submissions while an authentication request is pending', async () => {
  startSignedOut();
  let resolveLogin;
  global.fetch.mockImplementationOnce(() => new Promise((resolve) => { resolveLogin = resolve; }));
  render(<App />);
  await userEvent.type(await screen.findByLabelText('Username'), 'mira');
  await userEvent.type(screen.getByLabelText('Password'), 'secret-pass');
  const submit = screen.getByRole('button', { name: 'Sign in' });
  fireEvent.click(submit);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Please wait…' })).toBeDisabled());
  expect(global.fetch).toHaveBeenCalledTimes(3);
  resolveLogin(await apiResponse({ user: { id: 1, username: 'mira', email: 'mira@uni.edu' }, csrfToken: 'csrf-rotated' }));
  expect(await screen.findByRole('heading', { name: 'Welcome, mira' })).toBeInTheDocument();
});

function startSignedIn() {
  global.fetch
    .mockResolvedValueOnce(apiResponse({ csrfToken: 'csrf-initial' }))
    .mockResolvedValueOnce(apiResponse({ user: { id: 4, username: 'mira', email: 'mira@uni.edu' } }));
}

test('opens the public landing page and navigates to registration', async () => {
  window.history.replaceState(null, '', '/');
  startSignedOut();
  render(<App />);
  expect(screen.getByRole('heading', { name: 'From raw data to ready.' })).toBeInTheDocument();
  const header = screen.getByRole('banner');
  expect(within(header).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  await userEvent.click(within(header).getByRole('link', { name: 'Get started' }));
  expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/register');
});

test('keeps the landing page public for a restored user and links to the dashboard', async () => {
  window.history.replaceState(null, '', '/');
  startSignedIn();
  render(<App />);
  const links = await screen.findAllByRole('link', { name: 'Open dashboard' });
  expect(window.location.pathname).toBe('/');
  expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  await userEvent.click(links[0]);
  expect(await screen.findByRole('heading', { name: 'Welcome, mira' })).toBeInTheDocument();
});

test('keeps the public landing page accessible when the authentication API is offline', async () => {
  window.history.replaceState(null, '', '/');
  global.fetch.mockRejectedValueOnce(new Error('offline'));
  render(<App />);
  expect(screen.getByRole('heading', { name: 'From raw data to ready.' })).toBeInTheDocument();
  await userEvent.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Sign in' }));
  expect(await screen.findByRole('heading', { name: 'We couldn’t connect' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: 'CloudETL home' }));
  expect(screen.getByRole('heading', { name: 'From raw data to ready.' })).toBeInTheDocument();
});

test('returns to the requested protected page after login', async () => {
  window.history.replaceState(null, '', '/dashboard/datasets');
  startSignedOut();
  render(<App />);
  await userEvent.type(await screen.findByLabelText('Username'), 'mira');
  expect(window.location.pathname).toBe('/login');
  expect(new URLSearchParams(window.location.search).get('next')).toBe('/dashboard/datasets');
  expect(screen.queryByRole('navigation', { name: 'Workspace' })).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Password'), 'secret-pass');
  global.fetch.mockResolvedValueOnce(apiResponse({ user: { id: 4, username: 'mira', email: 'mira@uni.edu' }, csrfToken: 'csrf-login' }));
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('heading', { name: 'Datasets', level: 1 })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/dashboard/datasets');
  expect(await screen.findByText('No datasets yet')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload files' })).toBeDisabled();
});

test.each([
  ['datasets', 'Datasets'], ['pipelines', 'Pipelines'], ['runs', 'Runs'], ['results', 'Results'],
])('restores a session at the %s deep link', async (path, title) => {
  window.history.replaceState(null, '', `/dashboard/${path}/`);
  startSignedIn();
  render(<App />);
  expect(await screen.findByRole('heading', { name: title, level: 1 })).toBeInTheDocument();
  const navigation = screen.getByRole('navigation', { name: 'Workspace' });
  expect(within(navigation).getByRole('link', { name: title })).toHaveAttribute('aria-current', 'page');
  if (path === 'datasets') await screen.findByText('No datasets yet');
  expect(global.fetch.mock.calls.filter(([url]) => url.startsWith('/api/auth/'))).toHaveLength(2);
});

test('registers successfully and opens the dashboard', async () => {
  window.history.replaceState(null, '', '/register');
  startSignedOut();
  render(<App />);
  await userEvent.type(await screen.findByLabelText('Username'), 'mira');
  await userEvent.type(screen.getByLabelText('Email address'), 'mira@uni.edu');
  await userEvent.type(screen.getByLabelText('Password'), 'secret-pass');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'secret-pass');
  global.fetch.mockResolvedValueOnce(apiResponse({ user: { id: 4, username: 'mira', email: 'mira@uni.edu' }, csrfToken: 'csrf-register' }));
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByRole('heading', { name: 'Welcome, mira' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/dashboard');
});

test('navigates workspace pages with browser back and forward without restoring the session again', async () => {
  window.history.replaceState(null, '', '/dashboard');
  startSignedIn();
  render(<App />);
  await screen.findByRole('heading', { name: 'Welcome, mira' });
  const navigation = screen.getByRole('navigation', { name: 'Workspace' });
  await userEvent.click(within(navigation).getByRole('link', { name: 'Datasets' }));
  await userEvent.click(within(navigation).getByRole('link', { name: 'Pipelines' }));
  expect(screen.getByRole('heading', { name: 'Pipelines', level: 1 })).toHaveFocus();
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(await screen.findByRole('heading', { name: 'Datasets', level: 1 })).toBeInTheDocument();
  await act(async () => {
    window.history.forward();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(await screen.findByRole('heading', { name: 'Pipelines', level: 1 })).toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([url]) => url.startsWith('/api/auth/'))).toHaveLength(2);
});

test('blocks a protected page when revisiting it after logout', async () => {
  window.history.replaceState(null, '', '/dashboard');
  startSignedIn();
  render(<App />);
  await screen.findByRole('heading', { name: 'Welcome, mira' });
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('link', { name: 'Datasets' }));
  global.fetch.mockResolvedValueOnce(apiResponse({ user: null, csrfToken: 'csrf-logout' }));
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByRole('heading', { name: 'Welcome back' });
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Workspace' })).not.toBeInTheDocument();
  expect(window.location.pathname).toBe('/login');
});

test.each(['https://example.com', '//example.com', '/unregistered'])('ignores an unregistered login redirect %s', async (next) => {
  window.history.replaceState(null, '', `/login?next=${encodeURIComponent(next)}`);
  startSignedIn();
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Welcome, mira' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/dashboard');
});

test('shows a not-found page instead of treating an unknown URL as a dashboard page', async () => {
  window.history.replaceState(null, '', '/dashboard/missing');
  startSignedOut();
  await act(async () => { render(<App />); });
  expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: 'Back to home' }));
  expect(screen.getByRole('heading', { name: 'From raw data to ready.' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/');
});

test('uploads multipart data with the CSRF token rotated at login and lists the saved dataset', async () => {
  startSignedOut();
  render(<App />);
  await userEvent.type(await screen.findByLabelText('Username'), 'mira');
  await userEvent.type(screen.getByLabelText('Password'), 'secret-pass');
  global.fetch.mockResolvedValueOnce(apiResponse({ user: { id: 4, username: 'mira', email: 'mira@uni.edu' }, csrfToken: 'csrf-upload-token' }));
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'Welcome, mira' });
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('link', { name: 'Datasets' }));
  await screen.findByText('No datasets yet');
  const file = new File(['id,name\n1,Mira\n'], 'people.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [file] } });
  const dataset = { id: 'dataset-1', filename: 'people.csv', format: 'csv', size_bytes: file.size, uploaded_at: '2026-10-24T00:00:00Z' };
  global.fetch.mockResolvedValueOnce(apiResponse({ dataset }, 201)).mockResolvedValueOnce(apiResponse({
    datasets: [dataset], page: 1, total_pages: 1, total_count: 1,
    limits: { max_file_size_bytes: 26214400, extensions: ['csv', 'tsv', 'json', 'xlsx', 'parquet'] },
  }));
  await userEvent.click(screen.getByRole('button', { name: 'Upload 1 file' }));
  expect(await screen.findByRole('rowheader', { name: 'people.csv' })).toBeInTheDocument();
  const [url, options] = global.fetch.mock.calls.find(([requestUrl, init]) => requestUrl === '/api/datasets/' && init.method === 'POST');
  expect(url).toBe('/api/datasets/');
  expect(options.credentials).toBe('same-origin');
  expect(options.headers['X-CSRFToken']).toBe('csrf-upload-token');
  expect(options.headers['Content-Type']).toBeUndefined();
  expect(options.body).toBeInstanceOf(FormData);
  expect(options.body.get('file')).toBe(file);
});
