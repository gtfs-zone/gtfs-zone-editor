import uFuzzy from '@leeoniya/ufuzzy';
import { showModal } from 'gtfs-zone-web-common/ui/modal-utils';
import { SELECTED_ROW_CLASS } from 'gtfs-zone-web-common/ui/selectable-row';
import { t } from '../i18n/messages';

export interface OptionPickerItem {
  value: string;
  primary: string;
  /** Short trailing hint, kept on the primary line. Truncated, never wrapped. */
  secondary?: string;
  /**
   * Long-form text (a spec description) shown on its own line under the
   * primary, wrapped to two lines with the full text as a tooltip.
   */
  detail?: string;
  /**
   * Group heading. With an empty query, ungrouped items come first, then a
   * heading per group in first-seen order; a query lists matches flat.
   */
  group?: string;
  /** Short tag shown as a badge after the primary, e.g. the value's origin. */
  marker?: string;
}

export interface OptionPickerOptions {
  title: string;
  options: OptionPickerItem[];
  selectedValue?: string;
  searchable?: boolean;
  placeholder?: string;
  /**
   * An escape hatch for the authoring case, shown as a button beside Cancel:
   * "the option I want is not in this list". Clicking it closes the picker
   * without choosing anything, so the caller's edit is left untouched.
   */
  footerAction?: { label: string; onClick: () => void };
  /** A short note shown under the results list. */
  hint?: string;
}

export interface MultiOptionPickerOptions {
  title: string;
  options: OptionPickerItem[];
  selectedValues?: string[];
  searchable?: boolean;
  placeholder?: string;
  /**
   * A row pinned above the list standing for "none of these", selected exactly
   * when nothing else is. Choosing it clears the selection, and choosing
   * anything else drops it, so the two can never both be on.
   */
  emptyOption?: { label: string; hint?: string };
}

const uf = new uFuzzy({ intraIns: 1 });

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function debounce(fn: () => void, ms: number): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    fn();
  }, ms);
}

/** Ungrouped items first, then each group's items in first-seen order. */
function groupOrder(items: OptionPickerItem[]): OptionPickerItem[] {
  const ungrouped: OptionPickerItem[] = [];
  const groups = new Map<string, OptionPickerItem[]>();
  for (const item of items) {
    if (item.group === undefined) {
      ungrouped.push(item);
    } else {
      const list = groups.get(item.group) ?? [];
      list.push(item);
      groups.set(item.group, list);
    }
  }
  return [...ungrouped, ...[...groups.values()].flat()];
}

/** How many matches the list shows before it asks for a narrower search. */
const MAX_SHOWN = 50;

interface PickerMode {
  /** Values checked when the modal opens. Empty in single-select mode. */
  selected: Set<string>;
  /** Value highlighted when the modal opens, in single-select mode. */
  selectedValue?: string;
  /** Picking an option resolves the modal, rather than toggling it. */
  closeOnPick: boolean;
  onPick: (value: string, close: () => void) => void;
}

/**
 * The shared body of both pickers: a search box over a scrolling result list,
 * with arrow-key navigation and Enter acting on the active row.
 */
function pickerBody(
  searchable: boolean,
  placeholder: string,
  emptyOption?: { label: string; hint?: string },
  hint?: string
): string {
  return `
    <div class="flex flex-col gap-3">
      ${
        searchable
          ? `<input
              id="option-picker-search"
              type="search"
              class="input input-bordered w-full"
              placeholder="${escapeHtml(placeholder)}"
              autocomplete="off"
            />`
          : ''
      }
      ${
        emptyOption
          ? `<button
              type="button"
              id="option-picker-empty"
              class="flex w-full cursor-pointer items-center gap-2 rounded border px-3 py-2 text-left text-sm hover:bg-base-200"
            >
              <span class="min-w-0 flex-1 truncate">${escapeHtml(emptyOption.label)}</span>
              ${emptyOption.hint ? `<span class="shrink-0 text-xs opacity-60">${escapeHtml(emptyOption.hint)}</span>` : ''}
            </button>`
          : ''
      }
      <div
        id="option-picker-results"
        class="overflow-y-auto max-h-96 border border-base-200 rounded"
        tabindex="0"
      ></div>
      ${hint ? `<div class="text-xs text-base-content/50 p-2">${escapeHtml(hint)}</div>` : ''}
    </div>
  `;
}

