interface SpinnerProps {
  size?: number;
}

/** Inline loading indicator; motion is essential so it keeps spinning. */
export function Spinner({ size = 14 }: SpinnerProps) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size }}
      role="presentation"
      aria-hidden="true"
    />
  );
}
