import { PersonalizationPanel } from "@/components/personalization-panel";

export default function PersonalizationPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Personalization</h1>
        <PersonalizationPanel />
      </div>
    </div>
  );
}
