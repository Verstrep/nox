type EmptyStateProps = {
  title: string;
  hint: string;
};

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-5 py-10 text-center">
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-zinc-600">{hint}</p>
    </div>
  );
}
