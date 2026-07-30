import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlinePencilSquare, HiOutlinePlus, HiOutlineTrash } from 'react-icons/hi2';
import Button from '@components/Button';
import { notify } from '@components/notifications/notify';
import { toFormError } from '@utils/apiError';
import { editorSlotIn, editorSlotOut, revealInScroller } from '../pageMotion';
import useMorphOnChange from '../useMorphOnChange';
import PreferenceRowDeleteModal from './PreferenceRowDeleteModal';
import PreferenceRowForm from './PreferenceRowForm';
import { useCatalogRowMutations } from './usePreferences';
import type { CatalogKey, CatalogRow, CatalogRowBody, LookupRow } from './preference.types';

const KEY = 'modules.panel.preferences';
const SECONDARY_COLOR = '#262626';
const DANGER_COLOR = '#dc2626';

/** `undefined` = no editor open; `null` = the "new row" editor; a number = that row is being edited. */
type EditorTarget = number | null | undefined;

interface PreferenceCatalogCardProps {
  catalog: CatalogKey;
  rows: CatalogRow[];
  municipalities: LookupRow[];
  /** How many ACTIVE rows must remain — mirrors the backend invariant so the UI explains the refusal
   *  before the request rather than surfacing a 409. */
  minimumActive: number;
}

/**
 * ONE manageable catalog: its rows, an inline editor for adding and changing them, and the delete
 * affordance. One component for all six, because the backend is one registry-driven endpoint set —
 * six near-identical cards would be six places for a behaviour to drift.
 *
 * **Motion is layered, never nested.** The card body is a single `useMorphOnChange` region keyed by
 * the rows AND the open editor, so it owns every height change in normal flow: opening the editor
 * grows the card, saving shrinks it back around the new list, and everything below slides for free.
 * Inside that region nothing else animates height — arrivals fade-rise via the region's own FLIP, and
 * the editor slot cross-fades (`editorSlotIn`/`editorSlotOut`). Closing is two-phase for the same
 * reason a delete is: the outgoing content leaves FIRST, then the state commits, so the box never
 * collapses around something still fully visible.
 *
 * Vertical rhythm matches the settings cards (20px at the card's edges, tighter gutters between rows)
 * — the list is inside the same surface, so it cannot look like a different kind of card.
 */
