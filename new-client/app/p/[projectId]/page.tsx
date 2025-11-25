// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Home route working</h1>
      <p>
        Go to a test conversation:{" "}
        <Link href="/c/test-convo">/c/test-convo</Link>
      </p>
    </main>
  );
}
