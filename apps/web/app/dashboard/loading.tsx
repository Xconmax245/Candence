import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <main className="section">
      <div className="shell">
        <Skeleton height={200} radius={20} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 40 }}>
          <Skeleton height={140} radius={14} />
          <Skeleton height={140} radius={14} />
        </div>
      </div>
    </main>
  );
}
