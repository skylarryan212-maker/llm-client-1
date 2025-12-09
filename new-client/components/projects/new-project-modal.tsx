"use client";

import { FormEvent, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProjectIconPicker } from "@/components/project-icon-picker";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, icon?: string, color?: string) => Promise<void>;
}

export function NewProjectModal({ isOpen, onClose, onCreate }: NewProjectModalProps) {
  const [name, setName] = useState("New Project");
  const [selectedIcon, setSelectedIcon] = useState("file");
  const [selectedColor, setSelectedColor] = useState("white");

  if (!isOpen) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await onCreate(trimmed, selectedIcon, selectedColor);
    setName("New Project");
    setSelectedIcon("file");
    setSelectedColor("white");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <button
          className="absolute right-3 top-3 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="space-y-1 pb-4">
          <h2 className="text-xl font-semibold text-foreground">Create project</h2>
          <p className="text-sm text-muted-foreground">Create a new project.</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="sr-only" htmlFor="project-name">
              Project name
            </label>
            <div className="flex gap-3">
              <ProjectIconPicker
                selectedIcon={selectedIcon}
                selectedColor={selectedColor}
                onIconChange={setSelectedIcon}
                onColorChange={setSelectedColor}
              />
              <Input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="My next idea"
                autoFocus
                className="flex-1"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="accent-new-project-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 h-9 px-4 py-2"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
