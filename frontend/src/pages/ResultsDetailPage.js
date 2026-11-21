import RunDetailPage from './RunDetailPage';

export default function ResultsDetailPage({
  backTo = '/dashboard/results',
  backLabel = '← All results',
  ...props
}) {
  return <RunDetailPage backTo={backTo} backLabel={backLabel} {...props} />;
}
