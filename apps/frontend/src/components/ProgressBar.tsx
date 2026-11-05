interface Props {
  imported: number;
  expected: number;
}

export function ProgressBar({ imported, expected }: Props) {
  return (
    <div className="progress">
      <div className="bar" role="progressbar" aria-valuenow={imported} aria-valuemin={0} aria-valuemax={expected}>
        <div className="fill" style={{ width: `${expected ? Math.min(100, (imported / expected) * 100) : 0}%` }} />
      </div>
      <span>{`${imported}/${expected} products`}</span>
    </div>
  );
}
