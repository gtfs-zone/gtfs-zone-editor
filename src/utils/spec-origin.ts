/**
 * How a spec overlay (`origin` on a file, field, enum value or note) is named
 * and linked in the UI.
 */

import type { GTFSSpecNote } from '../gtfs-spec/types';
import { gtfsSpec } from '../gtfs-spec';
import { googleExtension } from '../gtfs-spec/extensions/google';
import { renderSpecDescription } from 'gtfs-zone-web-common/gtfs/spec-markup';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { t } from '../i18n/messages';

function checkOrigin(origin: string): void {
  if (origin !== googleExtension.id) {
    throw new Error(`[SpecOrigin] unknown origin ${origin}`);
  }
}

/** Short name of an overlay, for badges and note labels. */
export function originLabel(origin: string): string {
  checkOrigin(origin);
  return t('spec.originGoogle');
}

/** The reference page an overlay is checked against. */
export function originSourceUrl(origin: string): string {
  checkOrigin(origin);
  return googleExtension.sourceUrl;
}

/** Overlay notes as HTML, each led by its overlay's label. */
export function renderSpecNotes(notes: readonly GTFSSpecNote[]): string {
  return notes
    .map(
      (note) =>
        `<div class="mt-1"><span class="badge badge-ghost badge-xs">${escapeHtml(originLabel(note.origin))}</span>${renderSpecDescription(note.text)}</div>`
    )
    .join('');
}

/** Filenames an overlay adds, in spec order. */
export function overlayFileNames(): string[] {
  return gtfsSpec.files.filter((f) => f.origin).map((f) => f.filename);
}

/** The overlay a file comes from, or undefined for a base spec file. */
export function fileOrigin(fileName: string): string | undefined {
  return gtfsSpec.files.find((f) => f.filename === fileName)?.origin;
}
