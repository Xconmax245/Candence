import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <main className="section">
      <div className="shell" style={{ maxWidth: 880 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <Skeleton height={360} radius={20} />
          <Skeleton height={360} radius={20} />
        </div>
      </div>
    </main>
  );
}
