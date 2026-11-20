import type { PageLoadEvent } from './$types';

export const load = ({ data }: PageLoadEvent) => ({
  ...data,
  chapters: data.chapters.map((chapter) => ({
    ...chapter,
    tokens: chapter.tokens?.map(([id, idx, reading]) => ({ ...reading, id, idx })) ?? null,
  })),
});
