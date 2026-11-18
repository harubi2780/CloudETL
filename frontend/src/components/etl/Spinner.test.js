import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen } from '@testing-library/react';
import Spinner from './Spinner';

test('is decorative and leaves the adjacent text as the accessible status', () => {
  render(<p role="status"><Spinner className="compact" />Running pipeline</p>);
  expect(screen.getByRole('status')).toHaveTextContent('Running pipeline');
  expect(screen.getByTestId('status-spinner')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByTestId('status-spinner')).toHaveClass('compact');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

test('the shipped stylesheet disables rotation when reduced motion is requested', () => {
  const css = readFileSync(join(__dirname, 'Spinner.css'), 'utf8');
  expect(css).toMatch(/@keyframes\s+etl-spin\s*\{[\s\S]*?rotate\(360deg\)/);
  expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.etl-spinner\s*\{\s*animation:\s*none;/);
});
