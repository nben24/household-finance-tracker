// Shown the moment someone taps a link, while the page's data loads. The
// sidebar and menu stay usable meanwhile.

function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-line/70 ${className}`} />;
}

export default function Loading() {
  return (
    <div aria-busy="true">
      <p className="sr-only" role="status">
        Loading…
      </p>
      <div className="mb-6">
        <Block className="h-7 w-48" />
        <Block className="mt-2 h-4 w-32" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="rounded-xl border border-line bg-surface p-4">
            <Block className="h-3 w-20" />
            <Block className="mt-3 h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {[0, 1].map((card) => (
          <div key={card} className="rounded-xl border border-line bg-surface p-4 sm:p-5">
            <Block className="h-4 w-36" />
            <div className="mt-4 space-y-3">
              {[0, 1, 2, 3, 4].map((line) => (
                <Block key={line} className="h-4 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
