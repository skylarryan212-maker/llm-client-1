export type Source = {
  url: string;
  title?: string | null;
  domain?: string | null;
  startIndex?: number | null;
  endIndex?: number | null;
};

export type SourceChip = {
  id: number;
  title: string;
  url: string;
  domain: string;
};

export type ImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size?: number;
};

export type FileAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size?: number;
};
