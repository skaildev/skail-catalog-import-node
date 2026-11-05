import type { ImportStage } from "@skail-catalog-import/contracts";

interface Props {
  stage: ImportStage | undefined;
  /** Pages the target catalog already accepted. */
  savedPages: number;
  expectedPages: number;
  /** Seconds left of the visual wait between pages, or null when not waiting. */
  secondsLeft: number | null;
}

function label({ stage, savedPages, expectedPages, secondsLeft }: Props): string {
  switch (stage) {
    case undefined:
      return "Idle";
    case "Starting":
      return "Starting…";
    case "Completed":
      return "Completed";
    case "Failed":
      return "Failed";
    case "Started":
      return secondsLeft !== null && secondsLeft > 0
        ? `Next page in ${secondsLeft}s`
        : `Importing page ${savedPages + 1}/${expectedPages}`;
  }
}

export function StatusBadge(props: Props) {
  const { stage } = props;
  const kind = !stage ? "idle" : stage === "Failed" ? "failed" : stage === "Completed" ? "done" : "active";
  return <span className={`badge ${kind}`}>{label(props)}</span>;
}