function mountPicker(
  options: OptionPickerItem[],
  searchable: boolean,
  mode: PickerMode,
  close: () => void
): void {
  const resultsEl = document.getElementById(
    'option-picker-results'
  ) as HTMLElement;
  const searchInput = searchable
    ? (document.getElementById('option-picker-search') as HTMLInputElement)
    : null;
  const emptyEl = document.getElementById('option-picker-empty');

  // The "none of these" row is not a checkbox: it is on exactly when nothing
  // else is, so selecting an option turns it off and it needs no state of its
  // own.
  const syncEmpty = () => {
    if (!emptyEl) {
      return;
    }
    const active = mode.selected.size === 0;
    emptyEl.classList.toggle('border-primary', active);
    emptyEl.classList.toggle('bg-primary/10', active);
    emptyEl.classList.toggle('border-base-200', !active);
    emptyEl.classList.toggle('opacity-60', !active);
  };

  let shown: OptionPickerItem[] = [];
  // The row element per `shown` entry. Group headings sit between rows, so
  // `resultsEl.children` cannot be indexed by position in `shown`.
  let rowEls: HTMLElement[] = [];
  let activeIndex = 0;
  const grouped = options.some((o) => o.group !== undefined);

  // A selected row keeps its highlight and never takes the gray active
  // background; when it is also active it gets an outline instead.
  const paintRow = (index: number) => {
    const row = rowEls[index];
    const item = shown[index];
    if (!row || !item) {
      return;
    }
    const selected = !mode.closeOnPick && mode.selected.has(item.value);
    const active = index === activeIndex;
    for (const cls of SELECTED_ROW_CLASS.split(' ')) {
      row.classList.toggle(cls, selected);
    }
    row.classList.toggle('bg-base-200', active && !selected);
    row.classList.toggle('outline', active && selected);
    row.classList.toggle('outline-primary', active && selected);
  };

  const setActive = (index: number) => {
    const previous = activeIndex;
    activeIndex = index;
    paintRow(previous);
    paintRow(index);
    rowEls[index]?.scrollIntoView({ block: 'nearest' });
  };

  const render = (query: string) => {
    const q = query.trim();
    let filtered: OptionPickerItem[];
    if (!q) {
      filtered = options;
    } else {
      const haystack = options.map(
        (o) =>
          `${o.primary} ${o.secondary ?? ''} ${o.group ?? ''} ${o.detail ?? ''}`
      );
      const [idxs] = uf.search(haystack, q);
      filtered = idxs && idxs.length > 0 ? idxs.map((i) => options[i]) : [];
    }

    // Selected options lead the list and are never capped: an area with 200
    // stops out of 8000 has to be able to see and uncheck all 200. Only the
    // unselected remainder is capped, so the cap is what the note counts.
    // Partitioning happens per render, not per toggle, so rows only move when
    // the query changes, never out from under the pointer.
    // A grouped list with no query is shown whole, in group order, so every
    // group heading is reachable by scrolling.
    const groupedView = grouped && !q;
    const picked = filtered.filter((o) => mode.selected.has(o.value));
    const rest = filtered.filter((o) => !mode.selected.has(o.value));
    const cap = groupedView ? rest.length : MAX_SHOWN;
    const hidden = Math.max(rest.length - cap, 0);
    shown = groupedView
      ? groupOrder(filtered)
      : [...picked, ...rest.slice(0, cap)];
    rowEls = [];

    if (shown.length === 0) {
      resultsEl.innerHTML = `<div class="text-base-content/60 text-sm p-4 text-center">${t('picker.noOptions')}</div>`;
      return;
    }

    resultsEl.innerHTML = '';
    let currentGroup: string | undefined;
    shown.forEach((item, i) => {
      if (
        groupedView &&
        item.group !== undefined &&
        item.group !== currentGroup
      ) {
        currentGroup = item.group;
        const heading = document.createElement('div');
        heading.className =
          'px-3 pt-3 pb-1 text-xs font-semibold opacity-60 border-b border-base-200';
        heading.textContent = item.group;
        resultsEl.appendChild(heading);
      }
      // A flat result names its group in the trailing hint.
      const secondary = groupedView
        ? item.secondary
        : (item.secondary ?? item.group);
      const row = document.createElement('div');
      row.className =
        'flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-base-200 last:border-0';
      if (!mode.closeOnPick) {
        row.classList.add('rounded-lg');
      }
      row.innerHTML = `
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="min-w-0 flex-1 truncate text-sm">${escapeHtml(item.primary)}</span>
            ${item.marker ? `<span class="badge badge-ghost badge-xs shrink-0">${escapeHtml(item.marker)}</span>` : ''}
            ${secondary ? `<span class="shrink-0 text-xs opacity-60">${escapeHtml(secondary)}</span>` : ''}
          </div>
          ${item.detail ? `<div class="text-xs opacity-60 line-clamp-2" title="${escapeHtml(item.detail)}">${escapeHtml(item.detail)}</div>` : ''}
        </div>
      `;
      row.addEventListener('mouseenter', () => setActive(i));
      row.addEventListener('click', () => {
        mode.onPick(item.value, close);
        if (!mode.closeOnPick) {
          paintRow(i);
          syncEmpty();
        }
      });
      resultsEl.appendChild(row);
      rowEls.push(row);
    });

    if (hidden > 0) {
      const note = document.createElement('div');
      note.className = 'text-xs text-base-content/50 text-center p-2';
      const selectedNote =
        picked.length > 0
          ? t('picker.allSelected', { count: picked.length })
          : '';
      note.textContent = `${selectedNote}${t('picker.more', {
        shown: shown.length - picked.length,
        total: rest.length,
      })}`;
      resultsEl.appendChild(note);
    }

    const preselected = shown.findIndex((o) => o.value === mode.selectedValue);
    activeIndex = preselected >= 0 ? preselected : 0;
    shown.forEach((_, i) => paintRow(i));
    rowEls[activeIndex]?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = shown[activeIndex];
      if (item) {
        mode.onPick(item.value, close);
        if (!mode.closeOnPick) {
          paintRow(activeIndex);
          syncEmpty();
        }
      }
    } else if (e.key === 'ArrowDown' && shown.length > 0) {
      e.preventDefault();
      setActive((activeIndex + 1) % shown.length);
    } else if (e.key === 'ArrowUp' && shown.length > 0) {
      e.preventDefault();
      setActive((activeIndex - 1 + shown.length) % shown.length);
    }
  };

  render('');
  syncEmpty();

  emptyEl?.addEventListener('click', () => {
    mode.selected.clear();
    render(searchInput?.value ?? '');
    syncEmpty();
  });

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      debounce(() => render(searchInput.value), 200);
    });
    searchInput.addEventListener('keydown', onKeyDown);
    searchInput.focus();
  } else {
    resultsEl.addEventListener('keydown', onKeyDown);
    resultsEl.focus();
  }
}