const PreferenceCatalogCard: React.FC<PreferenceCatalogCardProps> = ({
  catalog,
  rows,
  municipalities,
  minimumActive,
}) => {
  const { t } = useTranslation();
  const { createRow, updateRow, deleteRow, commitDeletion, isSaving, isDeleting } =
    useCatalogRowMutations(catalog);
  const [editing, setEditing] = useState<EditorTarget>(undefined);
  const [deleting, setDeleting] = useState<CatalogRow | undefined>(undefined);

  const activeCount = rows.filter((row) => row.isActive).length;
  /** Would removing/unpublishing this row strand a form? The backend refuses it; saying so here
   *  means the button explains itself instead of failing. */
  const isLastActive = (row: CatalogRow): boolean => row.isActive && activeCount <= minimumActive;

  /**
   * The morph region's identity: the rows AND which editor is open.
   *
   * Spelled out rather than `editing ?? 'closed'` — `??` treats `null` as nullish, so the NEW-ROW
   * editor (`null`) and "nothing open" (`undefined`) hashed to the same key and the region concluded
   * nothing had changed. Opening the add form got no height morph at all: it just jumped, while the
   * editor's own fade made it look like something was trying to animate.
   */
  const editorKey =
    editing === undefined ? 'closed' : editing === null ? 'new' : `row-${editing}`;
  const body = useMorphOnChange<HTMLDivElement>(
    `${rows.map((row) => `${row.id}:${row.isActive}`).join(',')}|${editorKey}`,
    '.preference-row',
  );

  const nodes = useRef(new Map<number, HTMLLIElement>());
  const editor = useRef<HTMLDivElement>(null);
  /** The slot whose editor just left, so the content RECLAIMING it fades in instead of popping.
   *  One-shot: consumed by the first matching ref callback, so a row that merely re-renders (or the
   *  whole list on first paint, which rides the page entrance) animates nothing. */
  const reclaiming = useRef<EditorTarget>(undefined);

  /** Fade the open editor away, THEN commit — so the card's height eases closed around empty space
   *  rather than around fields that are still on screen. `slot` is the editor that is leaving (a row
   *  id, or `null` for the new-row form); `next` is where the editor moves to, if anywhere. */
  const closeEditor = (slot: number | null, next: EditorTarget = undefined): void => {
    void editorSlotOut(editor.current).then(() => {
      reclaiming.current = slot;
      setEditing(next);
    });
  };

  /** Opening while another editor is open hands over rather than cutting: the current one leaves
   *  first, then the next takes the slot — one continuous movement instead of a hard swap. With
   *  nothing open the commit is immediate: the region's height morph starts in the same frame, so the
   *  form growing into place IS the transition. */
  const openEditor = (target: number | null): void => {
    if (editing === undefined) {
      setEditing(target);
      return;
    }
    closeEditor(editing, target);
  };

  // The editor slot fades up as the region opens its space, and the panel follows it down if it
  // landed below the fold — clicking "Agregar" while scrolled to the bottom of a card must not open a
  // form you cannot see. A callback ref, not an effect: it fires the moment the node exists, in the
  // same commit that changed the height, so both motions start on the same frame.
  const mountEditor = useCallback((element: HTMLDivElement | null): void => {
    editor.current = element;
    if (!element) return;
    editorSlotIn(element);
    revealInScroller(element);
  }, []);

  /**
   * The resting content of a slot (a row's label, the add button), which fades in when it takes an
   * editor's place — the mirror of `mountEditor`, so the swap is a cross-fade in BOTH directions.
   *
   * Both variants of a slot also carry distinct React `key`s. That is not cosmetic: they are both
   * `<div>`s in the same position, so React would otherwise RE-USE the editor's DOM node and the
   * `visibility:hidden` its exit left behind would land on the button — an invisible control still
   * occupying its space, which is exactly the bug this pairing prevents structurally.
   */
  const mountResting =
    (slot: number | null) =>
    (element: HTMLDivElement | null): void => {
      if (!element || reclaiming.current !== slot) return;
      reclaiming.current = undefined;
      editorSlotIn(element);
    };

  const fail = (error: unknown): void => {
    const { inline, toast } = toFormError(error, t(`${KEY}.errors.saveFallback`));
    // A catalog row has no banner of its own — the failure is ambient to the card, so it toasts.
    notify.error(inline ?? toast ?? t(`${KEY}.errors.saveFallback`));
  };

  /** `target` is the row being saved, or `null` for the new-row editor. It comes from the FORM that
   *  submitted rather than from `editing`, so there is no "neither" case to defend against. */
  const submit = (target: number | null, body_: CatalogRowBody): void => {
    if (target === null) {
      createRow(body_, {
        onSuccess: () => {
          closeEditor(null);
          notify.success(t(`${KEY}.toasts.created`));
        },
        onError: fail,
      });
      return;
    }
    updateRow(
      { id: target, body: body_ },
      {
        onSuccess: () => {
          closeEditor(target);
          notify.success(t(`${KEY}.toasts.updated`));
        },
        onError: fail,
      },
    );
  };

  /**
   * The removal — **request first, motion second.** Nothing leaves the screen until the server has
   * said it should: the dialog holds with its spinner (`locked`), and only the answer decides what
   * happens. Animating first and undoing on failure was a guess dressed up as a result — it showed the
   * row gone while the request could still fail, and it had to predict which door the delete would
   * take just to know whether to play an exit at all.
   *
   * A row that was DELETED fades where it stands and its space closes afterwards; a row that was only
   * HIDDEN never leaves — it re-sorts to the bottom with its "inactive" badge, which is what actually
   * happened. Either way the cache is patched only once the row has finished leaving, and the screen
   * re-reads itself from the server (`commitDeletion`).
   *
   * The fade keeps the row's SPACE (`editorSlotOut`, opacity only): the morph region owns the height,
   * so it eases the gap shut in one continuous tween while the rows below glide up. Collapsing the row
   * here as well would close that space twice.
   */
  const confirmDelete = (row: CatalogRow): void => {
    deleteRow(row.id, {
      onSuccess: (response) => {
        const deleted = response.data.data?.outcome === 'deleted';
        setDeleting(undefined);
        notify.success(t(`${KEY}.toasts.${deleted ? 'deleted' : 'deactivated'}`));
        if (!deleted) {
          commitDeletion(row.id, 'deactivated');
          return;
        }
        void editorSlotOut(nodes.current.get(row.id)).then(() =>
          commitDeletion(row.id, 'deleted'),
        );
      },
      onError: (error) => {
        // The row never moved, so there is nothing to put back.
        setDeleting(undefined);
        fail(error);
      },
    });
  };

  const extraLabel = (row: CatalogRow): string | undefined => {
    if (row.minLeadHours !== undefined) {
      return t(`${KEY}.badges.leadHours`, { count: row.minLeadHours });
    }
    if (row.deliveryFee !== undefined) {
      return t(`${KEY}.badges.fee`, { amount: row.deliveryFee.toFixed(2) });
    }
    // A zone with no configured fee says so, rather than reading as free.
    return catalog === 'zones' ? t(`${KEY}.badges.noFee`) : undefined;
  };

  return (
    <div ref={body} className="flex flex-col divide-y divide-charcoal/[0.07]">
      {/* `py-2` + each row's `py-3` = 20px at the card's edge, matching the settings cards, with
          16px gutters around the hairlines so the rows group tighter than the frame. */}
      <ul className="flex list-none flex-col divide-y divide-charcoal/[0.07] py-2">
        {rows.map((row) => (
          <li
            key={row.id}
            data-flip-id={row.id}
            ref={(element) => {
              if (element) nodes.current.set(row.id, element);
            }}
            className="preference-row"
          >
            {editing === row.id ? (
              <div key="editor" ref={mountEditor}>
                <PreferenceRowForm
                  catalog={catalog}
                  row={row}
                  municipalities={municipalities}
                  busy={isSaving}
                  onSubmit={(values) => submit(row.id, values)}
                  onCancel={() => closeEditor(row.id)}
                />
              </div>
            ) : (
              // The row LIFTS a hair on hover: quick in (150ms, snappy), settling out over 300ms —
              // the app's asymmetric pointer timing. Only `box-shadow` is transitioned for the
              // surface, never a `--tw-*` variable (those flip discretely and restart the tween).
              <div
                key="row"
                ref={mountResting(row.id)}
                className="group -mx-2 flex items-center gap-3 rounded-control px-2 py-3 transition-[translate,box-shadow] duration-300 ease-[var(--ease-settle)] hover:-translate-y-0.5 hover:shadow-[0_10px_26px_-20px_rgba(38,38,38,0.5)] hover:duration-150 hover:ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-charcoal">{row.name}</p>
                    {!row.isActive && (
                      <span className="shrink-0 rounded-chip bg-charcoal/[0.06] px-2 py-0.5 text-[11px] font-medium text-charcoal/50">
                        {t(`${KEY}.badges.inactive`)}
                      </span>
                    )}
                    {extraLabel(row) !== undefined && (
                      <span className="shrink-0 rounded-chip bg-charcoal/[0.04] px-2 py-0.5 text-[11px] font-medium tabular-nums text-charcoal/55">
                        {extraLabel(row)}
                      </span>
                    )}
                  </div>
                  {row.description !== undefined && (
                    <p className="mt-0.5 truncate text-xs text-charcoal/50">{row.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    color={SECONDARY_COLOR}
                    aria-label={t(`${KEY}.actions.editRow`, { name: row.name })}
                    startIcon={<HiOutlinePencilSquare className="size-4" />}
                    onClick={() => openEditor(row.id)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    color={DANGER_COLOR}
                    aria-label={t(`${KEY}.actions.deleteRow`, { name: row.name })}
                    // The backend refuses to strand a form; disabling here explains WHY up front
                    // instead of letting the click return a 409.
                    disabled={isLastActive(row)}
                    title={isLastActive(row) ? t(`${KEY}.actions.lastActive`) : undefined}
                    startIcon={<HiOutlineTrash className="size-4" />}
                    onClick={() => setDeleting(row)}
                  />
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* 20px below the hairline, mirroring the 20px above it (the list's `py-2` + a row's `py-3`). */}
      {editing === null ? (
        <div key="editor" ref={mountEditor}>
          <PreferenceRowForm
            catalog={catalog}
            municipalities={municipalities}
            busy={isSaving}
            onSubmit={(values) => submit(null, values)}
            onCancel={() => closeEditor(null)}
          />
        </div>
      ) : (
        <div key="add" ref={mountResting(null)} className="py-5">
          <Button
            variant="soft"
            size="sm"
            color={SECONDARY_COLOR}
            startIcon={<HiOutlinePlus className="size-4" />}
            onClick={() => openEditor(null)}
          >
            {t(`${KEY}.actions.add`)}
          </Button>
        </div>
      )}

      <PreferenceRowDeleteModal
        row={deleting}
        busy={isDeleting}
        onClose={() => setDeleting(undefined)}
        onConfirm={confirmDelete}
      />
    </div>
  );
};

/** Memoised: the page re-renders on every cache patch, and without this all six cards would re-run
 *  their morph measurement (a forced reflow plus a FLIP capture each) for one card's change. */
export default memo(PreferenceCatalogCard);
