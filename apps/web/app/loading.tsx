import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <main className="section">
      <div className="shell">
        <Skeleton height={460} radius={20} />
      </div>
    </main>
  );
}
