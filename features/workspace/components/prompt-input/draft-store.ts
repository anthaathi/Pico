import { create } from 'zustand';
import type { Attachment } from './constants';

interface Draft {
  text: string;
  attachments: Attachment[];
}

const EMPTY_ATTACHMENTS: Attachment[] = [];
const EMPTY_DRAFT: Draft = { text: '', attachments: EMPTY_ATTACHMENTS };

interface DraftState {
  drafts: Record<string, Draft>;
  getText: (key: string) => string;
  getAttachments: (key: string) => Attachment[];
  setText: (key: string, text: string) => void;
  setAttachments: (key: string, attachments: Attachment[]) => void;
  addAttachment: (key: string, attachment: Attachment) => void;
  removeAttachment: (key: string, attachmentId: string) => void;
  clearDraft: (key: string) => void;
  migrateDraft: (fromKey: string, toKey: string) => void;
}

export const useDraftStore = create<DraftState>((set, get) => ({
  drafts: {},

  getText: (key) => get().drafts[key]?.text ?? '',

  getAttachments: (key) => get().drafts[key]?.attachments ?? EMPTY_ATTACHMENTS,

  setText: (key, text) =>
    set((state) => {
      const existing = state.drafts[key] ?? EMPTY_DRAFT;
      return {
        drafts: { ...state.drafts, [key]: { ...existing, text } },
      };
    }),

  setAttachments: (key, attachments) =>
    set((state) => {
      const existing = state.drafts[key] ?? EMPTY_DRAFT;
      return {
        drafts: { ...state.drafts, [key]: { ...existing, attachments } },
      };
    }),

  addAttachment: (key, attachment) =>
    set((state) => {
      const existing = state.drafts[key] ?? EMPTY_DRAFT;
      return {
        drafts: {
          ...state.drafts,
          [key]: { ...existing, attachments: [...existing.attachments, attachment] },
        },
      };
    }),

  removeAttachment: (key, attachmentId) =>
    set((state) => {
      const existing = state.drafts[key] ?? EMPTY_DRAFT;
      return {
        drafts: {
          ...state.drafts,
          [key]: {
            ...existing,
            attachments: existing.attachments.filter((a) => a.id !== attachmentId),
          },
        },
      };
    }),

  clearDraft: (key) =>
    set((state) => {
      const { [key]: _, ...rest } = state.drafts;
      return { drafts: rest };
    }),

  migrateDraft: (fromKey, toKey) =>
    set((state) => {
      const existing = state.drafts[fromKey];
      if (!existing || (existing.text === '' && existing.attachments.length === 0)) {
        return state;
      }
      const { [fromKey]: _, ...rest } = state.drafts;
      return { drafts: { ...rest, [toKey]: existing } };
    }),
}));