/**
 * A searchable option-picker modal, styled like the search bar dropdown.
 * Resolves with the chosen option's `value`, or `null` if cancelled.
 */
export async function showOptionPickerModal(
  opts: OptionPickerOptions
): Promise<string | null> {
  let selected: string | null = null;
  const searchable = opts.searchable !== false;
  const footer = opts.footerAction;

  await showModal({
    title: opts.title,
    body: pickerBody(
      searchable,
      opts.placeholder ?? t('picker.search'),
      undefined,
      opts.hint
    ),
    actions: [
      ...(footer
        ? [
            {
              label: footer.label,
              className: 'btn-ghost mr-auto',
              onClick: () => footer.onClick(),
            },
          ]
        : []),
      { label: t('common.cancel'), onClick: () => {} },
    ],
    escapeAction: footer ? 1 : 0,
    onMount: (close) => {
      mountPicker(
        opts.options,
        searchable,
        {
          selected: new Set(),
          selectedValue: opts.selectedValue,
          closeOnPick: true,
          onPick: (value, closePicker) => {
            selected = value;
            closePicker();
          },
        },
        close
      );
    },
  });

  return selected;
}

/**
 * The same picker with checkboxes: clicking a row toggles it and the modal
 * stays open until Done. Resolves with the selected values, or `null` if
 * cancelled.
 */
export async function showMultiOptionPickerModal(
  opts: MultiOptionPickerOptions
): Promise<string[] | null> {
  const searchable = opts.searchable !== false;
  const selected = new Set(opts.selectedValues ?? []);
  let confirmed = false;

  await showModal({
    title: opts.title,
    body: pickerBody(
      searchable,
      opts.placeholder ?? t('picker.search'),
      opts.emptyOption
    ),
    actions: [
      {
        label: t('picker.done'),
        className: 'btn-primary',
        onClick: () => {
          confirmed = true;
        },
      },
      { label: t('common.cancel'), className: 'btn-ghost', onClick: () => {} },
    ],
    escapeAction: 1,
    onMount: (close) => {
      mountPicker(
        opts.options,
        searchable,
        {
          selected,
          closeOnPick: false,
          onPick: (value) => {
            if (selected.has(value)) {
              selected.delete(value);
            } else {
              selected.add(value);
            }
          },
        },
        close
      );
    },
  });

  return confirmed ? [...selected] : null;
}
