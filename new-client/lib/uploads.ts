export type UploadedFileInfo = {
  name: string;
  path: string;
  url: string;
  mime?: string;
};
export async function uploadFilesAndGetUrls(files: File[]): Promise<UploadedFileInfo[]> {
  const out: UploadedFileInfo[] = [];
  for (const file of files) {
    const form = new FormData();
    form.set("bucket", "attachments");
    form.set("file", file);
    const res = await fetch("/api/uploads", { method: "POST", body: form });
    if (!res.ok) {
      console.error("Upload API error", await res.text());
      continue;
    }
    const data = (await res.json()) as UploadedFileInfo & { url: string | null };
    if (!data.url) {
      continue;
    }
    out.push({ name: data.name, path: data.path, url: data.url, mime: data.mime });
  }
  return out;
}
