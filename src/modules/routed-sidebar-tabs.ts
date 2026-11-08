/**
 * Keeps a routed sidebar modal's active entry in `modal_table`: a sidebar
 * click pushes it, and Back/Forward switches the entry while the modal stays
 * open (the modal router leaves a same-type modal alone).
 */

import type { NavigationEvent } from 'gtfs-zone-web-common/ui/page-state-manager';
import type { SidebarModalConfig } from 'gtfs-zone-web-common/ui/sidebar-modal';
import type { PageState, PaneModalType } from '../types/page-state';
import { openModal } from './navigation-actions';
import { getPageStateManager } from './page-state-manager';

type RoutedTabs = Required<
  Pick<SidebarModalConfig, 'onSelect' | 'selectRef'>
> & {
  dispose: () => void;
};

/**
 * `openedOn` is the entry the modal opened on, shown again when the hash
 * names no entry. Call `dispose` once the modal closes.
 */
export function routeSidebarTabs(
  type: PaneModalType,
  openedOn: string | undefined
): RoutedTabs {
  const selectRef = { select: async (_id: string): Promise<void> => {} };
  const onNavigate = (event: NavigationEvent<PageState>) => {
    const modal = event.to.modal;
    if (modal?.type !== type) {
      return;
    }
    const id = modal.table ?? openedOn;
    if (id) {
      void selectRef.select(id);
    }
  };
  getPageStateManager().addNavigationHandler(onNavigate);

  return {
    onSelect: (id) => {
      console.log(`[RoutedSidebarTabs] ${type}: switching to ${id}`);
      void openModal({ type, table: id });
    },
    selectRef,
    dispose: () => getPageStateManager().removeNavigationHandler(onNavigate),
  };
}
